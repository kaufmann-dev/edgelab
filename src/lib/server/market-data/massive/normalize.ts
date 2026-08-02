import Decimal from 'decimal.js';
import { z } from 'zod';
import { decimalSchema } from '../numeric';
import {
	marketSnapshotSchema,
	normalizedBarSchema,
	normalizedLuldSchema,
	normalizedQuoteSchema,
	normalizedTradeSchema,
	optionInstrumentSchema,
	optionSnapshotSchema,
	stockInstrumentSchema,
	type AssetClass,
	type BarInterval,
	type Instrument,
	type MarketDataMode,
	type MarketSnapshot,
	type NormalizedBar,
	type NormalizedMarketEvent,
	type NormalizedQuote,
	type NormalizedTrade,
	type OptionInstrument,
	type OptionSnapshot
} from '../types';

const timestampInputSchema = z.union([z.string(), z.number().finite(), z.bigint()]);

const websocketQuoteSchema = z
	.object({
		ev: z.literal('Q'),
		sym: z.string().min(1),
		bp: decimalSchema,
		ap: decimalSchema,
		bs: decimalSchema,
		as: decimalSchema,
		bx: z.number().int().optional(),
		ax: z.number().int().optional(),
		t: timestampInputSchema,
		q: timestampInputSchema.optional()
	})
	.passthrough();

const websocketTradeSchema = z
	.object({
		ev: z.literal('T'),
		sym: z.string().min(1),
		p: decimalSchema,
		s: decimalSchema,
		x: z.number().int().optional(),
		i: z.union([z.string(), z.number()]).optional(),
		c: z.array(z.number().int()).optional(),
		t: timestampInputSchema,
		q: timestampInputSchema.optional()
	})
	.passthrough();

const websocketBarSchema = z
	.object({
		ev: z.enum(['A', 'AM']),
		sym: z.string().min(1),
		o: decimalSchema,
		h: decimalSchema,
		l: decimalSchema,
		c: decimalSchema,
		v: decimalSchema,
		dv: decimalSchema.optional(),
		vw: decimalSchema.optional(),
		s: timestampInputSchema,
		e: timestampInputSchema
	})
	.passthrough();

const websocketLuldSchema = z
	.object({
		ev: z.literal('LULD'),
		T: z.string().min(1),
		h: decimalSchema,
		l: decimalSchema,
		i: z.array(z.number().int()),
		z: z.number().int().optional(),
		t: timestampInputSchema,
		q: timestampInputSchema.optional()
	})
	.passthrough();

const rawOptionContractSchema = z
	.object({
		ticker: z.string().min(1),
		underlying_ticker: z.string().min(1).optional(),
		contract_type: z.enum(['call', 'put']),
		exercise_style: z.enum(['american', 'bermudan', 'european']).default('american'),
		expiration_date: z.string().date(),
		strike_price: decimalSchema,
		shares_per_contract: decimalSchema.default(new Decimal(100)),
		primary_exchange: z.string().optional(),
		additional_underlyings: z
			.array(
				z
					.object({
						type: z.string(),
						underlying: z.string(),
						amount: decimalSchema
					})
					.passthrough()
			)
			.default([])
	})
	.passthrough();

export class MarketDataParseError extends Error {
	readonly issues?: z.core.$ZodIssue[];

	constructor(message: string, issues?: z.core.$ZodIssue[]) {
		super(message);
		this.name = 'MarketDataParseError';
		this.issues = issues;
	}
}

function timestampText(value: z.input<typeof timestampInputSchema>): string {
	return typeof value === 'string' ? value : value.toString();
}

/**
 * Massive endpoints mix seconds, milliseconds, microseconds, and nanoseconds.
 * Magnitude is unambiguous for contemporary market timestamps, so conversion is centralized here.
 */
export function normalizeMassiveTimestamp(value: z.input<typeof timestampInputSchema>): Date {
	const parsed = timestampInputSchema.parse(value);
	const text = timestampText(parsed);
	if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
		const date = new Date(text);
		if (Number.isNaN(date.getTime())) throw new MarketDataParseError('Invalid Massive timestamp');
		return date;
	}

	const integerText = text.split('.')[0] ?? text;
	let epoch = BigInt(integerText);
	const absolute = epoch < 0n ? -epoch : epoch;
	if (absolute >= 100_000_000_000_000_000n) epoch /= 1_000_000n;
	else if (absolute >= 100_000_000_000_000n) epoch /= 1_000n;
	else if (absolute < 100_000_000_000n) epoch *= 1_000n;

	const milliseconds = Number(epoch);
	if (!Number.isFinite(milliseconds))
		throw new MarketDataParseError('Massive timestamp is out of range');
	const date = new Date(milliseconds);
	if (Number.isNaN(date.getTime())) throw new MarketDataParseError('Invalid Massive timestamp');
	return date;
}

function parseJsonPayload(payload: unknown): unknown {
	if (typeof payload === 'string') {
		try {
			return JSON.parse(payload) as unknown;
		} catch {
			throw new MarketDataParseError('Massive returned invalid JSON');
		}
	}
	if (payload instanceof ArrayBuffer) {
		return parseJsonPayload(new TextDecoder().decode(payload));
	}
	return payload;
}

function modeFromTimeframe(value: unknown, fallback: MarketDataMode): MarketDataMode {
	if (typeof value !== 'string') return fallback;
	const normalized = value.toUpperCase();
	if (normalized === 'REAL-TIME' || normalized === 'REALTIME') return 'realtime';
	if (normalized === 'DELAYED') return 'delayed';
	return fallback;
}

function sourceMetadata(
	timestamp: z.input<typeof timestampInputSchema>,
	sequence: z.input<typeof timestampInputSchema> | undefined,
	receivedAt: Date
) {
	return {
		sourceTime: normalizeMassiveTimestamp(timestamp),
		receivedAt,
		rawTimestamp: timestampText(timestamp),
		sequence: sequence === undefined ? undefined : timestampText(sequence)
	};
}

export function normalizeMassiveWebSocketFrame(
	payload: unknown,
	context: { assetClass: AssetClass; mode: MarketDataMode; receivedAt?: Date }
): NormalizedMarketEvent[] {
	const decoded = parseJsonPayload(payload);
	if (!Array.isArray(decoded))
		throw new MarketDataParseError('Massive WebSocket frame must be an array');
	const receivedAt = context.receivedAt ?? new Date();
	const events: NormalizedMarketEvent[] = [];

	for (const candidate of decoded) {
		if (typeof candidate !== 'object' || candidate === null) {
			throw new MarketDataParseError('Massive WebSocket event must be an object');
		}
		const eventType = 'ev' in candidate ? candidate.ev : undefined;
		if (eventType === 'status') continue;

		try {
			switch (eventType) {
				case 'Q': {
					const event = websocketQuoteSchema.parse(candidate);
					events.push(
						normalizedQuoteSchema.parse({
							kind: 'quote',
							assetClass: context.assetClass,
							symbol: event.sym,
							mode: context.mode,
							bidPrice: event.bp,
							askPrice: event.ap,
							bidSize: event.bs,
							askSize: event.as,
							bidExchange: event.bx,
							askExchange: event.ax,
							...sourceMetadata(event.t, event.q, receivedAt)
						})
					);
					break;
				}
				case 'T': {
					const event = websocketTradeSchema.parse(candidate);
					events.push(
						normalizedTradeSchema.parse({
							kind: 'trade',
							assetClass: context.assetClass,
							symbol: event.sym,
							mode: context.mode,
							price: event.p,
							size: event.s,
							exchange: event.x,
							tradeId: event.i?.toString(),
							conditions: event.c ?? [],
							...sourceMetadata(event.t, event.q, receivedAt)
						})
					);
					break;
				}
				case 'A':
				case 'AM': {
					const event = websocketBarSchema.parse(candidate);
					const endTime = normalizeMassiveTimestamp(event.e);
					events.push(
						normalizedBarSchema.parse({
							kind: 'bar',
							assetClass: context.assetClass,
							symbol: event.sym,
							mode: context.mode,
							interval: event.ev === 'A' ? 'second' : 'minute',
							startTime: normalizeMassiveTimestamp(event.s),
							endTime,
							open: event.o,
							high: event.h,
							low: event.l,
							close: event.c,
							volume: context.assetClass === 'stocks' ? (event.dv ?? event.v) : event.v,
							vwap: event.vw,
							sourceTime: endTime,
							receivedAt,
							rawTimestamp: timestampText(event.e)
						})
					);
					break;
				}
				case 'LULD': {
					if (context.assetClass !== 'stocks') break;
					const event = websocketLuldSchema.parse(candidate);
					events.push(
						normalizedLuldSchema.parse({
							kind: 'luld',
							assetClass: 'stocks',
							symbol: event.T,
							mode: context.mode,
							lowerBand: event.l,
							upperBand: event.h,
							indicators: event.i,
							tape: event.z,
							...sourceMetadata(event.t, event.q, receivedAt)
						})
					);
					break;
				}
				default:
					break;
			}
		} catch (error) {
			if (error instanceof z.ZodError) {
				throw new MarketDataParseError(`Invalid Massive ${String(eventType)} event`, error.issues);
			}
			throw error;
		}
	}

	return events;
}

export function normalizeMassiveOptionContract(
	input: unknown,
	underlyingFallback?: string
): OptionInstrument {
	const contract = rawOptionContractSchema.parse(input);
	const underlyingSymbol = contract.underlying_ticker ?? underlyingFallback;
	if (!underlyingSymbol) throw new MarketDataParseError('Option contract has no underlying ticker');

	return optionInstrumentSchema.parse({
		assetClass: 'options',
		symbol: contract.ticker,
		name: `${underlyingSymbol} ${contract.expiration_date} ${contract.strike_price.toFixed()} ${contract.contract_type}`,
		currency: 'USD',
		active: true,
		primaryExchange: contract.primary_exchange,
		underlyingSymbol,
		optionType: contract.contract_type,
		exerciseStyle: contract.exercise_style,
		expirationDate: contract.expiration_date,
		strikePrice: contract.strike_price,
		multiplier: contract.shares_per_contract,
		additionalUnderlyings: contract.additional_underlyings.map((item) => ({
			type: item.type,
			underlying: item.underlying,
			amount: item.amount
		}))
	});
}

export function normalizeMassiveStockInstrument(input: unknown): Instrument {
	const raw = z
		.object({
			ticker: z.string().min(1),
			name: z.string().min(1),
			currency_name: z.string().default('usd'),
			active: z.boolean().default(true),
			primary_exchange: z.string().optional(),
			type: z.string().optional(),
			round_lot: decimalSchema.default(new Decimal(100))
		})
		.passthrough()
		.parse(input);

	return stockInstrumentSchema.parse({
		assetClass: 'stocks',
		symbol: raw.ticker,
		name: raw.name,
		currency: raw.currency_name,
		active: raw.active,
		primaryExchange: raw.primary_exchange,
		tickerType: raw.type,
		roundLot: raw.round_lot
	});
}

function normalizeRestQuote(
	input: unknown,
	context: {
		assetClass: AssetClass;
		symbol: string;
		mode: MarketDataMode;
		receivedAt: Date;
	}
): NormalizedQuote | undefined {
	if (input === undefined || input === null) return undefined;
	const quote = z
		.object({
			bid: decimalSchema,
			ask: decimalSchema,
			bid_size: decimalSchema.default(new Decimal(0)),
			ask_size: decimalSchema.default(new Decimal(0)),
			bid_exchange: z.number().int().optional(),
			ask_exchange: z.number().int().optional(),
			last_updated: timestampInputSchema,
			timeframe: z.string().optional()
		})
		.passthrough()
		.safeParse(input);
	if (!quote.success) return undefined;

	return normalizedQuoteSchema.parse({
		kind: 'quote',
		assetClass: context.assetClass,
		symbol: context.symbol,
		mode: modeFromTimeframe(quote.data.timeframe, context.mode),
		bidPrice: quote.data.bid,
		askPrice: quote.data.ask,
		bidSize: quote.data.bid_size,
		askSize: quote.data.ask_size,
		bidExchange: quote.data.bid_exchange,
		askExchange: quote.data.ask_exchange,
		...sourceMetadata(quote.data.last_updated, undefined, context.receivedAt)
	});
}

function normalizeRestTrade(
	input: unknown,
	context: {
		assetClass: AssetClass;
		symbol: string;
		mode: MarketDataMode;
		receivedAt: Date;
	}
): NormalizedTrade | undefined {
	if (input === undefined || input === null) return undefined;
	const trade = z
		.object({
			price: decimalSchema,
			size: decimalSchema,
			exchange: z.number().int().optional(),
			id: z.union([z.string(), z.number()]).optional(),
			conditions: z.array(z.number().int()).optional(),
			last_updated: timestampInputSchema.optional(),
			sip_timestamp: timestampInputSchema.optional(),
			timeframe: z.string().optional()
		})
		.passthrough()
		.safeParse(input);
	if (!trade.success) return undefined;
	const timestamp = trade.data.last_updated ?? trade.data.sip_timestamp;
	if (timestamp === undefined) return undefined;

	return normalizedTradeSchema.parse({
		kind: 'trade',
		assetClass: context.assetClass,
		symbol: context.symbol,
		mode: modeFromTimeframe(trade.data.timeframe, context.mode),
		price: trade.data.price,
		size: trade.data.size,
		exchange: trade.data.exchange,
		tradeId: trade.data.id?.toString(),
		conditions: trade.data.conditions ?? [],
		...sourceMetadata(timestamp, undefined, context.receivedAt)
	});
}

function normalizeNamedBar(
	input: unknown,
	context: {
		assetClass: AssetClass;
		symbol: string;
		mode: MarketDataMode;
		interval: 'second' | 'minute' | 'day';
		receivedAt: Date;
		fallbackTimestamp: z.input<typeof timestampInputSchema>;
	}
): NormalizedBar | undefined {
	if (input === undefined || input === null) return undefined;
	const bar = z
		.object({
			open: decimalSchema,
			high: decimalSchema,
			low: decimalSchema,
			close: decimalSchema,
			volume: decimalSchema.default(new Decimal(0)),
			vwap: decimalSchema.optional(),
			last_updated: timestampInputSchema.optional(),
			transactions: z.number().int().optional()
		})
		.passthrough()
		.safeParse(input);
	if (!bar.success) return undefined;
	const timestamp = bar.data.last_updated ?? context.fallbackTimestamp;
	const endTime = normalizeMassiveTimestamp(timestamp);
	const intervalMilliseconds =
		context.interval === 'second' ? 1_000 : context.interval === 'minute' ? 60_000 : 86_400_000;

	return normalizedBarSchema.parse({
		kind: 'bar',
		assetClass: context.assetClass,
		symbol: context.symbol,
		mode: context.mode,
		interval: context.interval,
		startTime: new Date(endTime.getTime() - intervalMilliseconds),
		endTime,
		open: bar.data.open,
		high: bar.data.high,
		low: bar.data.low,
		close: bar.data.close,
		volume: bar.data.volume,
		vwap: bar.data.vwap,
		transactions: bar.data.transactions,
		sourceTime: endTime,
		receivedAt: context.receivedAt,
		rawTimestamp: timestampText(timestamp)
	});
}

function intervalEnd(startTime: Date, interval: BarInterval, multiplier = 1): Date {
	if (!Number.isInteger(multiplier) || multiplier <= 0) {
		throw new MarketDataParseError('Aggregate multiplier must be a positive integer');
	}
	if (interval === 'month') {
		const endTime = new Date(startTime);
		endTime.setUTCMonth(endTime.getUTCMonth() + multiplier);
		return endTime;
	}
	const baseMilliseconds: Record<Exclude<BarInterval, 'month'>, number> = {
		second: 1_000,
		minute: 60_000,
		hour: 3_600_000,
		day: 86_400_000,
		week: 604_800_000
	};
	return new Date(startTime.getTime() + baseMilliseconds[interval] * multiplier);
}

export function normalizeMassiveOptionSnapshot(
	input: unknown,
	context: { underlyingSymbol: string; mode: MarketDataMode; receivedAt?: Date }
): OptionSnapshot {
	const snapshot = z
		.object({
			details: rawOptionContractSchema,
			last_quote: z.unknown().optional(),
			last_trade: z.unknown().optional(),
			day: z.unknown().optional(),
			greeks: z
				.object({
					delta: decimalSchema.optional(),
					gamma: decimalSchema.optional(),
					theta: decimalSchema.optional(),
					vega: decimalSchema.optional()
				})
				.passthrough()
				.optional(),
			implied_volatility: decimalSchema.optional(),
			open_interest: decimalSchema.optional(),
			break_even_price: decimalSchema.optional(),
			underlying_asset: z
				.object({ price: decimalSchema.optional(), timeframe: z.string().optional() })
				.passthrough()
				.optional()
		})
		.passthrough()
		.parse(input);
	const receivedAt = context.receivedAt ?? new Date();
	const instrument = normalizeMassiveOptionContract(snapshot.details, context.underlyingSymbol);
	const quote = normalizeRestQuote(snapshot.last_quote, {
		assetClass: 'options',
		symbol: instrument.symbol,
		mode: context.mode,
		receivedAt
	});
	const lastTrade = normalizeRestTrade(snapshot.last_trade, {
		assetClass: 'options',
		symbol: instrument.symbol,
		mode: context.mode,
		receivedAt
	});
	const fallbackTimestamp =
		quote?.rawTimestamp ?? lastTrade?.rawTimestamp ?? receivedAt.getTime().toString();

	return optionSnapshotSchema.parse({
		instrument,
		mode: context.mode,
		quote,
		lastTrade,
		day: normalizeNamedBar(snapshot.day, {
			assetClass: 'options',
			symbol: instrument.symbol,
			mode: context.mode,
			interval: 'day',
			receivedAt,
			fallbackTimestamp
		}),
		greeks: snapshot.greeks,
		impliedVolatility: snapshot.implied_volatility,
		openInterest: snapshot.open_interest,
		underlyingPrice: snapshot.underlying_asset?.price,
		breakEvenPrice: snapshot.break_even_price,
		asOf: receivedAt
	});
}

export function normalizeMassiveUnifiedSnapshot(
	input: unknown,
	context: { mode: MarketDataMode; receivedAt?: Date }
): MarketSnapshot {
	const snapshot = z
		.object({
			ticker: z.string().min(1),
			type: z.enum(['stocks', 'options']),
			name: z.string().optional(),
			market_status: z.string().optional(),
			last_quote: z.unknown().optional(),
			last_trade: z.unknown().optional(),
			last_minute: z.unknown().optional(),
			session: z.object({ last_updated: timestampInputSchema.optional() }).passthrough().optional()
		})
		.passthrough()
		.parse(input);
	const receivedAt = context.receivedAt ?? new Date();
	const assetClass = snapshot.type;
	const quote = normalizeRestQuote(snapshot.last_quote, {
		assetClass,
		symbol: snapshot.ticker,
		mode: context.mode,
		receivedAt
	});
	const lastTrade = normalizeRestTrade(snapshot.last_trade, {
		assetClass,
		symbol: snapshot.ticker,
		mode: context.mode,
		receivedAt
	});
	const fallbackTimestamp =
		snapshot.session?.last_updated ??
		quote?.rawTimestamp ??
		lastTrade?.rawTimestamp ??
		receivedAt.getTime().toString();
	const knownMarketStatuses = ['open', 'closed', 'early_trading', 'late_trading'] as const;
	const marketStatus = knownMarketStatuses.find((status) => status === snapshot.market_status);

	return marketSnapshotSchema.parse({
		assetClass,
		symbol: snapshot.ticker,
		name: snapshot.name,
		marketStatus,
		mode: context.mode,
		quote,
		lastTrade,
		lastMinute: normalizeNamedBar(snapshot.last_minute, {
			assetClass,
			symbol: snapshot.ticker,
			mode: context.mode,
			interval: 'minute',
			receivedAt,
			fallbackTimestamp
		}),
		asOf: receivedAt
	});
}

export function normalizeMassiveAggregateBar(
	input: unknown,
	context: {
		assetClass: AssetClass;
		symbol: string;
		mode: MarketDataMode;
		interval: BarInterval;
		multiplier?: number;
		receivedAt?: Date;
	}
): NormalizedBar {
	const bar = z
		.object({
			o: decimalSchema,
			h: decimalSchema,
			l: decimalSchema,
			c: decimalSchema,
			v: decimalSchema.default(new Decimal(0)),
			vw: decimalSchema.optional(),
			t: timestampInputSchema,
			n: z.number().int().optional()
		})
		.passthrough()
		.parse(input);
	const startTime = normalizeMassiveTimestamp(bar.t);
	const endTime = intervalEnd(startTime, context.interval, context.multiplier);
	return normalizedBarSchema.parse({
		kind: 'bar',
		assetClass: context.assetClass,
		symbol: context.symbol,
		mode: context.mode,
		interval: context.interval,
		startTime,
		endTime,
		open: bar.o,
		high: bar.h,
		low: bar.l,
		close: bar.c,
		volume: bar.v,
		vwap: bar.vw,
		transactions: bar.n,
		sourceTime: endTime,
		receivedAt: context.receivedAt ?? new Date(),
		rawTimestamp: timestampText(bar.t)
	});
}
