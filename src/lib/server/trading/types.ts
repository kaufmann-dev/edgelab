import Decimal from 'decimal.js';
import { z } from 'zod';
import { decimalSchema } from '../market-data/numeric';
import {
	instrumentSchema,
	marketDataModeSchema,
	type Instrument,
	type NormalizedQuote
} from '../market-data/types';

export const DEFAULT_EXECUTION_MODEL_VERSION = 'sim-execution-v1';
export const DEFAULT_RISK_MODEL_VERSION = 'risk-policy-v1';

export const orderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']);
export const orderSideSchema = z.enum(['buy', 'sell']);
export const positionEffectSchema = z.enum(['open', 'close']);
export const timeInForceSchema = z.enum(['day', 'gtc', 'ioc']);
export const netPriceEffectSchema = z.enum(['debit', 'credit']);
export const orderStatusSchema = z.enum([
	'pending_new',
	'open',
	'partially_filled',
	'filled',
	'canceled',
	'expired',
	'rejected'
]);

export type OrderType = z.infer<typeof orderTypeSchema>;
export type OrderSide = z.infer<typeof orderSideSchema>;
export type PositionEffect = z.infer<typeof positionEffectSchema>;
export type TimeInForce = z.infer<typeof timeInForceSchema>;
export type NetPriceEffect = z.infer<typeof netPriceEffectSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;

const positiveDecimalSchema = decimalSchema.refine((value) => value.greaterThan(0), {
	message: 'Value must be greater than zero'
});

export const orderLegDraftSchema = z
	.object({
		symbol: z.string().trim().toUpperCase().min(1).max(64),
		side: orderSideSchema,
		positionEffect: positionEffectSchema,
		ratioQuantity: positiveDecimalSchema.default(new Decimal(1))
	})
	.strict();

export const orderDraftSchema = z
	.object({
		portfolioId: z.uuid(),
		tradePlanId: z.uuid().optional(),
		clientOrderId: z.string().trim().min(1).max(128),
		type: orderTypeSchema,
		timeInForce: timeInForceSchema.default('day'),
		quantity: positiveDecimalSchema,
		limitPrice: positiveDecimalSchema.optional(),
		stopPrice: positiveDecimalSchema.optional(),
		trailingPercent: positiveDecimalSchema
			.refine((value) => value.lessThanOrEqualTo(100), 'Trailing percent cannot exceed 100')
			.optional(),
		netPriceEffect: netPriceEffectSchema.default('debit'),
		extendedHours: z.boolean().default(false),
		legs: z.array(orderLegDraftSchema).min(1).max(4)
	})
	.strict()
	.superRefine((order, context) => {
		const requirements: Record<OrderType, Array<'limitPrice' | 'stopPrice' | 'trailingPercent'>> = {
			market: [],
			limit: ['limitPrice'],
			stop: ['stopPrice'],
			stop_limit: ['stopPrice', 'limitPrice'],
			trailing_stop: ['trailingPercent']
		};
		for (const field of requirements[order.type]) {
			if (order[field] === undefined) {
				context.addIssue({
					code: 'custom',
					path: [field],
					message: `${field} is required for ${order.type} orders`
				});
			}
		}
		for (const field of ['limitPrice', 'stopPrice', 'trailingPercent'] as const) {
			if (!requirements[order.type].includes(field) && order[field] !== undefined) {
				context.addIssue({
					code: 'custom',
					path: [field],
					message: `${field} is not valid for ${order.type} orders`
				});
			}
		}
		if (order.type === 'market' && order.timeInForce === 'gtc') {
			context.addIssue({
				code: 'custom',
				path: ['timeInForce'],
				message: 'Market orders cannot be good-til-canceled'
			});
		}
		if (order.timeInForce === 'ioc' && !['market', 'limit'].includes(order.type)) {
			context.addIssue({
				code: 'custom',
				path: ['timeInForce'],
				message: 'Immediate-or-cancel supports only market and limit orders'
			});
		}
		if (order.extendedHours && order.type !== 'limit') {
			context.addIssue({
				code: 'custom',
				path: ['extendedHours'],
				message: 'Extended-hours orders must be limit orders'
			});
		}
		if (order.legs.length > 1 && !['market', 'limit'].includes(order.type)) {
			context.addIssue({
				code: 'custom',
				path: ['type'],
				message: 'Multi-leg orders support only market and limit types'
			});
		}
		const symbols = new Set<string>();
		for (const [index, leg] of order.legs.entries()) {
			if (symbols.has(leg.symbol)) {
				context.addIssue({
					code: 'custom',
					path: ['legs', index, 'symbol'],
					message: 'An instrument can appear only once in an order'
				});
			}
			symbols.add(leg.symbol);
		}
	});

export type OrderDraft = z.infer<typeof orderDraftSchema>;
export type OrderLegDraft = z.infer<typeof orderLegDraftSchema>;

export interface ResolvedOrderLeg extends OrderLegDraft {
	instrument: Instrument;
}

export interface AcceptedOrder extends Omit<OrderDraft, 'legs'> {
	id: string;
	status: OrderStatus;
	legs: ResolvedOrderLeg[];
	executionModelVersion: string;
	filledQuantity: Decimal;
	acceptedAt: Date;
	eligibleAt: Date;
	triggeredAt?: Date;
	trailingWatermark?: Decimal;
	trailingStopPrice?: Decimal;
	terminalAt?: Date;
	rejectionReason?: string;
	revision: number;
}

export const positionSchema = z
	.object({
		instrument: instrumentSchema,
		quantity: decimalSchema,
		averageCost: decimalSchema.refine((value) => !value.isNegative()),
		realizedPnl: decimalSchema.default(new Decimal(0))
	})
	.strict();

export type Position = z.infer<typeof positionSchema>;

export const riskPolicySchema = z
	.object({
		allowShortStock: z.boolean().default(false),
		allowNakedOptions: z.literal(false).default(false),
		maxOrderNotional: positiveDecimalSchema.optional(),
		maxPositionNotional: positiveDecimalSchema.optional(),
		maxOpenOrders: z.number().int().positive().default(100),
		maxOptionContractsPerOrder: z.number().int().positive().default(100),
		quoteMaxAgeMilliseconds: z.number().int().positive().default(60_000)
	})
	.strict();

export type RiskPolicy = z.infer<typeof riskPolicySchema>;

export interface PortfolioAccountState {
	portfolioId: string;
	cashBalance: Decimal;
	reservedCash: Decimal;
	positions: ReadonlyMap<string, Position>;
	reservedPositionQuantities: ReadonlyMap<string, Decimal>;
	openOrderCount: number;
	riskPolicy: RiskPolicy;
}

export const feeModelSchema = z
	.object({
		stockPerShare: decimalSchema.refine((value) => !value.isNegative()).default(new Decimal(0)),
		optionPerContract: decimalSchema.refine((value) => !value.isNegative()).default(new Decimal(0)),
		minimumPerOrder: decimalSchema.refine((value) => !value.isNegative()).default(new Decimal(0))
	})
	.strict();

export type FeeModel = z.infer<typeof feeModelSchema>;

export const executionModelSchema = z
	.object({
		version: z.string().trim().min(1).default(DEFAULT_EXECUTION_MODEL_VERSION),
		latencyMilliseconds: z.number().int().nonnegative().default(250),
		stockSlippageBps: decimalSchema.refine((value) => !value.isNegative()).default(new Decimal(0)),
		optionSlippageBps: decimalSchema.refine((value) => !value.isNegative()).default(new Decimal(0)),
		participationRate: decimalSchema
			.refine((value) => value.greaterThan(0) && value.lessThanOrEqualTo(1))
			.default(new Decimal('0.25'))
	})
	.strict();

export type ExecutionModel = z.infer<typeof executionModelSchema>;

export interface MarketMarks {
	quotes: ReadonlyMap<string, NormalizedQuote>;
}

export type RiskViolationCode =
	| 'instrument_not_found'
	| 'instrument_inactive'
	| 'unsupported_currency'
	| 'unsupported_multi_leg_strategy'
	| 'unsupported_option_deliverable'
	| 'invalid_quantity'
	| 'quote_unavailable'
	| 'quote_stale'
	| 'extended_hours_not_supported'
	| 'insufficient_cash'
	| 'insufficient_position'
	| 'short_stock_disabled'
	| 'uncovered_option'
	| 'order_notional_limit'
	| 'open_order_limit'
	| 'option_contract_limit';

export interface RiskViolation {
	code: RiskViolationCode;
	message: string;
	symbol?: string;
}

export interface LegPreview {
	leg: ResolvedOrderLeg;
	quantity: Decimal;
	referencePrice: Decimal;
	grossAmount: Decimal;
	fee: Decimal;
}

export interface OrderPreview {
	accepted: boolean;
	legs: LegPreview[];
	estimatedNetCashChange: Decimal;
	cashRequired: Decimal;
	optionCollateral: Decimal;
	shareCollateral: ReadonlyMap<string, Decimal>;
	orderNotional: Decimal;
	fees: Decimal;
	violations: RiskViolation[];
}

export interface FillLeg {
	leg: ResolvedOrderLeg;
	quantity: Decimal;
	price: Decimal;
	fee: Decimal;
}

export interface StrategyFill {
	orderId: string;
	portfolioId: string;
	strategyQuantity: Decimal;
	legs: FillLeg[];
	marketDataMode: z.infer<typeof marketDataModeSchema>;
	sourceEventKind: 'quote' | 'trade' | 'bar';
	sourceTime: Date;
	receivedAt: Date;
	sourceSequence?: string;
	executionModelVersion: string;
}
