import Decimal from 'decimal.js';
import type { Instrument, NormalizedBar } from '../market-data/types';
import { money } from '../market-data/numeric';
import { applyExecutionSlippage } from './execution';
import { executableBarContextSchema, type ExecutableBarContext } from './bar-validation';
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

function validateRequiredBars(
	symbols: readonly string[],
	bars: ReadonlyMap<string, NormalizedBar>,
	context: ExecutableBarContext,
	violations: RiskViolation[]
): Set<string> {
	const invalidSymbols = new Set<string>();
	const logicalAt = new Date(context.attemptAt.getTime() - context.expectedDelayMilliseconds);
	for (const symbol of symbols) {
		const bar = bars.get(symbol);
		if (!bar) {
			invalidSymbols.add(symbol);
			violations.push({
				code: 'market_data_unavailable',
				message: `No aggregate price is available for ${symbol}`,
				symbol
			});
			continue;
		}
		const transportAge = context.attemptAt.getTime() - bar.receivedAt.getTime();
		const sourceAge = logicalAt.getTime() - bar.endTime.getTime();
		const completeMinute =
			bar.interval === 'minute' &&
			bar.endTime.getTime() - bar.startTime.getTime() === 60_000 &&
			bar.sourceTime.getTime() === bar.endTime.getTime();
		if (
			bar.mode !== context.expectedMode ||
			!completeMinute ||
			transportAge > context.maxTransportAgeMilliseconds ||
			transportAge < -context.futureToleranceMilliseconds ||
			sourceAge > context.maxSourceAgeMilliseconds ||
			sourceAge < -context.futureToleranceMilliseconds
		) {
			invalidSymbols.add(symbol);
			violations.push({
				code: 'market_data_stale',
				message: `${symbol} does not have a fresh, completed minute aggregate for this portfolio's market clock`,
				symbol
			});
		}
	}
	return invalidSymbols;
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
	bar: NormalizedBar | undefined,
	executionModel: ExecutionModel
): Decimal | undefined {
	if (draft.type === 'limit' || draft.type === 'stop_limit') {
		return draft.limitPrice;
	}
	const price = leg.instrument.assetClass === 'stocks' ? bar?.close : undefined;
	if (!price || draft.type !== 'market') return price;
	return applyExecutionSlippage(price, leg, executionModel);
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

function validatePositionEffectConsistency(
	leg: ResolvedOrderLeg,
	account: PortfolioAccountState,
	violations: RiskViolation[]
): void {
	if (leg.positionEffect !== 'open') return;
	const held = positionQuantity(account, leg.symbol);
	const conflictsWithExistingPosition =
		(leg.side === 'buy' && held.isNegative()) || (leg.side === 'sell' && held.isPositive());
	if (!conflictsWithExistingPosition) return;

	violations.push({
		code: 'position_effect_conflict',
		message: `A ${leg.side}-to-open order cannot reduce or cross the existing ${held.isPositive() ? 'long' : 'short'} ${leg.symbol} position`,
		symbol: leg.symbol
	});
}

function validateSupportedOptionOrder(leg: ResolvedOrderLeg, violations: RiskViolation[]): void {
	if (leg.instrument.assetClass !== 'options') return;
	const supported =
		(leg.side === 'buy' && leg.positionEffect === 'open') ||
		(leg.side === 'sell' && leg.positionEffect === 'close');
	if (supported) return;

	violations.push({
		code: 'unsupported_option_order',
		message: 'Option simulation supports buy-to-open and sell-to-close orders only',
		symbol: leg.symbol
	});
}

export function previewOrder(input: {
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	bars: ReadonlyMap<string, NormalizedBar>;
	account: PortfolioAccountState;
	executionModel: ExecutionModel;
	barContext: ExecutableBarContext;
	feeModel?: FeeModel;
}): OrderPreview {
	const draft = orderDraftSchema.parse(input.draft);
	const executionModel = executionModelSchema.parse(input.executionModel);
	const feeModel = feeModelSchema.parse(input.feeModel ?? {});
	const barContext = executableBarContextSchema.parse(input.barContext);
	const violations: RiskViolation[] = [];
	const previews: LegPreview[] = [];
	const resolvedLegs: ResolvedOrderLeg[] = [];
	const priceSpecified = ['limit', 'stop_limit'].includes(draft.type);
	const barSymbols = priceSpecified
		? []
		: draft.legs.flatMap((leg) =>
				input.instruments.get(leg.symbol)?.assetClass === 'stocks' ? [leg.symbol] : []
			);
	const invalidBarSymbols = validateRequiredBars(barSymbols, input.bars, barContext, violations);

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
		validatePositionEffectConsistency(leg, input.account, violations);
		validateSupportedOptionOrder(leg, violations);
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

		const requiresBar = instrument.assetClass === 'stocks' && !priceSpecified;
		const bar =
			requiresBar && !invalidBarSymbols.has(instrument.symbol)
				? input.bars.get(instrument.symbol)
				: undefined;
		const price = referencePrice(draft, leg, bar, executionModel);
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

	const optionCollateral = money(0);
	const shareCollateral = new Map<string, Decimal>();
	for (const preview of previews) {
		if (preview.leg.positionEffect === 'close') {
			addPositionReservation(shareCollateral, preview.leg.symbol, preview.quantity);
		}
	}
	const cashRequired = money(
		Decimal.max(estimatedNetCashChange.negated(), 0).plus(optionCollateral)
	);
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
