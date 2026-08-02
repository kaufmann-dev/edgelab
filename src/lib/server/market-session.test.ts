import { describe, expect, it } from 'vitest';
import {
	dayOrderExpiration,
	logicalMarketTime,
	orderAllowsSession,
	usEquitySessionAt
} from './market-session';

const holidays = [
	{
		date: '2026-11-26',
		exchange: 'NYSE' as const,
		name: 'Thanksgiving',
		status: 'closed' as const
	},
	{
		date: '2026-11-27',
		exchange: 'NYSE' as const,
		name: 'Thanksgiving',
		status: 'early-close' as const,
		open: new Date('2026-11-27T14:30:00.000Z'),
		close: new Date('2026-11-27T18:00:00.000Z')
	}
];

describe('US equity market sessions', () => {
	it('classifies regular, extended, weekend, holiday, and early-close times', () => {
		expect(usEquitySessionAt(new Date('2026-08-03T14:00:00Z'), holidays)).toBe('regular');
		expect(usEquitySessionAt(new Date('2026-08-03T12:00:00Z'), holidays)).toBe('extended');
		expect(usEquitySessionAt(new Date('2026-08-02T14:00:00Z'), holidays)).toBe('closed');
		expect(usEquitySessionAt(new Date('2026-11-26T15:00:00Z'), holidays)).toBe('closed');
		expect(usEquitySessionAt(new Date('2026-11-27T17:59:59Z'), holidays)).toBe('regular');
		expect(usEquitySessionAt(new Date('2026-11-27T18:00:00Z'), holidays)).toBe('closed');
	});

	it('allows extended execution only for opted-in stock limits', () => {
		expect(
			orderAllowsSession({
				session: 'extended',
				extendedHours: true,
				orderType: 'limit',
				allStockLegs: true
			})
		).toBe(true);
		expect(
			orderAllowsSession({
				session: 'extended',
				extendedHours: false,
				orderType: 'limit',
				allStockLegs: true
			})
		).toBe(false);
	});

	it('uses the delayed logical clock and the exchange close for DAY expiry', () => {
		expect(logicalMarketTime(new Date('2026-08-03T20:10:00Z'), 15 * 60_000)).toEqual(
			new Date('2026-08-03T19:55:00Z')
		);
		expect(
			dayOrderExpiration({
				acceptedAt: new Date('2026-11-27T16:00:00Z'),
				delayMilliseconds: 15 * 60_000,
				extendedHours: false,
				holidays
			}).toISOString()
		).toBe('2026-11-27T18:15:00.000Z');
	});

	it('moves after-close DAY orders to the next trading session', () => {
		expect(
			dayOrderExpiration({
				acceptedAt: new Date('2026-11-27T19:00:00Z'),
				delayMilliseconds: 0,
				extendedHours: false,
				holidays
			}).toISOString()
		).toBe('2026-11-30T21:00:00.000Z');
	});
});
