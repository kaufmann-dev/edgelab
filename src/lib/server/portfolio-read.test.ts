import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));

import {
	bucketToUtcMinute,
	deriveFifoClosedTradeSamples,
	type PersistedFillLegRecord
} from './portfolio-read';

const BASE_FILL: PersistedFillLegRecord = {
	fillId: '001',
	fillLegId: 'fill-leg-001',
	legNumber: 1,
	instrumentId: 'instrument-aapl',
	symbol: 'AAPL',
	receivedAt: new Date('2026-08-01T14:30:00.000Z'),
	side: 'buy',
	positionEffect: 'open',
	quantity: '1',
	price: '100',
	multiplier: '1',
	fees: '0',
	followedPlan: null
};

function fill(overrides: Partial<PersistedFillLegRecord>): PersistedFillLegRecord {
	return { ...BASE_FILL, ...overrides };
}

describe('deriveFifoClosedTradeSamples', () => {
	it('allocates partial long lots and both opening and closing fees in FIFO order', () => {
		const samples = deriveFifoClosedTradeSamples([
			fill({
				fillId: '004',
				fillLegId: 'close-2',
				receivedAt: new Date('2026-08-01T18:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				quantity: '1',
				price: '90',
				fees: '1'
			}),
			fill({
				fillId: '001',
				fillLegId: 'open-1',
				quantity: '2',
				price: '100',
				fees: '2',
				followedPlan: true
			}),
			fill({
				fillId: '003',
				fillLegId: 'close-1',
				receivedAt: new Date('2026-08-01T17:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				quantity: '4',
				price: '120',
				fees: '4'
			}),
			fill({
				fillId: '002',
				fillLegId: 'open-2',
				receivedAt: new Date('2026-08-01T15:00:00.000Z'),
				quantity: '3',
				price: '110',
				fees: '3',
				followedPlan: false
			})
		]);

		expect(samples).toHaveLength(3);
		expect(samples.map((sample) => sample.id)).toEqual([
			'open-1:close-1',
			'open-2:close-1',
			'open-2:close-2'
		]);
		expect(samples.map((sample) => sample.realizedPnl)).toEqual([
			'36.00000000',
			'16.00000000',
			'-22.00000000'
		]);
		expect(samples.map((sample) => sample.followedPlan)).toEqual([true, false, false]);
		expect(samples[1]).toMatchObject({
			openedAt: new Date('2026-08-01T15:00:00.000Z'),
			closedAt: new Date('2026-08-01T17:00:00.000Z'),
			plannedRisk: null,
			slippage: null
		});
	});

	it('uses contract multipliers through a sequential short-to-long reversal', () => {
		const samples = deriveFifoClosedTradeSamples([
			fill({
				fillId: '001',
				fillLegId: 'short-open',
				instrumentId: 'instrument-option',
				symbol: 'O:AAPL260821C00200000',
				side: 'sell',
				quantity: '2',
				price: '5',
				multiplier: '100',
				fees: '1.30',
				followedPlan: true
			}),
			fill({
				fillId: '002',
				fillLegId: 'short-close-profit',
				instrumentId: 'instrument-option',
				symbol: 'O:AAPL260821C00200000',
				receivedAt: new Date('2026-08-01T15:00:00.000Z'),
				side: 'buy',
				positionEffect: 'close',
				price: '3',
				multiplier: '100',
				fees: '0.65'
			}),
			fill({
				fillId: '003',
				fillLegId: 'short-close-loss',
				instrumentId: 'instrument-option',
				symbol: 'O:AAPL260821C00200000',
				receivedAt: new Date('2026-08-01T16:00:00.000Z'),
				side: 'buy',
				positionEffect: 'close',
				price: '6',
				multiplier: '100',
				fees: '0.65'
			}),
			fill({
				fillId: '004',
				fillLegId: 'long-open',
				instrumentId: 'instrument-option',
				symbol: 'O:AAPL260821C00200000',
				receivedAt: new Date('2026-08-01T17:00:00.000Z'),
				side: 'buy',
				quantity: '1',
				price: '6',
				multiplier: '100',
				fees: '0.65',
				followedPlan: false
			}),
			fill({
				fillId: '005',
				fillLegId: 'long-close',
				instrumentId: 'instrument-option',
				symbol: 'O:AAPL260821C00200000',
				receivedAt: new Date('2026-08-01T18:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				price: '7.5',
				multiplier: '100',
				fees: '0.65'
			})
		]);

		expect(samples.map((sample) => sample.realizedPnl)).toEqual([
			'198.70000000',
			'-101.30000000',
			'148.70000000'
		]);
		expect(samples.map((sample) => sample.followedPlan)).toEqual([true, true, false]);
	});

	it('keeps FIFO direction isolated through a sequential long-to-short reversal', () => {
		const samples = deriveFifoClosedTradeSamples([
			fill({ fillLegId: 'long-open', price: '100' }),
			fill({
				fillId: '002',
				fillLegId: 'long-close',
				receivedAt: new Date('2026-08-01T15:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				price: '110'
			}),
			fill({
				fillId: '003',
				fillLegId: 'short-open',
				receivedAt: new Date('2026-08-01T16:00:00.000Z'),
				side: 'sell',
				price: '105'
			}),
			fill({
				fillId: '004',
				fillLegId: 'short-close',
				receivedAt: new Date('2026-08-01T17:00:00.000Z'),
				side: 'buy',
				positionEffect: 'close',
				price: '101'
			})
		]);

		expect(samples.map((sample) => sample.id)).toEqual([
			'long-open:long-close',
			'short-open:short-close'
		]);
		expect(samples.map((sample) => sample.realizedPnl)).toEqual(['10.00000000', '4.00000000']);
	});

	it('preserves the exact stored fee total across repeating partial allocations', () => {
		const samples = deriveFifoClosedTradeSamples([
			fill({ fillLegId: 'open', quantity: '3', fees: '1' }),
			fill({
				fillId: '002',
				fillLegId: 'close-1',
				receivedAt: new Date('2026-08-01T15:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				price: '100'
			}),
			fill({
				fillId: '003',
				fillLegId: 'close-2',
				receivedAt: new Date('2026-08-01T16:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				price: '100'
			}),
			fill({
				fillId: '004',
				fillLegId: 'close-3',
				receivedAt: new Date('2026-08-01T17:00:00.000Z'),
				side: 'sell',
				positionEffect: 'close',
				price: '100'
			})
		]);

		expect(samples.map((sample) => sample.realizedPnl)).toEqual([
			'-0.33333333',
			'-0.33333334',
			'-0.33333333'
		]);
		expect(
			samples.reduce((total, sample) => total.plus(sample.realizedPnl), new Decimal(0)).toFixed(8)
		).toBe('-1.00000000');
	});
});

describe('bucketToUtcMinute', () => {
	it('uses a stable UTC minute key for concurrent snapshot upserts', () => {
		expect(bucketToUtcMinute(new Date('2026-08-01T12:34:59.999Z')).toISOString()).toBe(
			'2026-08-01T12:34:00.000Z'
		);
	});
});
