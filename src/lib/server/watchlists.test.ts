import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
	MassiveHttpError,
	type MarketSnapshot,
	type NormalizedBar
} from '#lib/server/market-data/index.js';
import { hydrateWatchlistSnapshots } from './watchlist-market-data';
import { mergeWatchlistSnapshots, type SavedWatchlistItem } from './watchlists.logic';

function savedItem(overrides: Partial<SavedWatchlistItem> = {}): SavedWatchlistItem {
	return {
		id: '4fe902ce-08a1-4e8d-b7c7-ed92b73fd3f6',
		symbol: 'AAPL',
		name: 'Apple Inc.',
		primaryExchange: 'XNAS',
		addedAt: '2026-08-01T12:00:00.000Z',
		...overrides
	};
}

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
	const sourceTime = new Date('2026-08-01T12:05:00.000Z');
	return {
		assetClass: 'stocks',
		symbol: 'AAPL',
		name: 'Apple Inc.',
		marketStatus: 'open',
		mode: 'realtime',
		quote: {
			kind: 'quote',
			assetClass: 'stocks',
			symbol: 'AAPL',
			mode: 'realtime',
			bidPrice: new Decimal('213.12'),
			askPrice: new Decimal('213.15'),
			bidSize: new Decimal('4'),
			askSize: new Decimal('5'),
			sourceTime,
			receivedAt: new Date('2026-08-01T12:05:00.050Z'),
			rawTimestamp: String(sourceTime.getTime())
		},
		lastTrade: {
			kind: 'trade',
			assetClass: 'stocks',
			symbol: 'AAPL',
			mode: 'realtime',
			price: new Decimal('213.14'),
			size: new Decimal('10'),
			conditions: [],
			sourceTime,
			receivedAt: new Date('2026-08-01T12:05:00.075Z'),
			rawTimestamp: String(sourceTime.getTime())
		},
		asOf: new Date('2026-08-01T12:05:00.075Z'),
		...overrides
	};
}

function minuteBar(overrides: Partial<NormalizedBar> = {}): NormalizedBar {
	const startTime = new Date('2026-08-01T15:04:00.000Z');
	const endTime = new Date('2026-08-01T15:05:00.000Z');
	return {
		kind: 'bar',
		assetClass: 'stocks',
		symbol: 'AAPL',
		mode: 'delayed',
		interval: 'minute',
		startTime,
		endTime,
		open: new Decimal('212.8'),
		high: new Decimal('213.2'),
		low: new Decimal('212.7'),
		close: new Decimal('213.05'),
		volume: new Decimal(12_000),
		sourceTime: endTime,
		receivedAt: new Date('2026-08-01T15:20:42.000Z'),
		rawTimestamp: String(startTime.getTime()),
		...overrides
	};
}

describe('mergeWatchlistSnapshots', () => {
	it('serializes an available Massive snapshot without changing the saved row identity', () => {
		const [row] = mergeWatchlistSnapshots([savedItem()], [snapshot()], {
			quotes: true,
			trades: true
		});

		expect(row).toMatchObject({
			id: '4fe902ce-08a1-4e8d-b7c7-ed92b73fd3f6',
			symbol: 'AAPL',
			snapshot: {
				status: 'available',
				data: {
					mode: 'realtime',
					quote: { bidPrice: '213.12', askPrice: '213.15' },
					lastTrade: { price: '213.14' }
				}
			}
		});
	});

	it('omits raw quote and trade fields when the stock plan lacks those entitlements', () => {
		const [row] = mergeWatchlistSnapshots([savedItem()], [snapshot()], {
			quotes: false,
			trades: false
		});

		expect(row?.snapshot.status).toBe('available');
		if (row?.snapshot.status !== 'available') throw new Error('Expected an available snapshot');
		expect(row.snapshot.data.quote).toBeUndefined();
		expect(row.snapshot.data.lastTrade).toBeUndefined();
	});

	it('preserves every saved row with an explicit unavailable state when a snapshot is absent', () => {
		const items = [savedItem(), savedItem({ id: crypto.randomUUID(), symbol: 'MSFT' })];
		const rows = mergeWatchlistSnapshots(items, [snapshot()], { quotes: true, trades: true });

		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({
			symbol: 'MSFT',
			snapshot: {
				status: 'unavailable',
				reason: 'Massive returned no current snapshot for this symbol.'
			}
		});
	});
});

describe('hydrateWatchlistSnapshots', () => {
	it('loads a truthful completed-minute mark when a Starter snapshot has no price fields', async () => {
		const getUnifiedSnapshots = vi.fn(async () => ({
			items: [
				snapshot({
					mode: 'delayed',
					quote: undefined,
					lastTrade: undefined,
					lastMinute: undefined
				})
			]
		}));
		const getBars = vi.fn(async () => ({ items: [minuteBar()] }));

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row?.snapshot.status).toBe('available');
		if (row?.snapshot.status !== 'available') throw new Error('Expected an available snapshot');
		expect(row.snapshot.data).toMatchObject({
			quote: undefined,
			lastTrade: undefined,
			lastMinute: {
				interval: 'minute',
				close: '213.05',
				mode: 'delayed',
				sourceTime: '2026-08-01T15:05:00.000Z'
			}
		});
		expect(getBars).toHaveBeenCalledWith(
			expect.objectContaining({
				assetClass: 'stocks',
				symbol: 'AAPL',
				timespan: 'minute',
				from: String(Date.parse('2026-08-01T15:00:00.000Z')),
				to: String(Date.parse('2026-08-01T15:05:00.000Z') - 1)
			})
		);
	});

	it('replaces a non-minute snapshot aggregate with a verified completed minute', async () => {
		const getUnifiedSnapshots = vi.fn(async () => ({
			items: [
				snapshot({
					mode: 'delayed',
					quote: undefined,
					lastTrade: undefined,
					lastMinute: minuteBar({ interval: 'day' })
				})
			]
		}));
		const getBars = vi.fn(async () => ({ items: [minuteBar()] }));

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row?.snapshot.status).toBe('available');
		if (row?.snapshot.status !== 'available') throw new Error('Expected an available snapshot');
		expect(row.snapshot.data.lastMinute).toMatchObject({
			interval: 'minute',
			close: '213.05',
			sourceTime: '2026-08-01T15:05:00.000Z'
		});
	});

	it('does not reinterpret a daily aggregate as a completed-minute mark', async () => {
		const getUnifiedSnapshots = vi.fn(async () => ({ items: [] }));
		const getBars = vi.fn(async () => ({
			items: [
				minuteBar({
					interval: 'day',
					startTime: new Date('2026-08-01T00:00:00.000Z'),
					endTime: new Date('2026-08-02T00:00:00.000Z'),
					sourceTime: new Date('2026-08-02T00:00:00.000Z')
				})
			]
		}));

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row).toMatchObject({
			symbol: 'AAPL',
			snapshot: {
				status: 'unavailable',
				reason: 'Massive returned no current snapshot for this symbol.'
			}
		});
	});

	it('builds a minimal available snapshot when Massive omits a saved symbol', async () => {
		const getUnifiedSnapshots = vi.fn(async () => ({ items: [] }));
		const getBars = vi.fn(async () => ({ items: [minuteBar()] }));

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row?.snapshot.status).toBe('available');
		if (row?.snapshot.status !== 'available') throw new Error('Expected an available snapshot');
		expect(row.snapshot.data).toEqual({
			assetClass: 'stocks',
			symbol: 'AAPL',
			name: 'Apple Inc.',
			marketStatus: undefined,
			mode: 'delayed',
			quote: undefined,
			lastTrade: undefined,
			lastMinute: expect.objectContaining({
				interval: 'minute',
				close: '213.05',
				sourceTime: '2026-08-01T15:05:00.000Z'
			}),
			asOf: '2026-08-01T15:20:42.000Z'
		});
	});

	it('falls back to an aggregate-only row when the unified batch request fails', async () => {
		const getUnifiedSnapshots = vi.fn(async () => {
			throw new Error('snapshot outage');
		});
		const getBars = vi.fn(async () => ({ items: [minuteBar()] }));

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row).toMatchObject({
			snapshot: {
				status: 'available',
				data: {
					mode: 'delayed',
					lastMinute: { close: '213.05' }
				}
			}
		});
	});

	it.each([401, 403])(
		'does not hide a %i snapshot access failure behind aggregate data',
		async (status) => {
			const getUnifiedSnapshots = vi.fn(async () => {
				throw new MassiveHttpError(status, 'snapshot access denied');
			});
			const getBars = vi.fn(async () => ({ items: [minuteBar()] }));

			const [row] = await hydrateWatchlistSnapshots({
				items: [savedItem()],
				provider: { getUnifiedSnapshots, getBars },
				access: { quotes: false, trades: false },
				clock: { mode: 'delayed', delayMinutes: 15 },
				at: new Date('2026-08-01T15:20:42.000Z')
			});

			expect(row).toMatchObject({
				snapshot: {
					status: 'unavailable',
					reason: 'Massive denied market-data access for the configured credentials or stock plan.'
				}
			});
			expect(getBars).not.toHaveBeenCalled();
		}
	);

	it.each([401, 403])('surfaces a %i aggregate access failure', async (status) => {
		const getUnifiedSnapshots = vi.fn(async () => ({
			items: [
				snapshot({
					mode: 'delayed',
					quote: undefined,
					lastTrade: undefined,
					lastMinute: undefined
				})
			]
		}));
		const getBars = vi.fn(async () => {
			throw new MassiveHttpError(status, 'aggregate access denied');
		});

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row).toMatchObject({
			snapshot: {
				status: 'unavailable',
				reason: 'Massive denied market-data access for the configured credentials or stock plan.'
			}
		});
	});

	it('keeps the snapshot failure reason when neither endpoint provides a mark', async () => {
		const getUnifiedSnapshots = vi.fn(async () => {
			throw new Error('snapshot outage');
		});
		const getBars = vi.fn(async () => {
			throw new Error('aggregate outage');
		});

		const [row] = await hydrateWatchlistSnapshots({
			items: [savedItem()],
			provider: { getUnifiedSnapshots, getBars },
			access: { quotes: false, trades: false },
			clock: { mode: 'delayed', delayMinutes: 15 },
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(row).toMatchObject({
			snapshot: {
				status: 'unavailable',
				reason: 'Massive snapshots are temporarily unavailable; saved symbol remains available.'
			}
		});
	});
});
