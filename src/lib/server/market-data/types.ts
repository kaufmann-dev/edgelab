import Decimal from 'decimal.js';
import { z } from 'zod';
import { decimalSchema } from './numeric';

export const assetClassSchema = z.enum(['stocks', 'options']);
export const marketDataModeSchema = z.enum(['realtime', 'delayed']);
export const optionTypeSchema = z.enum(['call', 'put']);

export type AssetClass = z.infer<typeof assetClassSchema>;
export type MarketDataMode = z.infer<typeof marketDataModeSchema>;
export type OptionType = z.infer<typeof optionTypeSchema>;

const eventBaseSchema = z.object({
	assetClass: assetClassSchema,
	symbol: z.string().trim().min(1),
	mode: marketDataModeSchema,
	sourceTime: z.date(),
	receivedAt: z.date(),
	rawTimestamp: z.string().min(1),
	sequence: z.string().optional()
});

export const normalizedQuoteSchema = eventBaseSchema
	.extend({
		kind: z.literal('quote'),
		bidPrice: decimalSchema.refine((value) => !value.isNegative(), 'Bid must be non-negative'),
		askPrice: decimalSchema.refine((value) => !value.isNegative(), 'Ask must be non-negative'),
		bidSize: decimalSchema.refine((value) => !value.isNegative(), 'Bid size must be non-negative'),
		askSize: decimalSchema.refine((value) => !value.isNegative(), 'Ask size must be non-negative'),
		bidExchange: z.number().int().nonnegative().optional(),
		askExchange: z.number().int().nonnegative().optional()
	})
	.strict();

export const normalizedTradeSchema = eventBaseSchema
	.extend({
		kind: z.literal('trade'),
		price: decimalSchema.refine((value) => value.greaterThan(0), 'Trade price must be positive'),
		size: decimalSchema.refine((value) => value.greaterThan(0), 'Trade size must be positive'),
		exchange: z.number().int().nonnegative().optional(),
		tradeId: z.string().optional(),
		conditions: z.array(z.number().int()).default([])
	})
	.strict();

export const barIntervalSchema = z.enum(['second', 'minute', 'hour', 'day', 'week', 'month']);
export type BarInterval = z.infer<typeof barIntervalSchema>;

export const normalizedBarSchema = eventBaseSchema
	.extend({
		kind: z.literal('bar'),
		interval: barIntervalSchema,
		startTime: z.date(),
		endTime: z.date(),
		open: decimalSchema.refine((value) => value.greaterThan(0), 'Open must be positive'),
		high: decimalSchema.refine((value) => value.greaterThan(0), 'High must be positive'),
		low: decimalSchema.refine((value) => value.greaterThan(0), 'Low must be positive'),
		close: decimalSchema.refine((value) => value.greaterThan(0), 'Close must be positive'),
		volume: decimalSchema.refine((value) => !value.isNegative(), 'Volume must be non-negative'),
		vwap: decimalSchema.optional(),
		transactions: z.number().int().nonnegative().optional()
	})
	.strict()
	.superRefine((bar, context) => {
		if (bar.high.lessThan(bar.low)) {
			context.addIssue({ code: 'custom', path: ['high'], message: 'High cannot be below low' });
		}
		if (bar.open.greaterThan(bar.high) || bar.open.lessThan(bar.low)) {
			context.addIssue({
				code: 'custom',
				path: ['open'],
				message: 'Open must be inside the range'
			});
		}
		if (bar.close.greaterThan(bar.high) || bar.close.lessThan(bar.low)) {
			context.addIssue({
				code: 'custom',
				path: ['close'],
				message: 'Close must be inside the range'
			});
		}
	});

export const normalizedLuldSchema = eventBaseSchema
	.extend({
		kind: z.literal('luld'),
		lowerBand: decimalSchema,
		upperBand: decimalSchema,
		indicators: z.array(z.number().int()),
		tape: z.number().int().optional()
	})
	.strict();

export const normalizedMarketEventSchema = z.discriminatedUnion('kind', [
	normalizedQuoteSchema,
	normalizedTradeSchema,
	normalizedBarSchema,
	normalizedLuldSchema
]);

export type NormalizedQuote = z.infer<typeof normalizedQuoteSchema>;
export type NormalizedTrade = z.infer<typeof normalizedTradeSchema>;
export type NormalizedBar = z.infer<typeof normalizedBarSchema>;
export type NormalizedLuld = z.infer<typeof normalizedLuldSchema>;
export type NormalizedMarketEvent = z.infer<typeof normalizedMarketEventSchema>;

const instrumentBaseSchema = z.object({
	symbol: z.string().trim().min(1),
	name: z.string().trim().min(1),
	currency: z.string().trim().toUpperCase().default('USD'),
	active: z.boolean().default(true),
	primaryExchange: z.string().optional()
});

export const stockInstrumentSchema = instrumentBaseSchema
	.extend({
		assetClass: z.literal('stocks'),
		tickerType: z.string().optional(),
		roundLot: decimalSchema.refine((value) => value.greaterThan(0)).default(new Decimal(100))
	})
	.strict();

export const additionalUnderlyingSchema = z
	.object({
		type: z.string().trim().min(1),
		underlying: z.string().trim().min(1),
		amount: decimalSchema
	})
	.strict();

export const optionInstrumentSchema = instrumentBaseSchema
	.extend({
		assetClass: z.literal('options'),
		underlyingSymbol: z.string().trim().min(1),
		optionType: optionTypeSchema,
		exerciseStyle: z.enum(['american', 'bermudan', 'european']),
		expirationDate: z.string().date(),
		strikePrice: decimalSchema.refine((value) => !value.isNegative()),
		multiplier: decimalSchema.refine((value) => value.greaterThan(0)),
		additionalUnderlyings: z.array(additionalUnderlyingSchema).default([])
	})
	.strict();

export const instrumentSchema = z.discriminatedUnion('assetClass', [
	stockInstrumentSchema,
	optionInstrumentSchema
]);

export type StockInstrument = z.infer<typeof stockInstrumentSchema>;
export type OptionInstrument = z.infer<typeof optionInstrumentSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;

export const optionGreeksSchema = z
	.object({
		delta: decimalSchema.optional(),
		gamma: decimalSchema.optional(),
		theta: decimalSchema.optional(),
		vega: decimalSchema.optional()
	})
	.strict();

export const optionSnapshotSchema = z
	.object({
		instrument: optionInstrumentSchema,
		mode: marketDataModeSchema,
		quote: normalizedQuoteSchema.optional(),
		lastTrade: normalizedTradeSchema.optional(),
		day: normalizedBarSchema.optional(),
		greeks: optionGreeksSchema.optional(),
		impliedVolatility: decimalSchema.optional(),
		openInterest: decimalSchema.optional(),
		underlyingPrice: decimalSchema.optional(),
		breakEvenPrice: decimalSchema.optional(),
		asOf: z.date()
	})
	.strict();

export type OptionSnapshot = z.infer<typeof optionSnapshotSchema>;

export const marketSnapshotSchema = z
	.object({
		assetClass: assetClassSchema,
		symbol: z.string().trim().min(1),
		name: z.string().optional(),
		marketStatus: z.enum(['open', 'closed', 'early_trading', 'late_trading']).optional(),
		mode: marketDataModeSchema,
		quote: normalizedQuoteSchema.optional(),
		lastTrade: normalizedTradeSchema.optional(),
		lastMinute: normalizedBarSchema.optional(),
		asOf: z.date()
	})
	.strict();

export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
