import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDataRestProvider, NormalizedBar } from '$lib/server/market-data';
import { completedMinuteEnd, loadLatestCompletedMinuteBar } from './market-bars';

function bar(start: string): NormalizedBar {
	const startTime = new Date(start);
	const endTime = new Date(startTime.getTime() + 60_000);
	return {
		kind: 'bar',
		assetClass: 'stocks',
		symbol: 'AAPL',
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
});
