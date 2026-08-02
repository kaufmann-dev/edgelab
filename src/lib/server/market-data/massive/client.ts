import { z } from 'zod';
import type { MassiveCapabilitySet } from '../capabilities';
import type {
	AssetClass,
	Instrument,
	MarketSnapshot,
	MarketDataMode,
	NormalizedBar,
	OptionInstrument,
	OptionSnapshot,
	StockInstrument
} from '../types';
import {
	normalizeMassiveAggregateBar,
	normalizeMassiveOptionContract,
	normalizeMassiveOptionSnapshot,
	normalizeMassiveStockInstrument,
	normalizeMassiveUnifiedSnapshot
} from './normalize';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Page<T> {
	items: T[];
	nextUrl?: string;
}

export interface AggregateRequest {
	assetClass: AssetClass;
	symbol: string;
	multiplier: number;
	timespan: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
	from: string;
	to: string;
	adjusted?: boolean;
	limit?: number;
}

export interface OptionContractFilters {
	underlyingSymbol: string;
	contractType?: 'call' | 'put';
	expirationDate?: string;
	expirationDateGte?: string;
	expirationDateLte?: string;
	strikePriceGte?: string;
	strikePriceLte?: string;
	expired?: boolean;
	limit?: number;
}

export interface OptionChainFilters {
	contractType?: 'call' | 'put';
	expirationDate?: string;
	expirationDateGte?: string;
	expirationDateLte?: string;
	strikePriceGte?: string;
	strikePriceLte?: string;
	limit?: number;
}

function requiredExecutionMode(
	capabilities: MassiveCapabilitySet,
	assetClass: AssetClass
): MarketDataMode {
	const mode = capabilities[assetClass].executionMode;
	if (!mode) throw new Error(`${assetClass} has no executable market-data clock`);
	return mode;
}

export interface MassiveMarketStatus {
	serverTime: Date;
	session: 'regular' | 'extended' | 'closed';
}

export interface MassiveMarketHoliday {
	date: string;
	exchange: 'NYSE' | 'NASDAQ';
	name: string;
	status: 'closed' | 'early-close';
	open?: Date;
	close?: Date;
}

export interface MarketDataRestProvider {
	searchStocks(query: string, limit?: number): Promise<Page<Instrument>>;
	getStock(symbol: string): Promise<StockInstrument>;
	getUnifiedSnapshots(symbols: string[]): Promise<Page<MarketSnapshot>>;
	getOptionContract(symbol: string): Promise<OptionInstrument>;
	getOptionContracts(filters: OptionContractFilters): Promise<Page<OptionInstrument>>;
	getOptionChain(
		underlyingSymbol: string,
		filters?: OptionChainFilters
	): Promise<Page<OptionSnapshot>>;
	getBars(request: AggregateRequest): Promise<Page<NormalizedBar>>;
}

const responseEnvelopeSchema = z
	.object({
		status: z.string().optional(),
		results: z.unknown().optional(),
		next_url: z.string().url().optional(),
		error: z.string().optional(),
		message: z.string().optional()
	})
	.passthrough();

const marketStatusSchema = z
	.object({
		market: z.string(),
		serverTime: z.string().datetime({ offset: true }),
		earlyHours: z.boolean().default(false),
		afterHours: z.boolean().default(false)
	})
	.passthrough();

const marketHolidaySchema = z
	.object({
		date: z.string().date(),
		exchange: z.enum(['NYSE', 'NASDAQ', 'OTC']),
		name: z.string(),
		status: z.enum(['closed', 'early-close']),
		open: z.string().datetime({ offset: true }).optional(),
		close: z.string().datetime({ offset: true }).optional()
	})
	.passthrough();

export class MassiveHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly retryAfterSeconds?: number
	) {
		super(message);
		this.name = 'MassiveHttpError';
	}
}

function appendParam(url: URL, key: string, value: unknown): void {
	if (value === undefined || value === null) return;
	url.searchParams.set(key, typeof value === 'boolean' ? String(value) : value.toString());
}

export class MassiveRestClient implements MarketDataRestProvider {
	readonly #apiKey: string;
	readonly #capabilities: MassiveCapabilitySet;
	readonly #fetch: FetchLike;
	readonly #baseUrl: string;

	constructor(input: {
		apiKey: string;
		capabilities: MassiveCapabilitySet;
		fetch?: FetchLike;
		baseUrl?: string;
	}) {
		if (!input.apiKey.trim()) throw new Error('Massive API key is required');
		this.#apiKey = input.apiKey;
		this.#capabilities = input.capabilities;
		this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
		this.#baseUrl = (input.baseUrl ?? 'https://api.massive.com').replace(/\/$/, '');
	}

	async #fetchJson(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
		const url = new URL(path, `${this.#baseUrl}/`);
		for (const [key, value] of Object.entries(params)) appendParam(url, key, value);

		const response = await this.#fetch(url, {
			headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: 'application/json' }
		});
		let raw: unknown;
		try {
			raw = (await response.json()) as unknown;
		} catch {
			throw new MassiveHttpError(response.status, 'Massive returned an invalid JSON response');
		}
		const envelope = responseEnvelopeSchema.safeParse(raw);
		if (!response.ok || (envelope.success && envelope.data.status === 'ERROR')) {
			const retryAfter = response.headers.get('retry-after');
			const message = envelope.success
				? (envelope.data.message ??
					envelope.data.error ??
					`Massive request failed (${response.status})`)
				: `Massive request failed (${response.status})`;
			throw new MassiveHttpError(
				response.status,
				message,
				retryAfter === null ? undefined : Number.parseInt(retryAfter, 10)
			);
		}
		return raw;
	}

	async #request(
		path: string,
		params: Record<string, unknown> = {}
	): Promise<{
		results: unknown;
		nextUrl?: string;
	}> {
		const raw = await this.#fetchJson(path, params);
		const envelope = responseEnvelopeSchema.parse(raw);

		return { results: envelope.results, nextUrl: envelope.next_url };
	}

	async getMarketStatus(): Promise<MassiveMarketStatus> {
		const status = marketStatusSchema.parse(await this.#fetchJson('/v1/marketstatus/now'));
		return {
			serverTime: new Date(status.serverTime),
			session:
				status.earlyHours || status.afterHours || status.market === 'extended-hours'
					? 'extended'
					: status.market === 'open'
						? 'regular'
						: 'closed'
		};
	}

	async getUpcomingMarketHolidays(): Promise<MassiveMarketHoliday[]> {
		const holidays = z
			.array(marketHolidaySchema)
			.parse(await this.#fetchJson('/v1/marketstatus/upcoming'));
		return holidays
			.filter(
				(holiday): holiday is typeof holiday & { exchange: 'NYSE' | 'NASDAQ' } =>
					holiday.exchange === 'NYSE' || holiday.exchange === 'NASDAQ'
			)
			.map((holiday) => ({
				date: holiday.date,
				exchange: holiday.exchange,
				name: holiday.name,
				status: holiday.status,
				open: holiday.open ? new Date(holiday.open) : undefined,
				close: holiday.close ? new Date(holiday.close) : undefined
			}));
	}

	async searchStocks(query: string, limit = 20): Promise<Page<Instrument>> {
		const response = await this.#request('/v3/reference/tickers', {
			market: 'stocks',
			locale: 'us',
			active: true,
			search: query,
			limit
		});
		const results = z.array(z.unknown()).parse(response.results ?? []);
		return {
			items: results.map((result) => normalizeMassiveStockInstrument(result)),
			nextUrl: response.nextUrl
		};
	}

	async getStock(symbol: string): Promise<StockInstrument> {
		const response = await this.#request(
			`/v3/reference/tickers/${encodeURIComponent(symbol.trim().toUpperCase())}`
		);
		return normalizeMassiveStockInstrument(response.results);
	}

	async getUnifiedSnapshots(symbols: string[]): Promise<Page<MarketSnapshot>> {
		if (symbols.length === 0) return { items: [] };
		if (symbols.length > 250)
			throw new Error('Massive unified snapshots accept at most 250 symbols');
		const response = await this.#request('/v3/snapshot', {
			'ticker.any_of': symbols.join(','),
			limit: symbols.length
		});
		const results = z.array(z.unknown()).parse(response.results ?? []);
		return {
			items: results.map((result) => {
				const type = z
					.object({ type: z.enum(['stocks', 'options']) })
					.passthrough()
					.parse(result).type;
				return normalizeMassiveUnifiedSnapshot(result, {
					mode: requiredExecutionMode(this.#capabilities, type)
				});
			}),
			nextUrl: response.nextUrl
		};
	}

	async getOptionContracts(filters: OptionContractFilters): Promise<Page<OptionInstrument>> {
		const response = await this.#request('/v3/reference/options/contracts', {
			underlying_ticker: filters.underlyingSymbol,
			contract_type: filters.contractType,
			expiration_date: filters.expirationDate,
			'expiration_date.gte': filters.expirationDateGte,
			'expiration_date.lte': filters.expirationDateLte,
			'strike_price.gte': filters.strikePriceGte,
			'strike_price.lte': filters.strikePriceLte,
			expired: filters.expired ?? false,
			limit: filters.limit ?? 250,
			sort: 'expiration_date',
			order: 'asc'
		});
		const results = z.array(z.unknown()).parse(response.results ?? []);
		return {
			items: results.map((result) =>
				normalizeMassiveOptionContract(result, filters.underlyingSymbol)
			),
			nextUrl: response.nextUrl
		};
	}

	async getOptionContract(symbol: string): Promise<OptionInstrument> {
		const response = await this.#request(
			`/v3/reference/options/contracts/${encodeURIComponent(symbol)}`
		);
		return normalizeMassiveOptionContract(response.results);
	}

	async getOptionChain(
		underlyingSymbol: string,
		filters: OptionChainFilters = {}
	): Promise<Page<OptionSnapshot>> {
		const response = await this.#request(
			`/v3/snapshot/options/${encodeURIComponent(underlyingSymbol)}`,
			{
				contract_type: filters.contractType,
				expiration_date: filters.expirationDate,
				'expiration_date.gte': filters.expirationDateGte,
				'expiration_date.lte': filters.expirationDateLte,
				'strike_price.gte': filters.strikePriceGte,
				'strike_price.lte': filters.strikePriceLte,
				limit: filters.limit ?? 250,
				sort: 'expiration_date',
				order: 'asc'
			}
		);
		const results = z.array(z.unknown()).parse(response.results ?? []);
		return {
			items: results.map((result) =>
				normalizeMassiveOptionSnapshot(result, {
					underlyingSymbol,
					mode: requiredExecutionMode(this.#capabilities, 'options')
				})
			),
			nextUrl: response.nextUrl
		};
	}

	async getBars(request: AggregateRequest): Promise<Page<NormalizedBar>> {
		const path = `/v2/aggs/ticker/${encodeURIComponent(request.symbol)}/range/${request.multiplier}/${request.timespan}/${encodeURIComponent(request.from)}/${encodeURIComponent(request.to)}`;
		const response = await this.#request(path, {
			adjusted: request.adjusted ?? true,
			sort: 'asc',
			limit: request.limit ?? 5_000
		});
		const results = z.array(z.unknown()).parse(response.results ?? []);
		return {
			items: results.map((result) =>
				normalizeMassiveAggregateBar(result, {
					assetClass: request.assetClass,
					symbol: request.symbol,
					mode: requiredExecutionMode(this.#capabilities, request.assetClass),
					interval: request.timespan,
					multiplier: request.multiplier
				})
			),
			nextUrl: response.nextUrl
		};
	}
}
