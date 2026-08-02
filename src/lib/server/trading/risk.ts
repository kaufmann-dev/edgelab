import Decimal from 'decimal.js';
import type { Instrument, NormalizedQuote, OptionInstrument } from '../market-data/types';
import { money } from '../market-data/numeric';
import { applyExecutionSlippage } from './execution';
import {
	executableQuoteContextSchema,
	type ExecutableQuoteContext,
	validateExecutableQuotes
} from './quote-validation';
import {
	executionModelSchema,
	feeModelSchema,
	orderDraftSchema,
	type ExecutionModel,
	type FeeModel,
	type LegPreview,
	type OrderDraft,
	type OrderPreview,
	type PortfolioAccountState,
	type ResolvedOrderLeg,
	type RiskViolation
} from './types';

function validateRequiredQuotes(
	symbols: readonly string[],
	quotes: ReadonlyMap<string, NormalizedQuote>,
	context: ExecutableQuoteContext,
	violations: RiskViolation[]
): { invalidSymbols: Set<string>; globallyInvalid: boolean } {
	const invalidSymbols = new Set<string>();
	const availableQuotes: NormalizedQuote[] = [];
	for (const symbol of symbols) {
		const quote = quotes.get(symbol);
		if (quote) {
			availableQuotes.push(quote);
			continue;
		}
		invalidSymbols.add(symbol);
		violations.push({
			code: 'quote_unavailable',
			message: `No executable quote is available for ${symbol}`,
			symbol
		});
	}

	const validation = validateExecutableQuotes(availableQuotes, context);
	const messagesBySymbol = new Map<string, string[]>();
	const globalMessages: string[] = [];
	for (const issue of validation.issues) {
		if (!issue.symbol) {
			globalMessages.push(issue.message);
			continue;
		}
		invalidSymbols.add(issue.symbol);
		const messages = messagesBySymbol.get(issue.symbol) ?? [];
		messages.push(issue.message);
		messagesBySymbol.set(issue.symbol, messages);
	}
	for (const [symbol, messages] of messagesBySymbol) {
		violations.push({ code: 'quote_stale', message: messages.join('; '), symbol });
	}
	if (globalMessages.length > 0) {
		violations.push({ code: 'quote_stale', message: globalMessages.join('; ') });
	}

	return { invalidSymbols, globallyInvalid: globalMessages.length > 0 };
}

function variableFee(instrument: Instrument, quantity: Decimal, model: FeeModel): Decimal {
	return money(
		instrument.assetClass === 'stocks'
			? model.stockPerShare.times(quantity)
			: model.optionPerContract.times(quantity)
	);
}

function referencePrice(
	draft: OrderDraft,
	leg: ResolvedOrderLeg,
	quote: NormalizedQuote | undefined,
	executionModel: ExecutionModel
): Decimal | undefined {
	if (draft.type === 'limit' || draft.type === 'stop_limit') {
		if (draft.legs.length === 1) return draft.limitPrice;
		return leg.side === 'buy' ? quote?.askPrice : quote?.bidPrice;
	}
	const price =
		leg.side === 'buy'
			? (quote?.askPrice ?? draft.stopPrice)
			: (quote?.bidPrice ?? draft.stopPrice);
	if (!price || draft.type !== 'market') return price;
	return applyExecutionSlippage(price, leg, executionModel);
}

function commonMultiLegOptionMultiplier(
	legs: readonly ResolvedOrderLeg[],
	violations: RiskViolation[]
): Decimal | undefined {
	if (legs.length < 2) return undefined;
	const firstInstrument = legs[0].instrument;
	const compatible =
		firstInstrument.assetClass === 'options' &&
		legs.every(
			(leg) =>
				leg.instrument.assetClass === 'options' &&
				leg.instrument.underlyingSymbol === firstInstrument.underlyingSymbol &&
				leg.instrument.currency === firstInstrument.currency &&
				leg.instrument.multiplier.equals(firstInstrument.multiplier)
		);
	if (!compatible) {
		violations.push({
			code: 'unsupported_multi_leg_strategy',
			message: 'Multi-leg orders require options with the same underlying, currency, and multiplier'
		});
		return undefined;
	}
	return firstInstrument.multiplier;
}

function positionQuantity(account: PortfolioAccountState, symbol: string): Decimal {
	return account.positions.get(symbol)?.quantity ?? new Decimal(0);
}

function reservedQuantity(account: PortfolioAccountState, symbol: string): Decimal {
	return account.reservedPositionQuantities.get(symbol) ?? new Decimal(0);
}

function addPositionReservation(
	reservations: Map<string, Decimal>,
	symbol: string,
	quantity: Decimal
): void {
	reservations.set(symbol, (reservations.get(symbol) ?? new Decimal(0)).plus(quantity));
}

function findVerticalSpread(input: {
	legs: LegPreview[];
	netCashChange: Decimal;
}): { shortSymbol: string; collateral: Decimal } | undefined {
	if (input.legs.length !== 2) return undefined;
	const short = input.legs.find(
		(preview) => preview.leg.side === 'sell' && preview.leg.positionEffect === 'open'
	);
	const long = input.legs.find(
		(preview) => preview.leg.side === 'buy' && preview.leg.positionEffect === 'open'
	);
	if (!short || !long) return undefined;
	if (
		short.leg.instrument.assetClass !== 'options' ||
		long.leg.instrument.assetClass !== 'options'
	) {
		return undefined;
	}
	const shortOption = short.leg.instrument;
	const longOption = long.leg.instrument;
	if (
		shortOption.underlyingSymbol !== longOption.underlyingSymbol ||
		shortOption.optionType !== longOption.optionType ||
		shortOption.expirationDate !== longOption.expirationDate ||
		!short.quantity.equals(long.quantity) ||
		!shortOption.multiplier.equals(longOption.multiplier)
	) {
		return undefined;
	}
	const protectiveStrike =
		shortOption.optionType === 'call'
			? longOption.strikePrice.greaterThan(shortOption.strikePrice)
			: longOption.strikePrice.lessThan(shortOption.strikePrice);
	if (!protectiveStrike) return undefined;

	const width = shortOption.strikePrice.minus(longOption.strikePrice).abs();
	const widthNotional = width.times(shortOption.multiplier).times(short.quantity);
	const netCredit = Decimal.max(input.netCashChange, 0);
	return {
		shortSymbol: shortOption.symbol,
		collateral: money(Decimal.max(widthNotional.minus(netCredit), 0))
	};
}

function validateCloseQuantity(
	leg: ResolvedOrderLeg,
	quantity: Decimal,
	account: PortfolioAccountState,
	violations: RiskViolation[]
): void {
	if (leg.positionEffect !== 'close') return;
	const held = positionQuantity(account, leg.symbol);
	const reserved = reservedQuantity(account, leg.symbol);
	const available =
		leg.side === 'sell'
			? Decimal.max(held.minus(reserved), 0)
			: Decimal.max(held.negated().minus(reserved), 0);
	if (quantity.greaterThan(available)) {
		violations.push({
			code: 'insufficient_position',
			message: `The ${leg.side} order exceeds the unreserved ${leg.symbol} position`,
			symbol: leg.symbol
		});
	}
}

function collateralForUnprotectedShortOption(input: {
	option: OptionInstrument;
	quantity: Decimal;
	account: PortfolioAccountState;
	shareCollateral: Map<string, Decimal>;
	violations: RiskViolation[];
}): Decimal {
	if (input.option.optionType === 'put') {
		return money(input.option.strikePrice.times(input.option.multiplier).times(input.quantity));
	}

	const alreadyReserved =
		input.shareCollateral.get(input.option.underlyingSymbol) ?? new Decimal(0);
	const requiredShares = input.option.multiplier.times(input.quantity);
	const underlyingHeld = positionQuantity(input.account, input.option.underlyingSymbol);
	const underlyingReserved = reservedQuantity(input.account, input.option.underlyingSymbol);
	const availableShares = Decimal.max(
		underlyingHeld.minus(underlyingReserved).minus(alreadyReserved),
		0
	);
	if (requiredShares.greaterThan(availableShares)) {
		input.violations.push({
			code: 'uncovered_option',
			message: `Opening ${input.option.symbol} requires ${requiredShares.toFixed()} available ${input.option.underlyingSymbol} shares`,
			symbol: input.option.symbol
		});
	} else {
		addPositionReservation(input.shareCollateral, input.option.underlyingSymbol, requiredShares);
	}
	return new Decimal(0);
}

export function previewOrder(input: {
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	quotes: ReadonlyMap<string, NormalizedQuote>;
	account: PortfolioAccountState;
	executionModel: ExecutionModel;
	quoteContext: ExecutableQuoteContext;
	feeModel?: FeeModel;
}): OrderPreview {
	const draft = orderDraftSchema.parse(input.draft);
	const executionModel = executionModelSchema.parse(input.executionModel);
	const feeModel = feeModelSchema.parse(input.feeModel ?? {});
	const quoteContext = executableQuoteContextSchema.parse(input.quoteContext);
	const violations: RiskViolation[] = [];
	const previews: LegPreview[] = [];
	const resolvedLegs: ResolvedOrderLeg[] = [];
	const requiresQuotes = !['limit', 'stop_limit'].includes(draft.type) || draft.legs.length > 1;
	const quoteValidation = requiresQuotes
		? validateRequiredQuotes(
				draft.legs.map((leg) => leg.symbol),
				input.quotes,
				{
					...quoteContext,
					maxTransportAgeMilliseconds: Math.min(
						quoteContext.maxTransportAgeMilliseconds,
						input.account.riskPolicy.quoteMaxAgeMilliseconds
					)
				},
				violations
			)
		: { invalidSymbols: new Set<string>(), globallyInvalid: false };

	if (input.account.openOrderCount >= input.account.riskPolicy.maxOpenOrders) {
		violations.push({
			code: 'open_order_limit',
			message: 'The portfolio open-order limit was reached'
		});
	}

	for (const legDraft of draft.legs) {
		const instrument = input.instruments.get(legDraft.symbol);
		if (!instrument) {
			violations.push({
				code: 'instrument_not_found',
				message: `Instrument ${legDraft.symbol} was not found`,
				symbol: legDraft.symbol
			});
			continue;
		}
		const leg: ResolvedOrderLeg = { ...legDraft, instrument };
		resolvedLegs.push(leg);
		if (!instrument.active) {
			violations.push({
				code: 'instrument_inactive',
				message: `${instrument.symbol} is inactive`,
				symbol: instrument.symbol
			});
		}
		if (instrument.currency !== 'USD') {
			violations.push({
				code: 'unsupported_currency',
				message: `${instrument.symbol} is not USD-denominated`,
				symbol: instrument.symbol
			});
		}
		if (draft.extendedHours && instrument.assetClass !== 'stocks') {
			violations.push({
				code: 'extended_hours_not_supported',
				message: 'Options cannot trade in the extended-hours model',
				symbol: instrument.symbol
			});
		}

		const quantity = draft.quantity.times(leg.ratioQuantity);
		if (instrument.assetClass === 'options') {
			if (!quantity.isInteger()) {
				violations.push({
					code: 'invalid_quantity',
					message: 'Option contract quantities must be whole numbers',
					symbol: instrument.symbol
				});
			}
			if (quantity.greaterThan(input.account.riskPolicy.maxOptionContractsPerOrder)) {
				violations.push({
					code: 'option_contract_limit',
					message: `${instrument.symbol} exceeds the per-order contract limit`,
					symbol: instrument.symbol
				});
			}
			if (instrument.additionalUnderlyings.length > 0) {
				violations.push({
					code: 'unsupported_option_deliverable',
					message: `${instrument.symbol} has nonstandard deliverables`,
					symbol: instrument.symbol
				});
			}
		}
		validateCloseQuantity(leg, quantity, input.account, violations);
		if (
			instrument.assetClass === 'stocks' &&
			leg.side === 'sell' &&
			leg.positionEffect === 'open' &&
			!input.account.riskPolicy.allowShortStock
		) {
			violations.push({
				code: 'short_stock_disabled',
				message: 'Short stock is disabled for this portfolio',
				symbol: instrument.symbol
			});
		}

		const quote =
			requiresQuotes &&
			!quoteValidation.globallyInvalid &&
			!quoteValidation.invalidSymbols.has(instrument.symbol)
				? input.quotes.get(instrument.symbol)
				: undefined;
		const price = referencePrice(draft, leg, quote, executionModel);
		if (!price) continue;
		const multiplier = instrument.assetClass === 'options' ? instrument.multiplier : new Decimal(1);
		previews.push({
			leg,
			quantity,
			referencePrice: price,
			grossAmount: money(price.times(quantity).times(multiplier)),
			fee: variableFee(instrument, quantity, feeModel)
		});
	}

	let fees = previews.reduce((sum, preview) => sum.plus(preview.fee), new Decimal(0));
	if (previews.length > 0 && fees.lessThan(feeModel.minimumPerOrder)) {
		const difference = feeModel.minimumPerOrder.minus(fees);
		previews[0] = { ...previews[0], fee: previews[0].fee.plus(difference) };
		fees = feeModel.minimumPerOrder;
	}
	const grossCashChange = previews.reduce(
		(sum, preview) =>
			preview.leg.side === 'buy' ? sum.minus(preview.grossAmount) : sum.plus(preview.grossAmount),
		new Decimal(0)
	);
	const estimatedNetCashChange = money(grossCashChange.minus(fees));
	const commonOptionMultiplier =
		resolvedLegs.length === draft.legs.length
			? commonMultiLegOptionMultiplier(resolvedLegs, violations)
			: undefined;
	let riskNetCashChange = estimatedNetCashChange;
	if (
		draft.legs.length > 1 &&
		draft.type === 'limit' &&
		draft.limitPrice &&
		commonOptionMultiplier
	) {
		const limitGrossAmount = money(
			draft.limitPrice.times(commonOptionMultiplier).times(draft.quantity)
		);
		riskNetCashChange = money(
			draft.netPriceEffect === 'debit'
				? limitGrossAmount.negated().minus(fees)
				: limitGrossAmount.minus(fees)
		);
	}
	const orderNotional = money(
		previews.reduce((sum, preview) => sum.plus(preview.grossAmount), new Decimal(0))
	);

	if (
		input.account.riskPolicy.maxOrderNotional &&
		orderNotional.greaterThan(input.account.riskPolicy.maxOrderNotional)
	) {
		violations.push({
			code: 'order_notional_limit',
			message: 'The order exceeds the portfolio notional limit'
		});
	}

	let optionCollateral = new Decimal(0);
	const shareCollateral = new Map<string, Decimal>();
	for (const preview of previews) {
		if (preview.leg.positionEffect === 'close') {
			addPositionReservation(shareCollateral, preview.leg.symbol, preview.quantity);
		}
	}
	const vertical =
		draft.netPriceEffect === 'credit'
			? findVerticalSpread({ legs: previews, netCashChange: riskNetCashChange })
			: undefined;
	if (vertical) optionCollateral = optionCollateral.plus(vertical.collateral);

	for (const preview of previews) {
		const { leg, quantity } = preview;
		if (
			leg.instrument.assetClass !== 'options' ||
			leg.side !== 'sell' ||
			leg.positionEffect !== 'open' ||
			vertical?.shortSymbol === leg.symbol
		) {
			continue;
		}
		optionCollateral = optionCollateral.plus(
			collateralForUnprotectedShortOption({
				option: leg.instrument,
				quantity,
				account: input.account,
				shareCollateral,
				violations
			})
		);
	}
	optionCollateral = money(optionCollateral);
	const cashRequired = money(Decimal.max(riskNetCashChange.negated(), 0).plus(optionCollateral));
	const availableCash = input.account.cashBalance.minus(input.account.reservedCash);
	if (cashRequired.greaterThan(availableCash)) {
		violations.push({
			code: 'insufficient_cash',
			message: `Order requires ${cashRequired.toFixed(2)} USD but only ${availableCash.toFixed(2)} USD is available`
		});
	}

	return {
		accepted: violations.length === 0 && previews.length === resolvedLegs.length,
		legs: previews,
		estimatedNetCashChange,
		cashRequired,
		optionCollateral,
		shareCollateral,
		orderNotional,
		fees: money(fees),
		violations
	};
}
