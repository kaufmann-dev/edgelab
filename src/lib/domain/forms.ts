import { z } from 'zod';

const optionalPositiveMoney = (label: string) =>
	z.preprocess(
		(value) => (value === '' || value === null ? undefined : value),
		z.coerce
			.number({ error: `${label} must be a number` })
			.positive(`${label} must be greater than zero`)
			.max(1_000_000_000, `${label} is too large`)
			.optional()
	);

const optionalPercent = (label: string) =>
	z.preprocess(
		(value) => (value === '' || value === null ? undefined : value),
		z.coerce
			.number({ error: `${label} must be a number` })
			.positive(`${label} must be greater than zero`)
			.max(100, `${label} cannot exceed 100%`)
			.optional()
	);

export const createPortfolioSchema = z
	.object({
		name: z.string().trim().min(1, 'Enter a portfolio name').max(48, 'Use 48 characters or fewer'),
		startingCapital: z.coerce
			.number({ error: 'Starting capital must be a number' })
			.min(1_000, 'Starting capital must be at least $1,000')
			.max(100_000_000, 'Starting capital cannot exceed $100,000,000'),
		benchmarkSymbol: z
			.string()
			.trim()
			.toUpperCase()
			.regex(/^[A-Z][A-Z0-9.]{0,9}$/, 'Enter a valid US ticker')
			.default('SPY'),
		accountType: z.enum(['cash', 'margin']).default('cash'),
		dataMode: z.literal('real_time').default('real_time'),
		allowShortEquity: z.boolean().default(false),
		allowLongOptions: z.boolean().default(true),
		allowCoveredOptions: z.boolean().default(false),
		allowDefinedRiskSpreads: z.boolean().default(false),
		allowExtendedHours: z.boolean().default(false),
		requireTradePlan: z.boolean().default(false),
		maxOrderNotional: optionalPositiveMoney('Maximum order notional'),
		maxPositionPercent: optionalPercent('Maximum position size'),
		maxGrossExposurePercent: optionalPercent('Maximum gross exposure'),
		maxDailyLoss: optionalPositiveMoney('Maximum daily loss'),
		maxDrawdownPercent: optionalPercent('Maximum drawdown'),
		maxOptionPremium: optionalPositiveMoney('Maximum option premium'),
		riskBehavior: z.enum(['warn', 'block']).default('block'),
		acknowledgeSimulation: z.literal(true, {
			error: 'Confirm that this portfolio uses simulated money only'
		})
	})
	.superRefine((portfolio, context) => {
		if (portfolio.accountType === 'cash' && portfolio.allowShortEquity) {
			context.addIssue({
				code: 'custom',
				path: ['allowShortEquity'],
				message: 'Short selling requires a margin portfolio'
			});
		}
		if (portfolio.allowDefinedRiskSpreads && !portfolio.allowLongOptions) {
			context.addIssue({
				code: 'custom',
				path: ['allowDefinedRiskSpreads'],
				message: 'Defined-risk spreads require options permission'
			});
		}
	});

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;

export const stockOrderSchema = z
	.object({
		clientOrderId: z.uuid('Order receipt ID is invalid'),
		symbol: z
			.string()
			.trim()
			.toUpperCase()
			.regex(/^[A-Z][A-Z0-9.]{0,14}$/, 'Enter a valid ticker'),
		side: z.enum(['buy', 'sell']),
		positionEffect: z.enum(['open', 'close']),
		orderType: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']),
		quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
		limitPrice: optionalPositiveMoney('Limit price'),
		stopPrice: optionalPositiveMoney('Stop price'),
		trailValue: optionalPositiveMoney('Trail value'),
		trailUnit: z.enum(['amount', 'percent']).optional(),
		timeInForce: z.enum(['day', 'gtc', 'ioc']).default('day'),
		session: z.enum(['regular', 'extended']).default('regular'),
		tradePlanId: z.uuid().optional()
	})
	.superRefine((order, context) => {
		if ((order.orderType === 'limit' || order.orderType === 'stop_limit') && !order.limitPrice) {
			context.addIssue({
				code: 'custom',
				path: ['limitPrice'],
				message: 'A limit price is required for this order type'
			});
		}
		if ((order.orderType === 'stop' || order.orderType === 'stop_limit') && !order.stopPrice) {
			context.addIssue({
				code: 'custom',
				path: ['stopPrice'],
				message: 'A stop price is required for this order type'
			});
		}
		if (order.orderType === 'trailing_stop' && (!order.trailValue || !order.trailUnit)) {
			context.addIssue({
				code: 'custom',
				path: ['trailValue'],
				message: 'A trail amount or percentage is required'
			});
		}
		if (order.trailUnit === 'percent' && order.trailValue && order.trailValue > 100) {
			context.addIssue({
				code: 'custom',
				path: ['trailValue'],
				message: 'Trail percentage cannot exceed 100%'
			});
		}
		if (order.orderType === 'market' && order.timeInForce === 'gtc') {
			context.addIssue({
				code: 'custom',
				path: ['timeInForce'],
				message: 'Market orders cannot remain open until canceled'
			});
		}
		if (order.timeInForce === 'ioc' && !['market', 'limit'].includes(order.orderType)) {
			context.addIssue({
				code: 'custom',
				path: ['timeInForce'],
				message: 'IOC is available only for market and limit orders'
			});
		}
	});

export type StockOrderInput = z.infer<typeof stockOrderSchema>;

export const journalEntrySchema = z.object({
	symbol: z.string().trim().toUpperCase().max(20).optional(),
	phase: z.enum(['pre_trade', 'post_trade', 'general']),
	thesis: z.string().trim().max(4_000).optional(),
	invalidation: z.string().trim().max(1_000).optional(),
	notes: z.string().trim().min(1, 'Write at least one note').max(10_000),
	tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
	confidence: z.coerce.number().int().min(1).max(5).optional(),
	followedPlan: z.boolean().optional()
});

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
