import Decimal from 'decimal.js';
import { money } from '../market-data/numeric';
import type {
	Instrument,
	NormalizedBar,
	NormalizedQuote,
	NormalizedTrade
} from '../market-data/types';
import {
	executionModelSchema,
	feeModelSchema,
	type AcceptedOrder,
	type ExecutionModel,
	type FeeModel,
	type FillLeg,
	type ResolvedOrderLeg,
	type StrategyFill
} from './types';
import { type ExecutableQuoteContext, validateExecutableQuotes } from './quote-validation';

const BPS_DENOMINATOR = new Decimal(10_000);

function multiplier(instrument: Instrument): Decimal {
	return instrument.assetClass === 'options' ? instrument.multiplier : new Decimal(1);
}

function slippageBps(instrument: Instrument, model: ExecutionModel): Decimal {
	return instrument.assetClass === 'options' ? model.optionSlippageBps : model.stockSlippageBps;
}

export function applyExecutionSlippage(
	price: Decimal,
	leg: ResolvedOrderLeg,
	model: ExecutionModel
): Decimal {
	const adjustment = price.times(slippageBps(leg.instrument, model)).dividedBy(BPS_DENOMINATOR);
	return money(leg.side === 'buy' ? price.plus(adjustment) : price.minus(adjustment));
}

function perLegFee(instrument: Instrument, quantity: Decimal, model: FeeModel): Decimal {
	return money(
		instrument.assetClass === 'stocks'
			? model.stockPerShare.times(quantity)
			: model.optionPerContract.times(quantity)
	);
}

function allocateFees(legs: FillLeg[], model: FeeModel): FillLeg[] {
	const total = legs.reduce((sum, leg) => sum.plus(leg.fee), new Decimal(0));
	if (legs.length === 0 || total.greaterThanOrEqualTo(model.minimumPerOrder)) return legs;
	const difference = model.minimumPerOrder.minus(total);
	return legs.map((leg, index) => (index === 0 ? { ...leg, fee: leg.fee.plus(difference) } : leg));
}

function quoteCapacity(
	leg: ResolvedOrderLeg,
	quote: NormalizedQuote,
	model: ExecutionModel
): Decimal {
	const displayed = leg.side === 'buy' ? quote.askSize : quote.bidSize;
	const normalizedDisplayed =
		leg.instrument.assetClass === 'stocks' ? displayed.times(leg.instrument.roundLot) : displayed;
	let available = normalizedDisplayed.times(model.participationRate).dividedBy(leg.ratioQuantity);
	if (leg.instrument.assetClass === 'options') {
		available = available.floor();
		if (available.isZero() && normalizedDisplayed.greaterThanOrEqualTo(leg.ratioQuantity)) {
			available = new Decimal(1);
		}
	}
	return Decimal.max(available, 0);
}

function rawSingleLegPriceIsMarketable(order: AcceptedOrder, rawPrice: Decimal): boolean {
	if (!['limit', 'stop_limit'].includes(order.type) || !order.limitPrice) return true;
	return order.legs[0].side === 'buy'
		? rawPrice.lessThanOrEqualTo(order.limitPrice)
		: rawPrice.greaterThanOrEqualTo(order.limitPrice);
}

function clampSingleLegPriceToLimit(order: AcceptedOrder, price: Decimal): Decimal {
	if (!['limit', 'stop_limit'].includes(order.type) || !order.limitPrice) return price;
	return money(
		order.legs[0].side === 'buy'
			? Decimal.min(price, order.limitPrice)
			: Decimal.max(price, order.limitPrice)
	);
}

function respectsNetLimit(order: AcceptedOrder, legs: FillLeg[]): boolean {
	if (order.type !== 'limit' || !order.limitPrice) return true;
	const netPrice = legs.reduce((net, fill) => {
		const price = fill.price.times(fill.leg.ratioQuantity);
		return fill.leg.side === 'buy' ? net.plus(price) : net.minus(price);
	}, new Decimal(0));
	return order.netPriceEffect === 'debit'
		? netPrice.lessThanOrEqualTo(order.limitPrice)
		: netPrice.negated().greaterThanOrEqualTo(order.limitPrice);
}

function latestDate(dates: Date[]): Date {
	return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export function calculateQuoteFill(input: {
	order: AcceptedOrder;
	quotes: ReadonlyMap<string, NormalizedQuote>;
	executionModel: ExecutionModel;
	quoteContext: ExecutableQuoteContext;
	feeModel?: FeeModel;
}): StrategyFill | undefined {
	const { order } = input;
	if (!['open', 'partially_filled'].includes(order.status)) return undefined;
	if (['stop', 'stop_limit', 'trailing_stop'].includes(order.type) && !order.triggeredAt) {
		return undefined;
	}
	const executionModel = executionModelSchema.parse(input.executionModel);
	const feeModel = feeModelSchema.parse(input.feeModel ?? {});
	const quotes = order.legs.map((leg) => input.quotes.get(leg.symbol));
	if (quotes.some((quote) => !quote)) return undefined;
	const resolvedQuotes = quotes as NormalizedQuote[];
	const quoteValidation = validateExecutableQuotes(resolvedQuotes, input.quoteContext);
	if (!quoteValidation.executable) return undefined;
	if (input.quoteContext.attemptAt < order.eligibleAt) return undefined;
	if (resolvedQuotes.some((quote) => quote.receivedAt < order.eligibleAt)) return undefined;
	const rawPrices = order.legs.map((leg, index) =>
		leg.side === 'buy' ? resolvedQuotes[index].askPrice : resolvedQuotes[index].bidPrice
	);
	if (order.legs.length === 1 && !rawSingleLegPriceIsMarketable(order, rawPrices[0])) {
		return undefined;
	}

	const remaining = order.quantity.minus(order.filledQuantity);
	const capacity = order.legs.reduce((available, leg, index) => {
		const quote = resolvedQuotes[index];
		return Decimal.min(available, quoteCapacity(leg, quote, executionModel));
	}, remaining);
	const strategyQuantity = Decimal.min(remaining, capacity);
	if (!strategyQuantity.greaterThan(0)) return undefined;

	let legs = order.legs.map((leg, index): FillLeg => {
		const quantity = strategyQuantity.times(leg.ratioQuantity);
		const slippedPrice = applyExecutionSlippage(rawPrices[index], leg, executionModel);
		return {
			leg,
			quantity,
			price:
				order.legs.length === 1 ? clampSingleLegPriceToLimit(order, slippedPrice) : slippedPrice,
			fee: perLegFee(leg.instrument, quantity, feeModel)
		};
	});
	if (order.legs.length > 1 && !respectsNetLimit(order, legs)) return undefined;
	legs = allocateFees(legs, feeModel);

	const sourceTime = latestDate(resolvedQuotes.map((quote) => quote.sourceTime));
	const receivedAt = latestDate(resolvedQuotes.map((quote) => quote.receivedAt));
	return {
		orderId: order.id,
		portfolioId: order.portfolioId,
		strategyQuantity,
		legs,
		marketDataMode: input.quoteContext.expectedMode,
		sourceEventKind: 'quote',
		sourceTime,
		receivedAt,
		sourceSequence: resolvedQuotes.map((quote) => quote.sequence ?? '-').join(','),
		executionModelVersion: executionModel.version
	};
}

export interface TrailingStopState {
	watermark: Decimal;
	stopPrice: Decimal;
	triggered: boolean;
}

export function evaluateStopTrigger(input: {
	order: AcceptedOrder;
	trade: NormalizedTrade;
	state?: TrailingStopState;
}): TrailingStopState | undefined {
	const { order, trade } = input;
	if (order.legs.length !== 1 || trade.symbol !== order.legs[0].symbol) return input.state;
	const leg = order.legs[0];
	if (order.type === 'stop' || order.type === 'stop_limit') {
		if (!order.stopPrice) return input.state;
		const triggered =
			leg.side === 'buy'
				? trade.price.greaterThanOrEqualTo(order.stopPrice)
				: trade.price.lessThanOrEqualTo(order.stopPrice);
		return { watermark: trade.price, stopPrice: order.stopPrice, triggered };
	}
	if (order.type !== 'trailing_stop' || !order.trailingPercent) return input.state;

	const watermark = input.state
		? leg.side === 'sell'
			? Decimal.max(input.state.watermark, trade.price)
			: Decimal.min(input.state.watermark, trade.price)
		: trade.price;
	const fraction = order.trailingPercent.dividedBy(100);
	const stopPrice = money(
		leg.side === 'sell'
			? watermark.times(new Decimal(1).minus(fraction))
			: watermark.times(new Decimal(1).plus(fraction))
	);
	const triggered =
		leg.side === 'sell'
			? trade.price.lessThanOrEqualTo(stopPrice)
			: trade.price.greaterThanOrEqualTo(stopPrice);
	return { watermark, stopPrice, triggered };
}

function barCapacity(bar: NormalizedBar, leg: ResolvedOrderLeg, model: ExecutionModel): Decimal {
	let capacity = bar.volume.times(model.participationRate).dividedBy(leg.ratioQuantity);
	if (leg.instrument.assetClass === 'options') capacity = capacity.floor();
	return Decimal.max(capacity, 0);
}

function rawBarFillPrice(
	order: AcceptedOrder,
	bar: NormalizedBar
): { price?: Decimal; triggered: boolean; applyMarketSlippage: boolean } {
	const leg = order.legs[0];
	if (order.type === 'market')
		return { price: bar.open, triggered: true, applyMarketSlippage: true };
	if (order.type === 'limit' && order.limitPrice) {
		if (leg.side === 'buy') {
			if (bar.open.lessThanOrEqualTo(order.limitPrice)) {
				return { price: bar.open, triggered: true, applyMarketSlippage: false };
			}
			if (bar.low.lessThanOrEqualTo(order.limitPrice)) {
				return { price: order.limitPrice, triggered: true, applyMarketSlippage: false };
			}
		} else {
			if (bar.open.greaterThanOrEqualTo(order.limitPrice)) {
				return { price: bar.open, triggered: true, applyMarketSlippage: false };
			}
			if (bar.high.greaterThanOrEqualTo(order.limitPrice)) {
				return { price: order.limitPrice, triggered: true, applyMarketSlippage: false };
			}
		}
		return { triggered: false, applyMarketSlippage: false };
	}
	if ((order.type === 'stop' || order.type === 'stop_limit') && order.stopPrice) {
		const gapTriggered =
			leg.side === 'buy'
				? bar.open.greaterThanOrEqualTo(order.stopPrice)
				: bar.open.lessThanOrEqualTo(order.stopPrice);
		const rangeTriggered =
			leg.side === 'buy'
				? bar.high.greaterThanOrEqualTo(order.stopPrice)
				: bar.low.lessThanOrEqualTo(order.stopPrice);
		if (!gapTriggered && !rangeTriggered) return { triggered: false, applyMarketSlippage: false };
		if (order.type === 'stop_limit') {
			if (!order.triggeredAt && !gapTriggered) {
				return { triggered: true, applyMarketSlippage: false };
			}
			if (!order.limitPrice) return { triggered: true, applyMarketSlippage: false };
			const candidate = gapTriggered ? bar.open : order.limitPrice;
			const respectsLimit =
				leg.side === 'buy'
					? candidate.lessThanOrEqualTo(order.limitPrice)
					: candidate.greaterThanOrEqualTo(order.limitPrice);
			return {
				price: respectsLimit ? candidate : undefined,
				triggered: true,
				applyMarketSlippage: false
			};
		}
		return {
			price: gapTriggered ? bar.open : order.stopPrice,
			triggered: true,
			applyMarketSlippage: true
		};
	}
	return { triggered: false, applyMarketSlippage: false };
}

export interface BarFillEvaluation {
	triggered: boolean;
	fill?: StrategyFill;
}

export function calculateBarFill(input: {
	order: AcceptedOrder;
	bar: NormalizedBar;
	executionModel: ExecutionModel;
	feeModel?: FeeModel;
}): BarFillEvaluation {
	const { order, bar } = input;
	if (order.legs.length !== 1 || !['open', 'partially_filled'].includes(order.status)) {
		return { triggered: false };
	}
	if (bar.symbol !== order.legs[0].symbol || bar.startTime < order.eligibleAt) {
		return { triggered: false };
	}
	const executionModel = executionModelSchema.parse(input.executionModel);
	const feeModel = feeModelSchema.parse(input.feeModel ?? {});
	const evaluated = rawBarFillPrice(order, bar);
	if (!evaluated.price) return { triggered: evaluated.triggered };
	const remaining = order.quantity.minus(order.filledQuantity);
	const strategyQuantity = Decimal.min(remaining, barCapacity(bar, order.legs[0], executionModel));
	if (!strategyQuantity.greaterThan(0)) return { triggered: evaluated.triggered };
	const leg = order.legs[0];
	const quantity = strategyQuantity.times(leg.ratioQuantity);
	const price = evaluated.applyMarketSlippage
		? applyExecutionSlippage(evaluated.price, leg, executionModel)
		: money(evaluated.price);
	const fillLeg: FillLeg = {
		leg,
		quantity,
		price,
		fee: perLegFee(leg.instrument, quantity, feeModel)
	};
	const legs = allocateFees([fillLeg], feeModel);
	return {
		triggered: evaluated.triggered,
		fill: {
			orderId: order.id,
			portfolioId: order.portfolioId,
			strategyQuantity,
			legs,
			marketDataMode: bar.mode,
			sourceEventKind: 'bar',
			sourceTime: bar.sourceTime,
			receivedAt: bar.receivedAt,
			sourceSequence: bar.sequence,
			executionModelVersion: executionModel.version
		}
	};
}

export function fillGrossAmount(fill: FillLeg): Decimal {
	return money(fill.price.times(fill.quantity).times(multiplier(fill.leg.instrument)));
}
