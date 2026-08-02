import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketSnapshot } from '$lib/server/market-data';
import type { PositionRecord } from './portfolio-read';

const marketMocks = vi.hoisted(() => ({
	getUnifiedSnapshots: vi.fn()
}));

vi.mock('$lib/server/market', () => ({
	getMarketEnvironment: () => ({
		capabilities: {
			stocks: { snapshots: true },
			options: { snapshots: true }
		}
	}),
	getMarketDataProvider: () => ({
		getUnifiedSnapshots: marketMocks.getUnifiedSnapshots
	})
}));

import { buildPositionView } from './portfolio-view';

function position(overrides: Partial<PositionRecord> = {}): PositionRecord {
	return {
		id: 'position-aapl',
		instrumentId: 'instrument-aapl',
		symbol: 'AAPL',
		name: 'Apple Inc.',
		assetClass: 'stocks',
		underlyingSymbol: null,
		expirationDate: null,
		contractMultiplier: null,
		quantity: '2',
		averageCost: '100',
		realizedPnl: '5',
		updatedAt: new Date('2026-08-01T12:00:00.000Z'),
		...overrides
	};
}

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
	const asOf = new Date('2026-08-01T12:05:00.000Z');
	return {
		assetClass: 'stocks',
		symbol: 'AAPL',
		name: 'Apple Inc.',
		mode: 'realtime',
		quote: {
			kind: 'quote',
			assetClass: 'stocks',
			symbol: 'AAPL',
			mode: 'realtime',
			bidPrice: new Decimal('110'),
			askPrice: new Decimal('112'),
			bidSize: new Decimal('1'),
			askSize: new Decimal('1'),
			sourceTime: asOf,
			receivedAt: asOf,
			rawTimestamp: String(asOf.getTime())
		},
		asOf,
		...overrides
	};
}

describe('buildPositionView valuation', () => {
	beforeEach(() => {
		marketMocks.getUnifiedSnapshots.mockReset();
	});

	it('returns an exact complete valuation for a cash-only portfolio', async () => {
		const valuationTime = new Date('2026-08-01T12:34:56.000Z');
		const view = await buildPositionView({
			positions: [],
			cashBalance: '1000.12345678',
			reservedCash: '100',
			realizedPnl: '12.34567890',
			valuationTime
		});

		expect(view.valuation).not.toBeNull();
		expect(view.valuation?.cashBalance.toFixed(8)).toBe('1000.12345678');
		expect(view.valuation?.netMarketValue.toFixed()).toBe('0');
		expect(view.valuation?.grossExposure.toFixed()).toBe('0');
		expect(view.valuation?.equity.toFixed(8)).toBe('1000.12345678');
		expect(view.valuation?.realizedPnl.toFixed(8)).toBe('12.34567890');
		expect(view.valuation?.unrealizedPnl.toFixed()).toBe('0');
		expect(view.valuation?.asOf).toEqual(valuationTime);
		expect(marketMocks.getUnifiedSnapshots).not.toHaveBeenCalled();
	});

	it('calculates net value, gross exposure, and P&L only when every position has a mark', async () => {
		const optionAsOf = new Date('2026-08-01T12:06:00.000Z');
		marketMocks.getUnifiedSnapshots.mockResolvedValue({
			items: [
				snapshot(),
				snapshot({
					assetClass: 'options',
					symbol: 'O:AAPL260821C00200000',
					name: 'AAPL Aug 21 2026 $200 Call',
					quote: undefined,
					lastTrade: {
						kind: 'trade',
						assetClass: 'options',
						symbol: 'O:AAPL260821C00200000',
						mode: 'realtime',
						price: new Decimal('3'),
						size: new Decimal('1'),
						conditions: [],
						sourceTime: optionAsOf,
						receivedAt: optionAsOf,
						rawTimestamp: String(optionAsOf.getTime())
					},
					asOf: optionAsOf
				})
			]
		});

		const view = await buildPositionView({
			positions: [
				position(),
				position({
					id: 'position-option',
					instrumentId: 'instrument-option',
					symbol: 'O:AAPL260821C00200000',
					name: 'AAPL Aug 21 2026 $200 Call',
					assetClass: 'options',
					underlyingSymbol: 'AAPL',
					expirationDate: '2026-08-21',
					contractMultiplier: '100',
					quantity: '-1',
					averageCost: '4',
					realizedPnl: '-2'
				})
			],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '55'
		});

		expect(view.valuation?.netMarketValue.toFixed()).toBe('-78');
		expect(view.valuation?.grossExposure.toFixed()).toBe('522');
		expect(view.valuation?.equity.toFixed()).toBe('922');
		expect(view.valuation?.realizedPnl.toFixed()).toBe('55');
		expect(view.valuation?.unrealizedPnl.toFixed()).toBe('122');
		expect(view.valuation?.asOf).toEqual(optionAsOf);
	});

	it('loads position and benchmark marks in one request and prefers a positive quote midpoint', async () => {
		const benchmarkAsOf = new Date('2026-08-01T12:07:00.000Z');
		marketMocks.getUnifiedSnapshots.mockResolvedValue({
			items: [
				snapshot(),
				snapshot({
					symbol: 'SPY',
					name: 'SPDR S&P 500 ETF Trust',
					quote: {
						kind: 'quote',
						assetClass: 'stocks',
						symbol: 'SPY',
						mode: 'realtime',
						bidPrice: new Decimal('400'),
						askPrice: new Decimal('402'),
						bidSize: new Decimal('1'),
						askSize: new Decimal('1'),
						sourceTime: benchmarkAsOf,
						receivedAt: benchmarkAsOf,
						rawTimestamp: String(benchmarkAsOf.getTime())
					},
					lastTrade: {
						kind: 'trade',
						assetClass: 'stocks',
						symbol: 'SPY',
						mode: 'realtime',
						price: new Decimal('399'),
						size: new Decimal('1'),
						conditions: [],
						sourceTime: benchmarkAsOf,
						receivedAt: benchmarkAsOf,
						rawTimestamp: String(benchmarkAsOf.getTime())
					},
					asOf: benchmarkAsOf
				})
			]
		});

		const view = await buildPositionView({
			positions: [position()],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			benchmarkSymbol: 'spy'
		});

		expect(marketMocks.getUnifiedSnapshots).toHaveBeenCalledTimes(1);
		expect(marketMocks.getUnifiedSnapshots).toHaveBeenCalledWith(['AAPL', 'SPY']);
		expect(view.benchmarkPrice?.toFixed()).toBe('401');
		expect(view.valuation).not.toBeNull();
	});

	it('falls back from a non-positive quote to benchmark trade and bar prices', async () => {
		const asOf = new Date('2026-08-01T12:08:00.000Z');
		marketMocks.getUnifiedSnapshots
			.mockResolvedValueOnce({
				items: [
					snapshot({
						symbol: 'SPY',
						quote: {
							kind: 'quote',
							assetClass: 'stocks',
							symbol: 'SPY',
							mode: 'realtime',
							bidPrice: new Decimal(0),
							askPrice: new Decimal(0),
							bidSize: new Decimal(0),
							askSize: new Decimal(0),
							sourceTime: asOf,
							receivedAt: asOf,
							rawTimestamp: String(asOf.getTime())
						},
						lastTrade: {
							kind: 'trade',
							assetClass: 'stocks',
							symbol: 'SPY',
							mode: 'realtime',
							price: new Decimal('403.25'),
							size: new Decimal('1'),
							conditions: [],
							sourceTime: asOf,
							receivedAt: asOf,
							rawTimestamp: String(asOf.getTime())
						}
					})
				]
			})
			.mockResolvedValueOnce({
				items: [
					snapshot({
						symbol: 'SPY',
						quote: undefined,
						lastMinute: {
							kind: 'bar',
							assetClass: 'stocks',
							symbol: 'SPY',
							mode: 'realtime',
							interval: 'minute',
							startTime: new Date('2026-08-01T12:07:00.000Z'),
							endTime: asOf,
							open: new Decimal('404'),
							high: new Decimal('405'),
							low: new Decimal('403'),
							close: new Decimal('404.5'),
							volume: new Decimal('100'),
							sourceTime: asOf,
							receivedAt: asOf,
							rawTimestamp: String(asOf.getTime())
						}
					})
				]
			});

		const tradeView = await buildPositionView({
			positions: [],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			benchmarkSymbol: 'SPY'
		});
		const barView = await buildPositionView({
			positions: [],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			benchmarkSymbol: 'SPY'
		});

		expect(tradeView.benchmarkPrice?.toFixed()).toBe('403.25');
		expect(barView.benchmarkPrice?.toFixed()).toBe('404.5');
	});

	it('retries position-only marks when a combined benchmark request fails', async () => {
		marketMocks.getUnifiedSnapshots
			.mockRejectedValueOnce(new Error('benchmark unavailable'))
			.mockResolvedValueOnce({ items: [snapshot()] });

		const view = await buildPositionView({
			positions: [position()],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			benchmarkSymbol: 'SPY'
		});

		expect(marketMocks.getUnifiedSnapshots).toHaveBeenNthCalledWith(1, ['AAPL', 'SPY']);
		expect(marketMocks.getUnifiedSnapshots).toHaveBeenNthCalledWith(2, ['AAPL']);
		expect(view.valuation).not.toBeNull();
		expect(view.benchmarkPrice).toBeNull();
		expect(view.marketError).toBeNull();
	});

	it('keeps a cash-only valuation complete when only its benchmark request fails', async () => {
		marketMocks.getUnifiedSnapshots.mockRejectedValue(new Error('benchmark unavailable'));
		const view = await buildPositionView({
			positions: [],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			benchmarkSymbol: 'SPY'
		});

		expect(view.valuation).not.toBeNull();
		expect(view.benchmarkPrice).toBeNull();
		expect(view.marketError).toBeNull();
	});

	it('keeps valuation unavailable when any open position lacks a usable mark', async () => {
		marketMocks.getUnifiedSnapshots.mockResolvedValue({ items: [] });
		const view = await buildPositionView({
			positions: [position()],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0'
		});

		expect(view.valuation).toBeNull();
		expect(view.metrics.find((metric) => metric.id === 'equity')?.value).toBe('—');
		expect(view.positions[0].mark).toBeNull();
		expect(view.marketError).toBe(
			'Massive returned no usable mark for one or more open positions.'
		);
	});
});
