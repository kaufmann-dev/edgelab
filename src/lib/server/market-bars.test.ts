import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type {
	AssetClass,
	MarketDataRestProvider,
	MarketSnapshot,
	NormalizedBar
} from '#lib/server/market-data/index.js';
import {
	completedMinuteEnd,
	completedSnapshotMinuteBar,
	loadLatestCompletedMinuteBar
} from './market-bars';

function bar(start: string, assetClass: AssetClass = 'stocks', symbol = 'AAPL'): NormalizedBar {
	const startTime = new Date(start);
	const endTime = new Date(startTime.getTime() + 60_000);
	return {
		kind: 'bar',
		assetClass,
		symbol,
		mode: 'delayed',
		interval: 'minute',
		startTime,
		endTime,
		open: new Decimal(100),
		high: new Decimal(101),
		low: new Decimal(99),
		close: new Decimal('100.5'),
		volume: new Decimal(1_000),
		sourceTime: endTime,
		receivedAt: new Date('2026-08-01T15:20:30.000Z'),
		rawTimestamp: String(startTime.getTime())
	};
}

describe('completed aggregate lookup', () => {
	it('calculates the latest complete minute on the delayed logical clock', () => {
		expect(completedMinuteEnd(new Date('2026-08-01T15:20:42.000Z'), 15).toISOString()).toBe(
			'2026-08-01T15:05:00.000Z'
		);
	});

	it('selects the newest completed provider bar and excludes the current minute', async () => {
		const getBars = vi.fn(async () => ({
			items: [
				bar('2026-08-01T15:03:00.000Z'),
				bar('2026-08-01T15:04:00.000Z'),
				bar('2026-08-01T15:05:00.000Z')
			]
		}));
		const provider = { getBars } as Pick<MarketDataRestProvider, 'getBars'>;

		const result = await loadLatestCompletedMinuteBar({
			provider,
			assetClass: 'stocks',
			symbol: 'AAPL',
			mode: 'delayed',
			delayMinutes: 15,
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(result?.endTime.toISOString()).toBe('2026-08-01T15:05:00.000Z');
		expect(getBars).toHaveBeenCalledWith(
			expect.objectContaining({
				timespan: 'minute',
				from: String(Date.parse('2026-08-01T15:00:00.000Z')),
				to: String(Date.parse('2026-08-01T15:05:00.000Z') - 1)
			})
		);
	});

	it('allows an older completed snapshot minute only as an explicit reference', () => {
		const lastMinute = bar('2026-07-31T23:45:00.000Z');
		const snapshot = {
			assetClass: 'stocks',
			symbol: 'AAPL',
			name: 'Apple Inc.',
			mode: 'delayed',
			lastMinute,
			asOf: new Date('2026-08-01T00:01:14.000Z')
		} satisfies MarketSnapshot;

		expect(
			completedSnapshotMinuteBar({
				snapshot,
				assetClass: 'stocks',
				symbol: 'AAPL',
				mode: 'delayed',
				delayMinutes: 15,
				at: new Date('2026-08-02T11:40:00.000Z')
			})
		).toBe(lastMinute);
	});

	it('rejects a snapshot minute from the wrong clock or future logical minute', () => {
		const lastMinute = bar('2026-08-01T15:05:00.000Z');
		const snapshot = {
			assetClass: 'stocks',
			symbol: 'AAPL',
			name: 'Apple Inc.',
			mode: 'delayed',
			lastMinute,
			asOf: new Date('2026-08-01T15:20:30.000Z')
		} satisfies MarketSnapshot;
		const input = {
			snapshot,
			assetClass: 'stocks' as const,
			symbol: 'AAPL',
			mode: 'delayed' as const,
			delayMinutes: 15,
			at: new Date('2026-08-01T15:20:42.000Z')
		};

		expect(completedSnapshotMinuteBar(input)).toBeUndefined();
		expect(completedSnapshotMinuteBar({ ...input, mode: 'realtime' })).toBeUndefined();
	});

	it('selects completed option minute aggregates without treating a daily snapshot as a mark', async () => {
		const symbol = 'O:AAPL260116C00200000';
		const getBars = vi.fn(async () => ({
			items: [
				bar('2026-08-01T15:03:00.000Z', 'options', symbol),
				bar('2026-08-01T15:04:00.000Z', 'options', symbol)
			]
		}));
		const provider = { getBars } as Pick<MarketDataRestProvider, 'getBars'>;

		const result = await loadLatestCompletedMinuteBar({
			provider,
			assetClass: 'options',
			symbol,
			mode: 'delayed',
			delayMinutes: 15,
			at: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(result?.symbol).toBe(symbol);
		expect(result?.endTime.toISOString()).toBe('2026-08-01T15:05:00.000Z');
		expect(getBars).toHaveBeenCalledWith(
			expect.objectContaining({ assetClass: 'options', symbol, timespan: 'minute' })
		);
	});
});
