import { describe, expect, it } from 'vitest';
import { calculatePerformanceMetrics } from './analytics';

describe('calculatePerformanceMetrics', () => {
	it('calculates benchmark-relative results and drawdown without floating-point money math', () => {
		expect.assertions(7);
		const metrics = calculatePerformanceMetrics(
			[
				{ at: '2026-01-02', netLiquidationValue: '10000.00', benchmarkValue: '10000.00' },
				{ at: '2026-01-03', netLiquidationValue: '11000.00', benchmarkValue: '10100.00' },
				{ at: '2026-01-04', netLiquidationValue: '9900.00', benchmarkValue: '10200.00' },
				{ at: '2026-01-05', netLiquidationValue: '12000.00', benchmarkValue: '10300.00' }
			],
			[
				{
					id: 'one',
					realizedPnl: '250.25',
					openedAt: '2026-01-02T14:30:00Z',
					closedAt: '2026-01-02T20:30:00Z',
					plannedRisk: '125',
					slippage: '0.02',
					followedPlan: true
				},
				{
					id: 'two',
					realizedPnl: '-100.25',
					openedAt: '2026-01-03T14:30:00Z',
					closedAt: '2026-01-04T14:30:00Z',
					plannedRisk: '100',
					slippage: '0.03',
					followedPlan: false
				}
			]
		);

		expect(metrics.totalReturn).toBeCloseTo(0.2);
		expect(metrics.benchmarkReturn).toBeCloseTo(0.03);
		expect(metrics.benchmarkRelativeReturn).toBeCloseTo(0.17);
		expect(metrics.maximumDrawdown).toBeCloseTo(0.1);
		expect(metrics.winRate).toBe(0.5);
		expect(metrics.profitFactor).toBeCloseTo(250.25 / 100.25);
		expect(metrics.expectancy).toBe('75.0000');
	});

	it('withholds evidence readiness until both sample thresholds are met', () => {
		expect.assertions(3);
		const trades = Array.from({ length: 30 }, (_, index) => ({
			id: String(index),
			realizedPnl: index % 2 === 0 ? '10' : '-8',
			openedAt: `2026-01-${String((index % 20) + 1).padStart(2, '0')}T14:00:00Z`,
			closedAt: `2026-01-${String((index % 20) + 1).padStart(2, '0')}T20:00:00Z`
		}));
		const ready = calculatePerformanceMetrics([], trades);
		const notReady = calculatePerformanceMetrics([], trades.slice(0, 29));

		expect(ready.skill.closedTrades).toBe(30);
		expect(ready.skill.evidenceReady).toBe(true);
		expect(notReady.skill.evidenceReady).toBe(false);
	});

	it('rejects invalid net liquidation values', () => {
		expect.assertions(1);
		expect(() =>
			calculatePerformanceMetrics([{ at: '2026-01-02', netLiquidationValue: '0' }], [])
		).toThrow('greater than zero');
	});
});
