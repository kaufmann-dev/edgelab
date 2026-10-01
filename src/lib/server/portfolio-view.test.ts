import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MassiveHttpError,
	type AssetClass,
	type MarketDataMode,
	type MarketSnapshot,
	type NormalizedBar
} from '#lib/server/market-data/index.js';
import type { PositionRecord } from './portfolio-read';

const marketMocks = vi.hoisted(() => ({
	getUnifiedSnapshots: vi.fn(),
	getBars: vi.fn(),
	capabilities: {
		stocks: {
			snapshots: true,
			minuteBars: true,
			quotes: true,
			trades: true,
			executionMode: 'realtime' as MarketDataMode | null,
			delayMinutes: 0 as number | null
		},
		options: {
			snapshots: true,
			minuteBars: true,
			quotes: true,
			trades: true,
			executionMode: 'realtime' as MarketDataMode | null,
			delayMinutes: 0 as number | null
		}
	}
}));

vi.mock('#lib/server/market.js', () => ({
	getMarketEnvironment: () => ({
		capabilities: marketMocks.capabilities
	}),
	getMarketDataProvider: () => ({
		getUnifiedSnapshots: marketMocks.getUnifiedSnapshots,
		getBars: marketMocks.getBars
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

function completedBar(
	input: {
		assetClass?: AssetClass;
		symbol?: string;
		mode?: MarketDataMode;
		start?: string;
		close?: string;
	} = {}
): NormalizedBar {
	const assetClass = input.assetClass ?? 'stocks';
	const symbol = input.symbol ?? 'AAPL';
	const mode = input.mode ?? 'delayed';
	const startTime = new Date(input.start ?? '2026-08-01T15:04:00.000Z');
	const endTime = new Date(startTime.getTime() + 60_000);
	const close = new Decimal(input.close ?? '100.5');
	return {
		kind: 'bar',
		assetClass,
		symbol,
		mode,
		interval: 'minute',
		startTime,
		endTime,
		open: close,
		high: close,
		low: close,
		close,
		volume: new Decimal(1_000),
		sourceTime: endTime,
		receivedAt: new Date('2026-08-01T15:20:30.000Z'),
		rawTimestamp: String(startTime.getTime())
	};
}

describe('buildPositionView valuation', () => {
	beforeEach(() => {
		marketMocks.getUnifiedSnapshots.mockReset();
		marketMocks.getBars.mockReset().mockResolvedValue({ items: [] });
		marketMocks.capabilities.stocks.snapshots = true;
		marketMocks.capabilities.stocks.minuteBars = true;
		marketMocks.capabilities.stocks.quotes = true;
		marketMocks.capabilities.stocks.trades = true;
		marketMocks.capabilities.stocks.executionMode = 'realtime';
		marketMocks.capabilities.stocks.delayMinutes = 0;
		marketMocks.capabilities.options.snapshots = true;
		marketMocks.capabilities.options.minuteBars = true;
		marketMocks.capabilities.options.quotes = true;
		marketMocks.capabilities.options.trades = true;
		marketMocks.capabilities.options.executionMode = 'realtime';
		marketMocks.capabilities.options.delayMinutes = 0;
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
		expect(view.valuation?.asOf.toISOString()).toBe('2026-08-01T12:05:00.000Z');
		expect(view.marketFeed?.asOf).toBe('2026-08-01T12:07:00.000Z');
	});

	it('still marks supported stocks when option snapshots are unavailable', async () => {
		marketMocks.capabilities.options.snapshots = false;
		marketMocks.getUnifiedSnapshots.mockResolvedValue({ items: [snapshot()] });

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
					contractMultiplier: '100'
				})
			],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0'
		});

		expect(marketMocks.getUnifiedSnapshots).toHaveBeenCalledWith(['AAPL']);
		expect(view.positions.find((row) => row.symbol === 'AAPL')?.mark).toBe(111);
		expect(view.positions.find((row) => row.assetType === 'option')?.mark).toBeNull();
		expect(view.marketError).toContain('options snapshots');
	});

	it('uses a delayed completed aggregate for Stocks Starter and ignores unentitled snapshot prices', async () => {
		const snapshotAsOf = new Date('2026-08-01T15:20:30.000Z');
		marketMocks.capabilities.stocks.quotes = false;
		marketMocks.capabilities.stocks.trades = false;
		marketMocks.capabilities.stocks.executionMode = 'delayed';
		marketMocks.capabilities.stocks.delayMinutes = 15;
		marketMocks.getUnifiedSnapshots.mockResolvedValue({
			items: [
				snapshot({
					mode: 'delayed',
					quote: {
						kind: 'quote',
						assetClass: 'stocks',
						symbol: 'AAPL',
						mode: 'delayed',
						bidPrice: new Decimal('110'),
						askPrice: new Decimal('112'),
						bidSize: new Decimal(1),
						askSize: new Decimal(1),
						sourceTime: snapshotAsOf,
						receivedAt: snapshotAsOf,
						rawTimestamp: String(snapshotAsOf.getTime())
					},
					lastTrade: {
						kind: 'trade',
						assetClass: 'stocks',
						symbol: 'AAPL',
						mode: 'delayed',
						price: new Decimal('109'),
						size: new Decimal(1),
						conditions: [],
						sourceTime: snapshotAsOf,
						receivedAt: snapshotAsOf,
						rawTimestamp: String(snapshotAsOf.getTime())
					},
					lastMinute: completedBar({
						mode: 'delayed',
						start: '2026-08-01T15:05:00.000Z',
						close: '500'
					}),
					asOf: snapshotAsOf
				})
			]
		});
		marketMocks.getBars.mockResolvedValue({ items: [completedBar()] });

		const view = await buildPositionView({
			positions: [position()],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			valuationTime: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(view.positions[0].mark).toBe(100.5);
		expect(view.valuation?.netMarketValue.toFixed()).toBe('201');
		expect(view.marketFeed).toEqual({
			state: 'delayed',
			modeLabel: '15 MIN DELAYED',
			asOf: '2026-08-01T15:05:00.000Z'
		});
		expect(marketMocks.getBars).toHaveBeenCalledWith(
			expect.objectContaining({
				assetClass: 'stocks',
				symbol: 'AAPL',
				timespan: 'minute',
				to: String(Date.parse('2026-08-01T15:05:00.000Z') - 1)
			})
		);
	});

	it('uses the Options Starter clock for a completed option aggregate mark', async () => {
		const optionSymbol = 'O:AAPL260821C00200000';
		marketMocks.capabilities.options.quotes = false;
		marketMocks.capabilities.options.trades = false;
		marketMocks.capabilities.options.executionMode = 'delayed';
		marketMocks.capabilities.options.delayMinutes = 15;
		marketMocks.getUnifiedSnapshots.mockResolvedValue({
			items: [
				snapshot({
					assetClass: 'options',
					symbol: optionSymbol,
					name: 'AAPL Aug 21 2026 $200 Call',
					mode: 'delayed',
					quote: undefined,
					lastTrade: undefined,
					lastMinute: undefined
				})
			]
		});
		marketMocks.getBars.mockResolvedValue({
			items: [
				completedBar({
					assetClass: 'options',
					symbol: optionSymbol,
					mode: 'delayed',
					close: '3.25'
				})
			]
		});

		const view = await buildPositionView({
			positions: [
				position({
					id: 'position-option',
					instrumentId: 'instrument-option',
					symbol: optionSymbol,
					name: 'AAPL Aug 21 2026 $200 Call',
					assetClass: 'options',
					underlyingSymbol: 'AAPL',
					expirationDate: '2026-08-21',
					contractMultiplier: '100',
					quantity: '1',
					averageCost: '4'
				})
			],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			valuationTime: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(view.positions[0].mark).toBe(3.25);
		expect(view.positions[0].marketValue).toBe(325);
		expect(view.valuation?.asOf.toISOString()).toBe('2026-08-01T15:05:00.000Z');
		expect(view.marketFeed?.state).toBe('delayed');
		expect(marketMocks.getBars).toHaveBeenCalledWith(
			expect.objectContaining({
				assetClass: 'options',
				symbol: optionSymbol,
				timespan: 'minute',
				to: String(Date.parse('2026-08-01T15:05:00.000Z') - 1)
			})
		);
	});

	it('loads a completed aggregate when Massive omits a requested snapshot item', async () => {
		marketMocks.capabilities.stocks.quotes = false;
		marketMocks.capabilities.stocks.trades = false;
		marketMocks.capabilities.stocks.executionMode = 'delayed';
		marketMocks.capabilities.stocks.delayMinutes = 15;
		marketMocks.getUnifiedSnapshots.mockResolvedValue({ items: [] });
		marketMocks.getBars.mockResolvedValue({ items: [completedBar()] });

		const view = await buildPositionView({
			positions: [position()],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			valuationTime: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(view.positions[0].mark).toBe(100.5);
		expect(view.valuation).not.toBeNull();
		expect(view.marketError).toBeNull();
	});

	it.each([401, 403])(
		'does not hide a %i snapshot access failure behind aggregate marks',
		async (status) => {
			marketMocks.capabilities.stocks.quotes = false;
			marketMocks.capabilities.stocks.trades = false;
			marketMocks.capabilities.stocks.executionMode = 'delayed';
			marketMocks.capabilities.stocks.delayMinutes = 15;
			marketMocks.getUnifiedSnapshots.mockRejectedValue(
				new MassiveHttpError(status, 'snapshot access denied')
			);
			marketMocks.getBars.mockResolvedValue({ items: [completedBar()] });

			const view = await buildPositionView({
				positions: [position()],
				cashBalance: '1000',
				reservedCash: '0',
				realizedPnl: '0',
				valuationTime: new Date('2026-08-01T15:20:42.000Z')
			});

			expect(view.positions[0].mark).toBeNull();
			expect(view.valuation).toBeNull();
			expect(view.marketError).toBe(
				'Massive denied market-data access for the configured credentials or market-data plan.'
			);
			expect(marketMocks.getBars).not.toHaveBeenCalled();
		}
	);

	it.each([401, 403])('surfaces a %i aggregate access failure', async (status) => {
		marketMocks.capabilities.stocks.quotes = false;
		marketMocks.capabilities.stocks.trades = false;
		marketMocks.capabilities.stocks.executionMode = 'delayed';
		marketMocks.capabilities.stocks.delayMinutes = 15;
		marketMocks.getUnifiedSnapshots.mockResolvedValue({
			items: [
				snapshot({
					mode: 'delayed',
					quote: undefined,
					lastTrade: undefined,
					lastMinute: undefined
				})
			]
		});
		marketMocks.getBars.mockRejectedValue(new MassiveHttpError(status, 'aggregate access denied'));

		const view = await buildPositionView({
			positions: [position()],
			cashBalance: '1000',
			reservedCash: '0',
			realizedPnl: '0',
			valuationTime: new Date('2026-08-01T15:20:42.000Z')
		});

		expect(view.positions[0].mark).toBeNull();
		expect(view.valuation).toBeNull();
		expect(view.marketError).toBe(
			'Massive denied market-data access for the configured credentials or market-data plan.'
		);
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
