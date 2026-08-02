import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
	hasAvailableCashForLiveFill,
	isDayOrderExpired,
	isQuoteEligibleForEvent,
	isStopTradeEligible,
	planLiveOrderTopics
} from './live-order-execution';

describe('live order topic planning', () => {
	it('uses stock aggregates while preserving option quote topics', () => {
		expect(
			planLiveOrderTopics([
				{
					orderType: 'limit',
					timeInForce: 'gtc',
					dataMode: 'realtime',
					legs: [{ symbol: 'AAPL', assetClass: 'stocks' }]
				},
				{
					orderType: 'trailing_stop',
					timeInForce: 'day',
					dataMode: 'realtime',
					legs: [{ symbol: 'AAPL', assetClass: 'stocks' }]
				},
				{
					orderType: 'limit',
					timeInForce: 'gtc',
					dataMode: 'delayed',
					legs: [
						{ symbol: 'O:AAPL260918C00200000', assetClass: 'options' },
						{ symbol: 'O:AAPL260918C00210000', assetClass: 'options' }
					]
				},
				{
					orderType: 'market',
					timeInForce: 'ioc',
					dataMode: 'realtime',
					legs: [{ symbol: 'MSFT', assetClass: 'stocks' }]
				}
			])
		).toEqual({
			realtime: {
				stocks: ['A.AAPL'],
				options: []
			},
			delayed: {
				stocks: [],
				options: ['Q.O:AAPL260918C00200000', 'Q.O:AAPL260918C00210000']
			}
		});
	});
});

describe('DAY order expiry', () => {
	it('expires at the delayed exchange-session boundary and never expires GTC', () => {
		const acceptedAt = new Date('2026-08-03T15:00:00.000Z');
		const expiresAt = new Date('2026-08-03T20:15:00.000Z');
		const input = {
			acceptedAt,
			delayMilliseconds: 15 * 60 * 1_000,
			extendedHours: false,
			holidays: []
		};
		expect(
			isDayOrderExpired({
				...input,
				timeInForce: 'day',
				at: new Date(expiresAt.getTime() - 1)
			})
		).toBe(false);
		expect(isDayOrderExpired({ ...input, timeInForce: 'day', at: expiresAt })).toBe(true);
		expect(isDayOrderExpired({ ...input, timeInForce: 'gtc', at: expiresAt })).toBe(false);
	});
});

describe('quote event eligibility', () => {
	const quote = {
		mode: 'realtime' as const,
		sourceTime: new Date('2026-08-01T14:30:00.000Z')
	};

	it('accepts matching quotes no more than sixty seconds old', () => {
		expect(
			isQuoteEligibleForEvent({
				quote,
				expectedMode: 'realtime',
				eventSourceTime: new Date('2026-08-01T14:31:00.000Z')
			})
		).toBe(true);
	});

	it('rejects mode mismatches, stale/future quotes, and pre-trigger quotes', () => {
		expect(
			isQuoteEligibleForEvent({
				quote,
				expectedMode: 'delayed',
				eventSourceTime: quote.sourceTime
			})
		).toBe(false);
		expect(
			isQuoteEligibleForEvent({
				quote,
				expectedMode: 'realtime',
				eventSourceTime: new Date('2026-08-01T14:31:00.001Z')
			})
		).toBe(false);
		expect(
			isQuoteEligibleForEvent({
				quote,
				expectedMode: 'realtime',
				eventSourceTime: new Date('2026-08-01T14:29:59.999Z')
			})
		).toBe(false);
		expect(
			isQuoteEligibleForEvent({
				quote,
				expectedMode: 'realtime',
				eventSourceTime: new Date('2026-08-01T14:30:30.000Z'),
				triggeredAt: new Date('2026-08-01T14:30:00.001Z')
			})
		).toBe(false);
	});
});

describe('stop trade eligibility', () => {
	it('requires matching mode, post-latency receipt, and a fresh logical source time', () => {
		const trade = {
			mode: 'delayed' as const,
			sourceTime: new Date('2026-08-03T15:00:00.000Z'),
			receivedAt: new Date('2026-08-03T15:15:00.000Z')
		};
		expect(
			isStopTradeEligible({
				trade,
				expectedMode: 'delayed',
				eligibleAt: new Date('2026-08-03T15:14:59.000Z'),
				delayMilliseconds: 15 * 60 * 1_000
			})
		).toBe(true);
		expect(
			isStopTradeEligible({
				trade,
				expectedMode: 'realtime',
				eligibleAt: new Date('2026-08-03T15:14:59.000Z'),
				delayMilliseconds: 0
			})
		).toBe(false);
		expect(
			isStopTradeEligible({
				trade: { ...trade, sourceTime: new Date('2026-08-03T14:58:59.999Z') },
				expectedMode: 'delayed',
				eligibleAt: new Date('2026-08-03T15:14:59.000Z'),
				delayMilliseconds: 15 * 60 * 1_000
			})
		).toBe(false);
	});
});

describe('live fill funding', () => {
	it('credits this order reservation without spending cash reserved for other orders', () => {
		const account = {
			cashBalance: new Decimal(10_000),
			reservedCash: new Decimal(7_000),
			orderCashReservation: new Decimal(2_000)
		};
		expect(
			hasAvailableCashForLiveFill({
				...account,
				netCashChange: new Decimal(-5_000)
			})
		).toBe(true);
		expect(
			hasAvailableCashForLiveFill({
				...account,
				netCashChange: new Decimal('-5000.00000001')
			})
		).toBe(false);
	});

	it('allows net-credit fills and rejects inconsistent reservation totals', () => {
		expect(
			hasAvailableCashForLiveFill({
				cashBalance: new Decimal(100),
				reservedCash: new Decimal(100),
				orderCashReservation: new Decimal(0),
				netCashChange: new Decimal(25)
			})
		).toBe(true);
		expect(() =>
			hasAvailableCashForLiveFill({
				cashBalance: new Decimal(100),
				reservedCash: new Decimal(10),
				orderCashReservation: new Decimal(11),
				netCashChange: new Decimal(-1)
			})
		).toThrow('Active cash reservations are inconsistent');
	});
});
