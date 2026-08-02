import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { optionInstrumentSchema } from '../market-data/types';
import {
	DrizzleTradingRepository,
	TradingRepositoryDataError,
	instrumentInsertValues,
	mapAcceptedOrderRows,
	mapInstrumentRow,
	mapPositionRow,
	reservationInsertValues,
	type InstrumentRow,
	type OrderLegRow,
	type OrderRow,
	type PositionRow
} from './drizzle-repository';

const portfolioId = '00000000-0000-4000-8000-000000000001';
const orderId = '00000000-0000-4000-8000-000000000002';
const instrumentId = '00000000-0000-4000-8000-000000000003';
const legId = '00000000-0000-4000-8000-000000000004';
const now = new Date('2026-01-02T14:30:00.000Z');

function optionRow(overrides: Partial<InstrumentRow> = {}): InstrumentRow {
	return {
		id: instrumentId,
		symbol: 'O:AAPL260619C00123456',
		assetClass: 'options',
		name: 'AAPL adjusted call',
		currency: 'USD',
		active: true,
		primaryExchange: 'BATO',
		tickerType: null,
		roundLot: null,
		underlyingSymbol: 'AAPL',
		optionType: 'call',
		exerciseStyle: 'american',
		expirationDate: '2026-06-19',
		strikePrice: '123.45678901',
		contractMultiplier: '150',
		additionalUnderlyings: [{ type: 'cash', underlying: 'USD', amount: '12.50000000' }],
		sourceUpdatedAt: now,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function stockRow(overrides: Partial<InstrumentRow> = {}): InstrumentRow {
	return {
		id: instrumentId,
		symbol: 'AAPL',
		assetClass: 'stocks',
		name: 'Apple Inc.',
		currency: 'USD',
		active: true,
		primaryExchange: 'XNAS',
		tickerType: 'CS',
		roundLot: '100',
		underlyingSymbol: null,
		optionType: null,
		exerciseStyle: null,
		expirationDate: null,
		strikePrice: null,
		contractMultiplier: null,
		additionalUnderlyings: [],
		sourceUpdatedAt: now,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
	return {
		id: orderId,
		portfolioId,
		clientOrderId: 'client-order-1',
		orderType: 'limit',
		timeInForce: 'day',
		netPriceEffect: 'debit',
		status: 'partially_filled',
		quantity: '3.00000000',
		filledQuantity: '1.00000000',
		limitPrice: '2.34567891',
		stopPrice: null,
		tradePlanId: null,
		trailingPercent: null,
		trailingWatermark: null,
		trailingStopPrice: null,
		extendedHours: false,
		executionModelVersion: 'sim-execution-v1',
		acceptedAt: now,
		eligibleAt: new Date(now.getTime() + 250),
		triggeredAt: null,
		terminalAt: null,
		rejectionReason: null,
		revision: 2,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function orderLegRow(overrides: Partial<OrderLegRow> = {}): OrderLegRow {
	return {
		id: legId,
		orderId,
		instrumentId,
		legNumber: 1,
		side: 'buy',
		positionEffect: 'open',
		ratioQuantity: '2.00000000',
		filledQuantity: '2.00000000',
		...overrides
	};
}

describe('Drizzle trading row mappers', () => {
	it('reconstructs complete option metadata with exact decimal values', () => {
		const instrument = mapInstrumentRow(optionRow());

		expect(instrument.assetClass).toBe('options');
		if (instrument.assetClass !== 'options') throw new Error('Expected an option');
		expect(instrument.strikePrice.toFixed(8)).toBe('123.45678901');
		expect(instrument.multiplier.toFixed()).toBe('150');
		expect(instrument.exerciseStyle).toBe('american');
		expect(instrument.additionalUnderlyings[0]?.amount.toFixed(2)).toBe('12.50');
	});

	it('reconstructs an accepted order and sorts its resolved legs', () => {
		const secondInstrument = optionRow({
			id: '00000000-0000-4000-8000-000000000005',
			symbol: 'O:AAPL260619C00130000',
			strikePrice: '130.00000000'
		});
		const secondLeg = orderLegRow({
			id: '00000000-0000-4000-8000-000000000006',
			instrumentId: secondInstrument.id,
			legNumber: 2,
			side: 'sell',
			ratioQuantity: '1.00000000',
			filledQuantity: '1.00000000'
		});
		const order = mapAcceptedOrderRows(orderRow(), [
			{ leg: secondLeg, instrument: secondInstrument },
			{ leg: orderLegRow(), instrument: optionRow() }
		]);

		expect(order.legs.map((leg) => leg.symbol)).toEqual([
			'O:AAPL260619C00123456',
			'O:AAPL260619C00130000'
		]);
		expect(order.quantity.toFixed()).toBe('3');
		expect(order.limitPrice?.toFixed(8)).toBe('2.34567891');
		expect(order.filledQuantity.toFixed()).toBe('1');
		expect(order.executionModelVersion).toBe('sim-execution-v1');
		expect(order.eligibleAt.toISOString()).toBe('2026-01-02T14:30:00.250Z');
	});

	it('maps positions and rejects structurally invalid instrument rows', () => {
		const position: PositionRow = {
			id: '00000000-0000-4000-8000-000000000007',
			portfolioId,
			instrumentId,
			quantity: '12.50000000',
			averageCost: '201.12345678',
			realizedPnl: '-4.25000000',
			updatedAt: now
		};

		const mapped = mapPositionRow({ position, instrument: stockRow() });

		expect(mapped.quantity.toFixed(1)).toBe('12.5');
		expect(mapped.averageCost.toFixed(8)).toBe('201.12345678');
		expect(mapped.realizedPnl.toFixed(2)).toBe('-4.25');
		expect(() => mapInstrumentRow(stockRow({ roundLot: null }))).toThrow(
			TradingRepositoryDataError
		);
	});

	it('serializes Decimal option fields without converting through Number', () => {
		const instrument = optionInstrumentSchema.parse({
			assetClass: 'options',
			symbol: 'O:AAPL260619P00123456',
			name: 'AAPL put',
			currency: 'USD',
			active: true,
			underlyingSymbol: 'AAPL',
			optionType: 'put',
			exerciseStyle: 'european',
			expirationDate: '2026-06-19',
			strikePrice: new Decimal('123.45678901'),
			multiplier: new Decimal('100'),
			additionalUnderlyings: [
				{ type: 'cash', underlying: 'USD', amount: new Decimal('0.12345678') }
			]
		});

		const values = instrumentInsertValues(instrument);

		expect(values.strikePrice).toBe('123.45678901');
		expect(values.contractMultiplier).toBe('100');
		expect(values.additionalUnderlyings).toEqual([
			{ type: 'cash', underlying: 'USD', amount: '0.12345678' }
		]);
	});

	it('can be constructed without loading database environment state', () => {
		const repository = new DrizzleTradingRepository();

		expect(repository).toBeInstanceOf(DrizzleTradingRepository);
	});

	it('builds exact cash and per-symbol share reservations', () => {
		const values = reservationInsertValues(
			{
				orderId,
				portfolioId,
				cashAmount: new Decimal('1234.56789012'),
				shareQuantities: new Map([
					['AAPL', new Decimal(100)],
					['MSFT', new Decimal('12.5')]
				])
			},
			new Map([
				['AAPL', '00000000-0000-4000-8000-000000000008'],
				['MSFT', '00000000-0000-4000-8000-000000000009']
			])
		);

		expect(values).toMatchObject([
			{ reservationType: 'cash', amount: '1234.56789012', instrumentId: null },
			{
				reservationType: 'shares',
				amount: '100',
				instrumentId: '00000000-0000-4000-8000-000000000008'
			},
			{
				reservationType: 'shares',
				amount: '12.5',
				instrumentId: '00000000-0000-4000-8000-000000000009'
			}
		]);
		expect(
			reservationInsertValues(
				{
					orderId,
					portfolioId,
					cashAmount: new Decimal(0),
					shareQuantities: new Map()
				},
				new Map()
			)
		).toEqual([]);
		expect(() =>
			reservationInsertValues(
				{
					orderId,
					portfolioId,
					cashAmount: new Decimal(0),
					shareQuantities: new Map([['UNKNOWN', new Decimal(1)]])
				},
				new Map()
			)
		).toThrow(TradingRepositoryDataError);
	});
});
