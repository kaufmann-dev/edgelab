import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Instrument, MarketSnapshot, StockInstrument } from '$lib/server/market-data';
import {
	mergeWatchlistSnapshots,
	resolveExactActiveStock,
	type SavedWatchlistItem
} from './watchlists.logic';

function stock(overrides: Partial<StockInstrument> = {}): StockInstrument {
	return {
		assetClass: 'stocks',
		symbol: 'AAPL',
		name: 'Apple Inc.',
		currency: 'USD',
		active: true,
		primaryExchange: 'XNAS',
		tickerType: 'CS',
		roundLot: new Decimal(100),
		...overrides
	};
}

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

describe('resolveExactActiveStock', () => {
	it('normalizes the requested symbol and returns only an exact active stock', () => {
		const instruments: Instrument[] = [
			stock({ symbol: 'AAPL.WS', name: 'Apple warrant' }),
			stock(),
			stock({ symbol: 'MSFT', name: 'Microsoft Corp.' })
		];

		expect(resolveExactActiveStock(instruments, ' aapl ')?.name).toBe('Apple Inc.');
	});

	it('rejects inactive and partial search matches', () => {
		const instruments: Instrument[] = [
			stock({ active: false }),
			stock({ symbol: 'AAPL.WS', name: 'Apple warrant' })
		];

		expect(resolveExactActiveStock(instruments, 'AAPL')).toBeNull();
	});
});

describe('mergeWatchlistSnapshots', () => {
	it('serializes an available Massive snapshot without changing the saved row identity', () => {
		const [row] = mergeWatchlistSnapshots([savedItem()], [snapshot()]);

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

	it('preserves every saved row with an explicit unavailable state when a snapshot is absent', () => {
		const items = [savedItem(), savedItem({ id: crypto.randomUUID(), symbol: 'MSFT' })];
		const rows = mergeWatchlistSnapshots(items, [snapshot()]);

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
