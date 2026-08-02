import { describe, expect, it, vi } from 'vitest';
import { resolveMassiveCapabilities } from '../capabilities';
import { MassiveHttpError, MassiveRestClient, type FetchLike } from './client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers }
	});
}

describe('MassiveRestClient', () => {
	it('uses the documented stock-search query and server-side bearer authentication', async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			jsonResponse({
				status: 'OK',
				results: [
					{
						ticker: 'AAPL',
						name: 'Apple Inc.',
						currency_name: 'usd',
						active: true,
						round_lot: 100
					}
				]
			})
		);
		const client = new MassiveRestClient({
			apiKey: 'secret-key',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'advanced',
				optionsTier: 'developer'
			}),
			fetch
		});

		const page = await client.searchStocks('apple', 10);

		expect(page.items[0]?.symbol).toBe('AAPL');
		expect(fetch).toHaveBeenCalledOnce();
		const [input, init] = fetch.mock.calls[0] ?? [];
		const url = new URL(input as URL);
		expect(url.pathname).toBe('/v3/reference/tickers');
		expect(url.searchParams.get('market')).toBe('stocks');
		expect(url.searchParams.get('search')).toBe('apple');
		expect(url.searchParams.has('type')).toBe(false);
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
	});

	it('surfaces Massive errors and retry timing', async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			jsonResponse(
				{ status: 'ERROR', error: 'rate limit exceeded' },
				{ status: 429, headers: { 'retry-after': '7' } }
			)
		);
		const client = new MassiveRestClient({
			apiKey: 'secret-key',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'advanced',
				optionsTier: 'advanced'
			}),
			fetch
		});

		const error = await client.searchStocks('AAPL').catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(MassiveHttpError);
		expect(error).toMatchObject({ status: 429, retryAfterSeconds: 7 });
		expect((error as Error).message).toBe('rate limit exceeded');
	});

	it('loads an exact stock without relying on fuzzy search pagination', async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			jsonResponse({
				status: 'OK',
				results: {
					ticker: 'META',
					name: 'Meta Platforms, Inc. Class A Common Stock',
					currency_name: 'usd',
					active: true,
					primary_exchange: 'XNAS',
					type: 'CS'
				}
			})
		);
		const client = new MassiveRestClient({
			apiKey: 'secret-key',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'starter',
				optionsTier: 'none'
			}),
			fetch
		});

		await expect(client.getStock(' meta ')).resolves.toMatchObject({
			symbol: 'META',
			name: 'Meta Platforms, Inc. Class A Common Stock',
			active: true,
			primaryExchange: 'XNAS',
			tickerType: 'CS'
		});
		expect(new URL(fetch.mock.calls[0]?.[0] as URL).pathname).toBe('/v3/reference/tickers/META');
	});

	it('loads an exact option contract without guessing its underlying', async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			jsonResponse({
				status: 'OK',
				results: {
					ticker: 'O:AAPL260918C00200000',
					underlying_ticker: 'AAPL',
					contract_type: 'call',
					exercise_style: 'american',
					expiration_date: '2026-09-18',
					strike_price: 200,
					shares_per_contract: 100
				}
			})
		);
		const client = new MassiveRestClient({
			apiKey: 'secret-key',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'advanced',
				optionsTier: 'advanced'
			}),
			fetch
		});

		const contract = await client.getOptionContract('O:AAPL260918C00200000');

		expect(contract).toMatchObject({
			symbol: 'O:AAPL260918C00200000',
			underlyingSymbol: 'AAPL',
			optionType: 'call',
			expirationDate: '2026-09-18'
		});
		const [input] = fetch.mock.calls[0] ?? [];
		expect(new URL(input as URL).pathname).toBe(
			'/v3/reference/options/contracts/O%3AAAPL260918C00200000'
		);
	});

	it('normalizes the raw market-status response', async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			jsonResponse({
				market: 'extended-hours',
				serverTime: '2026-08-03T17:30:00-04:00',
				earlyHours: false,
				afterHours: true
			})
		);
		const client = new MassiveRestClient({
			apiKey: 'secret-key',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'advanced',
				optionsTier: 'advanced'
			}),
			fetch
		});

		const status = await client.getMarketStatus();

		expect(status).toEqual({
			serverTime: new Date('2026-08-03T21:30:00.000Z'),
			session: 'extended'
		});
		expect(new URL(fetch.mock.calls[0]?.[0] as URL).pathname).toBe('/v1/marketstatus/now');
	});

	it('keeps NYSE and Nasdaq holiday closures and early-close boundaries', async () => {
		const fetch = vi.fn<FetchLike>(async () =>
			jsonResponse([
				{
					date: '2026-11-26',
					exchange: 'NYSE',
					name: 'Thanksgiving',
					status: 'closed'
				},
				{
					date: '2026-11-27',
					exchange: 'NASDAQ',
					name: 'Thanksgiving',
					status: 'early-close',
					open: '2026-11-27T14:30:00.000Z',
					close: '2026-11-27T18:00:00.000Z'
				},
				{
					date: '2026-11-26',
					exchange: 'OTC',
					name: 'Thanksgiving',
					status: 'closed'
				}
			])
		);
		const client = new MassiveRestClient({
			apiKey: 'secret-key',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'advanced',
				optionsTier: 'advanced'
			}),
			fetch
		});

		const holidays = await client.getUpcomingMarketHolidays();

		expect(holidays).toHaveLength(2);
		expect(holidays[1]).toMatchObject({
			exchange: 'NASDAQ',
			status: 'early-close',
			open: new Date('2026-11-27T14:30:00.000Z'),
			close: new Date('2026-11-27T18:00:00.000Z')
		});
	});
});
