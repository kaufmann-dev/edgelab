import Decimal from 'decimal.js';
import { money } from '../market-data/numeric';
import type { Instrument, NormalizedBar } from '../market-data/types';
import { usEquityMarketDate } from '../market-session';
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
import { type ExecutableBarContext, validateExecutableBar } from './bar-validation';

const BPS_DENOMINATOR = new Decimal(10_000);

function multiplier(instrument: Instrument): Decimal {
	return instrument.assetClass === 'options' ? instrument.multiplier : new Decimal(1);
}

export function applyExecutionSlippage(
	price: Decimal,
	leg: ResolvedOrderLeg,
	model: ExecutionModel
): Decimal {
	const adjustment = price.times(model.stockSlippageBps).dividedBy(BPS_DENOMINATOR);
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

function barCapacity(bar: NormalizedBar, leg: ResolvedOrderLeg, model: ExecutionModel): Decimal {
	let capacity = bar.volume.times(model.participationRate).dividedBy(leg.ratioQuantity);
	if (leg.instrument.assetClass === 'options') capacity = capacity.floor();
	return Decimal.max(capacity, 0);
}

interface RawBarFillEvaluation {
	price?: Decimal;
	triggered: boolean;
	applyMarketSlippage: boolean;
}

function rawLimitFillPrice(
	leg: ResolvedOrderLeg,
	limitPrice: Decimal,
	bar: NormalizedBar
): Decimal | undefined {
	if (leg.side === 'buy') {
		if (bar.open.lessThanOrEqualTo(limitPrice)) return bar.open;
		return bar.low.lessThanOrEqualTo(limitPrice) ? limitPrice : undefined;
	}
	if (bar.open.greaterThanOrEqualTo(limitPrice)) return bar.open;
	return bar.high.greaterThanOrEqualTo(limitPrice) ? limitPrice : undefined;
}

function rawBarFillPrice(order: AcceptedOrder, bar: NormalizedBar): RawBarFillEvaluation {
	const leg = order.legs[0];
	if (order.type === 'market') {
		return { price: bar.open, triggered: false, applyMarketSlippage: true };
	}
	if (order.type === 'limit' && order.limitPrice) {
		const price = rawLimitFillPrice(leg, order.limitPrice, bar);
		return {
			price:
				price && leg.instrument.assetClass === 'options' && leg.side === 'sell'
					? order.limitPrice
					: price,
			triggered: false,
			applyMarketSlippage: false
		};
	}
	if (order.type === 'stop' && order.triggeredAt) {
		return { price: bar.open, triggered: true, applyMarketSlippage: true };
	}
	if (order.type === 'stop_limit' && order.triggeredAt && order.limitPrice) {
		return {
			price: rawLimitFillPrice(leg, order.limitPrice, bar),
			triggered: true,
			applyMarketSlippage: false
		};
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
		if (!gapTriggered && !rangeTriggered) {
			return { triggered: false, applyMarketSlippage: false };
		}
		if (order.type === 'stop_limit') {
			if (!gapTriggered || !order.limitPrice) {
				return { triggered: true, applyMarketSlippage: false };
			}
			const respectsLimit =
				leg.side === 'buy'
					? bar.open.lessThanOrEqualTo(order.limitPrice)
					: bar.open.greaterThanOrEqualTo(order.limitPrice);
			return {
				price: respectsLimit ? bar.open : undefined,
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

function supportsBarFill(order: AcceptedOrder, bar: NormalizedBar): boolean {
	if (order.legs.length !== 1 || !order.legs[0]?.ratioQuantity.equals(1)) return false;
	const leg = order.legs[0];
	if (leg.instrument.assetClass === 'stocks') return true;
	return (
		order.type === 'limit' &&
		order.timeInForce === 'day' &&
		!order.extendedHours &&
		leg.instrument.multiplier.equals(100) &&
		leg.instrument.additionalUnderlyings.length === 0 &&
		((leg.side === 'buy' && leg.positionEffect === 'open') ||
			(leg.side === 'sell' && leg.positionEffect === 'close')) &&
		leg.instrument.expirationDate > usEquityMarketDate(bar.startTime)
	);
}

export function calculateBarFill(input: {
	order: AcceptedOrder;
	bar: NormalizedBar;
	executionModel: ExecutionModel;
	barContext: ExecutableBarContext;
	feeModel?: FeeModel;
}): BarFillEvaluation {
	const { order, bar } = input;
	if (!supportsBarFill(order, bar) || !['open', 'partially_filled'].includes(order.status)) {
		return { triggered: false };
	}
	const leg = order.legs[0];
	if (bar.symbol !== leg.symbol || bar.assetClass !== leg.instrument.assetClass) {
		return { triggered: false };
	}
	const validation = validateExecutableBar(bar, input.barContext, order.eligibleAt);
	if (!validation.executable) return { triggered: false };
	const executionModel = executionModelSchema.parse(input.executionModel);
	const feeModel = feeModelSchema.parse(input.feeModel ?? {});
	const evaluated = rawBarFillPrice(order, bar);
	if (!evaluated.price) return { triggered: evaluated.triggered };
	const remaining = order.quantity.minus(order.filledQuantity);
	const strategyQuantity = Decimal.min(remaining, barCapacity(bar, leg, executionModel));
	if (!strategyQuantity.greaterThan(0)) return { triggered: evaluated.triggered };
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
			sourceSequence: bar.sequence ?? bar.rawTimestamp,
			executionModelVersion: executionModel.version
		}
	};
}

export function fillGrossAmount(fill: FillLeg): Decimal {
	return money(fill.price.times(fill.quantity).times(multiplier(fill.leg.instrument)));
}
