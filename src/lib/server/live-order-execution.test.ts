import Decimal from 'decimal.js';
import {
	resolveMassiveCapabilities,
	type AssetClass,
	type NormalizedBar,
	type OptionInstrument
} from '$lib/server/market-data';
import {
	SIMULATION_EXECUTION_MODEL,
	SIMULATION_FEE_MODEL,
	calculateBarFill,
	type AcceptedOrder,
	type ExecutableBarContext
} from '$lib/server/trading';
import { describe, expect, it } from 'vitest';
import {
	hasAvailableCashForLiveFill,
	hasOptionLegAtOrPastExpiration,
	isDayOrderExpired,
	liveOrderDelayMilliseconds,
	planLiveOrderTopics,
	shouldEvaluateAggregateBar,
	supportsLiveAggregateOrder
} from './live-order-execution';

const optionSymbol = 'O:AAPL260918C00200000';

function topicLeg(symbol: string, assetClass: AssetClass, ratioQuantity = new Decimal(1)) {
	return { symbol, assetClass, ratioQuantity };
}

function optionBar(overrides: Partial<NormalizedBar> = {}): NormalizedBar {
	const startTime = new Date('2026-08-03T15:00:00.000Z');
	const endTime = new Date('2026-08-03T15:00:01.000Z');
	return {
		kind: 'bar',
		assetClass: 'options',
		symbol: optionSymbol,
		mode: 'delayed',
		interval: 'second',
		startTime,
		endTime,
		open: new Decimal('2.50'),
		high: new Decimal('2.60'),
		low: new Decimal('2.40'),
		close: new Decimal('2.55'),
		volume: new Decimal(8),
		sourceTime: endTime,
		receivedAt: new Date('2026-08-03T15:15:01.000Z'),
		rawTimestamp: endTime.getTime().toString(),
		...overrides
	};
}

function optionOrder(): AcceptedOrder {
	const instrument: OptionInstrument = {
		assetClass: 'options',
		symbol: optionSymbol,
		name: 'AAPL Sep 2026 200 Call',
		currency: 'USD',
		active: true,
		underlyingSymbol: 'AAPL',
		optionType: 'call',
		exerciseStyle: 'american',
		expirationDate: '2026-09-18',
		strikePrice: new Decimal(200),
		multiplier: new Decimal(100),
		additionalUnderlyings: []
	};
	return {
		id: '11111111-1111-4111-8111-111111111111',
		portfolioId: '22222222-2222-4222-8222-222222222222',
		clientOrderId: 'option-limit-order',
		type: 'limit',
		timeInForce: 'day',
		quantity: new Decimal(10),
		limitPrice: new Decimal(2),
		netPriceEffect: 'credit',
		extendedHours: false,
		legs: [
			{
				symbol: optionSymbol,
				side: 'sell',
				positionEffect: 'close',
				ratioQuantity: new Decimal(1),
				instrument
			}
		],
		status: 'open',
		executionModelVersion: SIMULATION_EXECUTION_MODEL.version,
		filledQuantity: new Decimal(0),
		acceptedAt: new Date('2026-08-03T15:14:59.000Z'),
		eligibleAt: new Date('2026-08-03T15:15:00.000Z'),
		revision: 0
	};
}

function barContext(bar: NormalizedBar): ExecutableBarContext {
	return {
		attemptAt: bar.receivedAt,
		expectedMode: 'delayed',
		expectedDelayMilliseconds: 15 * 60 * 1_000,
		maxTransportAgeMilliseconds: 60_000,
		maxSourceAgeMilliseconds: 60_000,
		futureToleranceMilliseconds: 0
	};
}

describe('live order topic planning', () => {
	it('uses only per-second aggregates for supported stock and option orders', () => {
		expect(
			planLiveOrderTopics([
				{
					orderType: 'limit',
					timeInForce: 'gtc',
					dataMode: 'realtime',
					legs: [topicLeg('AAPL', 'stocks')]
				},
				{
					orderType: 'trailing_stop',
					timeInForce: 'day',
					dataMode: 'realtime',
					legs: [topicLeg('TSLA', 'stocks')]
				},
				{
					orderType: 'limit',
					timeInForce: 'day',
					dataMode: 'delayed',
					legs: [topicLeg(optionSymbol, 'options')]
				},
				{
					orderType: 'market',
					timeInForce: 'ioc',
					dataMode: 'realtime',
					legs: [topicLeg('MSFT', 'stocks')]
				}
			])
		).toEqual({
			realtime: {
				stocks: ['A.AAPL'],
				options: []
			},
			delayed: {
				stocks: [],
				options: [`A.${optionSymbol}`]
			}
		});
	});

	it('does not subscribe unsupported option order shapes', () => {
		const unsupported = [
			{
				orderType: 'market' as const,
				timeInForce: 'day' as const,
				legs: [topicLeg(optionSymbol, 'options')]
			},
			{
				orderType: 'stop' as const,
				timeInForce: 'day' as const,
				legs: [topicLeg(optionSymbol, 'options')]
			},
			{
				orderType: 'limit' as const,
				timeInForce: 'gtc' as const,
				legs: [topicLeg(optionSymbol, 'options')]
			},
			{
				orderType: 'limit' as const,
				timeInForce: 'day' as const,
				legs: [topicLeg(optionSymbol, 'options'), topicLeg('O:AAPL260918C00210000', 'options')]
			},
			{
				orderType: 'limit' as const,
				timeInForce: 'day' as const,
				legs: [topicLeg(optionSymbol, 'options', new Decimal(2))]
			}
		];

		for (const order of unsupported) expect(supportsLiveAggregateOrder(order)).toBe(false);
		expect(
			planLiveOrderTopics(unsupported.map((order) => ({ ...order, dataMode: 'delayed' as const })))
		).toEqual({
			realtime: { stocks: [], options: [] },
			delayed: { stocks: [], options: [] }
		});
	});

	it('requires market access matching the portfolio mode and one logical delay', () => {
		const stocksStarter = resolveMassiveCapabilities({ stocksTier: 'starter' });
		const delayedStock = {
			dataMode: 'delayed' as const,
			legs: [topicLeg('AAPL', 'stocks')]
		};
		expect(liveOrderDelayMilliseconds(delayedStock, stocksStarter)).toBe(15 * 60 * 1_000);
		expect(
			liveOrderDelayMilliseconds({ ...delayedStock, dataMode: 'realtime' }, stocksStarter)
		).toBeUndefined();
		expect(
			liveOrderDelayMilliseconds(
				{ dataMode: 'delayed', legs: [topicLeg(optionSymbol, 'options')] },
				stocksStarter
			)
		).toBeUndefined();

		const optionsStarter = resolveMassiveCapabilities({
			stocksTier: 'starter',
			optionsTier: 'starter'
		});
		expect(
			liveOrderDelayMilliseconds(
				{ dataMode: 'delayed', legs: [topicLeg(optionSymbol, 'options')] },
				optionsStarter
			)
		).toBe(15 * 60 * 1_000);
	});
});

describe('DAY order expiry', () => {
	it('preserves aggregate arrival grace at the delayed exchange-session boundary', () => {
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
		expect(
			isDayOrderExpired({
				...input,
				timeInForce: 'day',
				arrivalGraceMilliseconds: 5_000,
				at: new Date(expiresAt.getTime() + 4_999)
			})
		).toBe(false);
		expect(
			isDayOrderExpired({
				...input,
				timeInForce: 'day',
				arrivalGraceMilliseconds: 5_000,
				at: new Date(expiresAt.getTime() + 5_000)
			})
		).toBe(true);
		expect(isDayOrderExpired({ ...input, timeInForce: 'gtc', at: expiresAt })).toBe(false);
	});
});

describe('option aggregate execution', () => {
	it('does not allow option fills on or after the New York expiration date', () => {
		const order = optionOrder();
		expect(hasOptionLegAtOrPastExpiration(order.legs, new Date('2026-09-17T20:00:00.000Z'))).toBe(
			false
		);
		expect(hasOptionLegAtOrPastExpiration(order.legs, new Date('2026-09-18T13:30:00.000Z'))).toBe(
			true
		);
	});

	it('requires post-eligibility receipt and source time and rejects duplicate bars', () => {
		const bar = optionBar();
		const eligibleAt = new Date('2026-08-03T15:15:00.000Z');
		expect(shouldEvaluateAggregateBar({ bar, barContext: barContext(bar), eligibleAt })).toBe(true);
		expect(
			shouldEvaluateAggregateBar({
				bar,
				barContext: barContext(bar),
				eligibleAt,
				lastEvaluatedBarEndAt: bar.endTime
			})
		).toBe(false);

		const receivedTooEarly = optionBar({
			receivedAt: new Date(eligibleAt.getTime() - 1)
		});
		expect(
			shouldEvaluateAggregateBar({
				bar: receivedTooEarly,
				barContext: barContext(receivedTooEarly),
				eligibleAt
			})
		).toBe(false);

		expect(
			shouldEvaluateAggregateBar({
				bar,
				barContext: barContext(bar),
				eligibleAt: new Date('2026-08-03T15:15:00.500Z')
			})
		).toBe(false);
	});

	it('uses whole-contract participation capacity and collars favorable option sells', () => {
		const order = optionOrder();
		const bar = optionBar({
			open: new Decimal(3),
			high: new Decimal('3.10'),
			low: new Decimal('2.90'),
			close: new Decimal(3)
		});
		const result = calculateBarFill({
			order,
			bar,
			executionModel: SIMULATION_EXECUTION_MODEL,
			barContext: barContext(bar),
			feeModel: SIMULATION_FEE_MODEL
		});

		expect(result.fill?.strategyQuantity.toFixed()).toBe('2');
		expect(result.fill?.legs[0]?.price.toFixed(2)).toBe(order.limitPrice?.toFixed(2));
		expect(result.fill?.legs[0]?.fee.toFixed(2)).toBe('1.30');
		expect(result.fill?.executionModelVersion).toBe(SIMULATION_EXECUTION_MODEL.version);
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
