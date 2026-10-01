import Decimal from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	optionInstrumentSchema,
	resolveMassiveCapabilities,
	stockInstrumentSchema,
	type Instrument,
	type OptionInstrument
} from '#lib/server/market-data/index.js';
import { resetMarketHolidayCacheForTests } from '#lib/server/market-session.js';
import {
	createAcceptedOrder,
	drizzleTradingRepository,
	orderDraftSchema,
	type OrderDraft,
	type TradingUnitOfWork
} from '#lib/server/trading/index.js';

const marketMocks = vi.hoisted(() => ({
	getMarketDataProvider: vi.fn(),
	getMarketEnvironment: vi.fn()
}));

const portfolioMocks = vi.hoisted(() => ({
	getPortfolioPolicy: vi.fn(),
	listPortfolioEquity: vi.fn(),
	requirePortfolioReadAccess: vi.fn()
}));

const liveExecutionMocks = vi.hoisted(() => ({
	notifyOrdersChanged: vi.fn()
}));

vi.mock('#lib/server/market.js', () => marketMocks);
vi.mock('#lib/server/portfolio-read.js', () => portfolioMocks);
vi.mock('#lib/server/live-order-execution.js', () => liveExecutionMocks);
vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

import {
	assertSupportedOptionOrderSurface as assertResolvedOptionOrderSurface,
	placeSimulationOrder
} from './order-application';

const ownerUserId = '00000000-0000-4000-8000-000000000001';
const portfolioId = '00000000-0000-4000-8000-000000000002';
const optionSymbol = 'O:AAPL260918C00200000';

function optionInstrument(
	input: {
		multiplier?: string;
		additionalUnderlyings?: OptionInstrument['additionalUnderlyings'];
		expirationDate?: string;
	} = {}
): OptionInstrument {
	return optionInstrumentSchema.parse({
		assetClass: 'options',
		symbol: optionSymbol,
		name: 'AAPL Sep 2026 200 Call',
		currency: 'USD',
		active: true,
		underlyingSymbol: 'AAPL',
		optionType: 'call',
		exerciseStyle: 'american',
		expirationDate: input.expirationDate ?? '2026-09-18',
		strikePrice: '200',
		multiplier: input.multiplier ?? '100',
		additionalUnderlyings: input.additionalUnderlyings ?? []
	});
}

function optionDraft(
	overrides: Partial<Omit<OrderDraft, 'legs'>> & {
		leg?: Partial<OrderDraft['legs'][number]>;
	} = {}
): OrderDraft {
	const { leg: legOverrides, ...draftOverrides } = overrides;
	return orderDraftSchema.parse({
		portfolioId,
		clientOrderId: 'option-order-1',
		type: 'limit',
		timeInForce: 'day',
		quantity: '2',
		limitPrice: '2.50',
		netPriceEffect: 'debit',
		extendedHours: false,
		legs: [
			{
				symbol: optionSymbol,
				side: 'buy',
				positionEffect: 'open',
				ratioQuantity: '1',
				...legOverrides
			}
		],
		...draftOverrides
	});
}

function instrumentMap(instrument: Instrument = optionInstrument()): Map<string, Instrument> {
	return new Map([[instrument.symbol, instrument]]);
}

function assertSupportedOptionOrderSurface(
	draft: OrderDraft,
	instruments: ReadonlyMap<string, Instrument>,
	firstEligibleMarketDate = '2026-08-03'
): void {
	assertResolvedOptionOrderSurface(draft, instruments, firstEligibleMarketDate);
}

function unitOfWork(existingOrder: ReturnType<typeof createAcceptedOrder> | null = null) {
	const portfolio = {
		id: portfolioId,
		ownerUserId,
		name: 'Starter options',
		baseCurrency: 'USD' as const,
		startingCash: new Decimal(100_000),
		cashBalance: new Decimal(100_000),
		reservedCash: new Decimal(0),
		dataMode: 'delayed' as const,
		status: 'active' as const
	};
	return {
		getPortfolioForUpdate: vi.fn(async () => portfolio),
		getOrderForUpdate: vi.fn(async () => null),
		findOrderByClientId: vi.fn(async () => existingOrder),
		getPositionsForUpdate: vi.fn(async () => new Map()),
		getRiskStateForUpdate: vi.fn(async () => ({
			openOrderCount: 0,
			reservedPositionQuantities: new Map()
		})),
		getActiveOrderCashReservationForUpdate: vi.fn(async () => new Decimal(0)),
		insertOrder: vi.fn(async () => undefined),
		insertOrderReservations: vi.fn(async () => undefined),
		updateOrder: vi.fn(async () => true),
		insertFill: vi.fn(async () => undefined),
		insertLedgerEntries: vi.fn(async () => undefined),
		upsertPositions: vi.fn(async () => undefined),
		consumeOrderReservations: vi.fn(async () => undefined),
		releaseOrderReservations: vi.fn(async () => undefined),
		appendOrderEvent: vi.fn(async () => undefined)
	} satisfies TradingUnitOfWork;
}

describe('Options Starter order surface', () => {
	it('accepts standard ratio-one LIMIT DAY buy-to-open and sell-to-close orders', () => {
		const instrument = optionInstrument();
		expect(() =>
			assertSupportedOptionOrderSurface(optionDraft(), instrumentMap(instrument))
		).not.toThrow();
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft({
					netPriceEffect: 'credit',
					leg: { side: 'sell', positionEffect: 'close' }
				}),
				instrumentMap(instrument)
			)
		).not.toThrow();
	});

	it.each([
		{ side: 'sell', positionEffect: 'open', netPriceEffect: 'credit' },
		{ side: 'buy', positionEffect: 'close', netPriceEffect: 'debit' }
	] as const)(
		'rejects option $side-to-$positionEffect orders',
		({ side, positionEffect, netPriceEffect }) => {
			expect(() =>
				assertSupportedOptionOrderSurface(
					optionDraft({ netPriceEffect, leg: { side, positionEffect } }),
					instrumentMap()
				)
			).toThrow('Option simulation supports buy-to-open and sell-to-close orders only.');
		}
	);

	it.each([
		{
			name: 'market',
			overrides: { type: 'market', limitPrice: undefined }
		},
		{
			name: 'stop',
			overrides: { type: 'stop', limitPrice: undefined, stopPrice: new Decimal(3) }
		},
		{
			name: 'stop-limit',
			overrides: { type: 'stop_limit', stopPrice: new Decimal(3) }
		},
		{
			name: 'trailing stop',
			overrides: {
				type: 'trailing_stop',
				limitPrice: undefined,
				trailingPercent: new Decimal(10)
			}
		}
	] as const)('rejects the $name option order type after resolution', ({ overrides }) => {
		expect(() =>
			assertSupportedOptionOrderSurface(optionDraft(overrides), instrumentMap())
		).toThrow('Option simulation currently supports limit orders only.');
	});

	it.each(['gtc', 'ioc'] as const)(
		'rejects %s option time in force after resolution',
		(timeInForce) => {
			expect(() =>
				assertSupportedOptionOrderSurface(optionDraft({ timeInForce }), instrumentMap())
			).toThrow('Option simulation currently supports DAY orders only.');
		}
	);

	it('rejects extended hours, non-unit ratios, adjusted contracts, and nonstandard multipliers', () => {
		expect(() =>
			assertSupportedOptionOrderSurface(optionDraft({ extendedHours: true }), instrumentMap())
		).toThrow('Option simulation is limited to the regular US equity session.');
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft({ leg: { ratioQuantity: new Decimal(2) } }),
				instrumentMap()
			)
		).toThrow('Leg ratio must equal 1');
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft(),
				instrumentMap(optionInstrument({ multiplier: '10' }))
			)
		).toThrow('Option simulation supports only standard, unadjusted 100-share contracts.');
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft(),
				instrumentMap(
					optionInstrument({
						additionalUnderlyings: [
							{ type: 'cash', underlying: 'USD', amount: new Decimal('12.50') }
						]
					})
				)
			)
		).toThrow('Option simulation supports only standard, unadjusted 100-share contracts.');
	});

	it('rejects contracts expiring on or before the first eligible market session', () => {
		const expiringContract = optionInstrument({ expirationDate: '2026-08-03' });

		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft(),
				instrumentMap(expiringContract),
				'2026-08-03'
			)
		).toThrow(
			`Option contract ${optionSymbol} expires on 2026-08-03; expiration-day orders are not supported.`
		);
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft(),
				instrumentMap(expiringContract),
				'2026-08-04'
			)
		).toThrow(
			`Option contract ${optionSymbol} expires on 2026-08-03; expiration-day orders are not supported.`
		);
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft(),
				instrumentMap(optionInstrument({ expirationDate: '2026-08-04' })),
				'2026-08-03'
			)
		).not.toThrow();
	});

	it('rejects mixed or multi-leg option drafts defensively after resolution', () => {
		const draft = optionDraft();
		const stock = stockInstrumentSchema.parse({
			assetClass: 'stocks',
			symbol: 'AAPL',
			name: 'Apple Inc.',
			currency: 'USD',
			active: true,
			roundLot: '100'
		});
		const mixedDraft = {
			...draft,
			legs: [
				...draft.legs,
				{
					symbol: stock.symbol,
					side: 'buy' as const,
					positionEffect: 'open' as const,
					ratioQuantity: new Decimal(1)
				}
			]
		} as OrderDraft;

		expect(() =>
			assertSupportedOptionOrderSurface(
				mixedDraft,
				new Map<string, Instrument>([
					[optionSymbol, optionInstrument()],
					[stock.symbol, stock]
				])
			)
		).toThrow('Option simulation supports exactly one option contract per order.');
	});

	it.each([
		{ side: 'buy', effect: 'credit', expected: 'debit' },
		{ side: 'sell', effect: 'debit', expected: 'credit' }
	] as const)('rejects a $side option with a $effect effect', ({ side, effect, expected }) => {
		expect(() =>
			assertSupportedOptionOrderSurface(
				optionDraft({
					netPriceEffect: effect,
					leg: { side, positionEffect: side === 'sell' ? 'close' : 'open' }
				}),
				instrumentMap()
			)
		).toThrow(`A single-leg option ${side} order must use a ${expected} price effect.`);
	});
});

describe('Options Starter placement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetMarketHolidayCacheForTests();
		marketMocks.getMarketEnvironment.mockReturnValue({
			apiKey: 'test-key',
			stocksPlan: 'starter',
			optionsPlan: 'starter',
			capabilities: resolveMassiveCapabilities({
				stocksTier: 'starter',
				optionsTier: 'starter'
			})
		});
		portfolioMocks.getPortfolioPolicy.mockResolvedValue({
			portfolioId,
			benchmarkSymbol: 'SPY',
			accountType: 'cash',
			allowShortEquity: false,
			allowLongOptions: true,
			allowExtendedHours: false,
			requireTradePlan: false,
			maxOrderNotional: null,
			maxPositionPercent: null,
			maxGrossExposurePercent: null,
			maxDailyLoss: null,
			maxDrawdownPercent: null,
			maxOptionPremium: null,
			riskBehavior: 'block',
			createdAt: new Date('2026-08-03T12:00:00.000Z'),
			updatedAt: new Date('2026-08-03T12:00:00.000Z')
		});
		portfolioMocks.listPortfolioEquity.mockResolvedValue([]);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('accepts a limit option without snapshot pricing and leaves it open for aggregate execution', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-04T15:00:00.000Z'));
		const provider = {
			getOptionContract: vi.fn(async () => optionInstrument()),
			getUpcomingMarketHolidays: vi.fn(async () => []),
			getUnifiedSnapshots: vi.fn()
		};
		marketMocks.getMarketDataProvider.mockReturnValue(provider);
		const uow = unitOfWork();
		vi.spyOn(drizzleTradingRepository, 'transaction').mockImplementation(
			async (_portfolioId, operation) => operation(uow)
		);

		const result = await placeSimulationOrder({ ownerUserId, draft: optionDraft() });

		expect(result.idempotent).toBe(false);
		expect(result.order.status).toBe('open');
		expect(result.order.filledQuantity.isZero()).toBe(true);
		expect(result.order.executionModelVersion).toBe('sim-execution-v2');
		expect(provider.getOptionContract).toHaveBeenCalledOnce();
		expect(provider.getUnifiedSnapshots).not.toHaveBeenCalled();
		expect(uow.insertOrder).toHaveBeenCalledOnce();
		expect(uow.insertFill).not.toHaveBeenCalled();
		expect(uow.updateOrder).not.toHaveBeenCalled();
		expect(liveExecutionMocks.notifyOrdersChanged).toHaveBeenCalledOnce();
	});

	it('rejects an after-close order whose first eligible session is expiration day', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-06T21:00:00.000Z'));
		const provider = {
			getOptionContract: vi.fn(async () => optionInstrument({ expirationDate: '2026-08-07' })),
			getUpcomingMarketHolidays: vi.fn(async () => [])
		};
		marketMocks.getMarketDataProvider.mockReturnValue(provider);
		const uow = unitOfWork();
		vi.spyOn(drizzleTradingRepository, 'transaction').mockImplementation(
			async (_portfolioId, operation) => operation(uow)
		);

		await expect(placeSimulationOrder({ ownerUserId, draft: optionDraft() })).rejects.toThrow(
			`Option contract ${optionSymbol} expires on 2026-08-07; expiration-day orders are not supported.`
		);
		expect(uow.insertOrder).not.toHaveBeenCalled();
	});

	it('uses the post-lookup acceptance time when a request crosses the delayed session close', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-06T20:14:00.000Z'));
		const provider = {
			getOptionContract: vi.fn(async () => {
				vi.setSystemTime(new Date('2026-08-06T20:16:00.000Z'));
				return optionInstrument({ expirationDate: '2026-08-07' });
			}),
			getUpcomingMarketHolidays: vi.fn(async () => [])
		};
		marketMocks.getMarketDataProvider.mockReturnValue(provider);
		const uow = unitOfWork();
		vi.spyOn(drizzleTradingRepository, 'transaction').mockImplementation(
			async (_portfolioId, operation) => operation(uow)
		);

		await expect(placeSimulationOrder({ ownerUserId, draft: optionDraft() })).rejects.toThrow(
			`Option contract ${optionSymbol} expires on 2026-08-07; expiration-day orders are not supported.`
		);
		expect(uow.insertOrder).not.toHaveBeenCalled();
	});

	it('returns an idempotent replay before current entitlement or provider validation', async () => {
		const draft = optionDraft();
		const existing = createAcceptedOrder({
			id: '00000000-0000-4000-8000-000000000003',
			draft,
			instruments: instrumentMap(),
			acceptedAt: new Date('2026-08-03T14:30:00.000Z')
		});
		const uow = unitOfWork(existing);
		vi.spyOn(drizzleTradingRepository, 'transaction').mockImplementation(
			async (_portfolioId, operation) => operation(uow)
		);
		marketMocks.getMarketEnvironment.mockImplementation(() => {
			throw new Error('Current entitlements are unavailable');
		});
		marketMocks.getMarketDataProvider.mockImplementation(() => {
			throw new Error('The provider should not be reached');
		});

		const result = await placeSimulationOrder({ ownerUserId, draft });

		expect(result).toEqual({ order: existing, preview: null, idempotent: true });
		expect(marketMocks.getMarketEnvironment).not.toHaveBeenCalled();
		expect(marketMocks.getMarketDataProvider).not.toHaveBeenCalled();
		expect(uow.insertOrder).not.toHaveBeenCalled();
	});
});
