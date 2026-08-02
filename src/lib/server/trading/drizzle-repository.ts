import Decimal from 'decimal.js';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db';
import {
	tradingCashLedger,
	tradingFillLegs,
	tradingFills,
	tradingInstruments,
	tradingOrderEvents,
	tradingOrderLegs,
	tradingOrders,
	tradingPortfolios,
	tradingPositions,
	tradingReservations
} from '../db/schema/trading';
import { decimal, decimalString } from '../market-data/numeric';
import {
	instrumentSchema,
	marketDataModeSchema,
	optionInstrumentSchema,
	stockInstrumentSchema,
	type Instrument
} from '../market-data/types';
import { fillGrossAmount } from './execution';
import type { CashLedgerEntry } from './ledger';
import type {
	OrderReservationConsumption,
	OrderReservationRequest,
	PersistedFill,
	PersistedPortfolio,
	PersistedRiskState,
	TradingRepository,
	TradingUnitOfWork
} from './repository';
import {
	netPriceEffectSchema,
	orderDraftSchema,
	orderStatusSchema,
	orderTypeSchema,
	positionEffectSchema,
	positionSchema,
	timeInForceSchema,
	type AcceptedOrder,
	type OrderStatus,
	type Position
} from './types';

type ApplicationDatabase = typeof db;
type TransactionClient = Parameters<Parameters<ApplicationDatabase['transaction']>[0]>[0];

export type InstrumentRow = typeof tradingInstruments.$inferSelect;
export type OrderRow = typeof tradingOrders.$inferSelect;
export type OrderLegRow = typeof tradingOrderLegs.$inferSelect;
export type PositionRow = typeof tradingPositions.$inferSelect;

export interface OrderLegWithInstrumentRow {
	leg: OrderLegRow;
	instrument: InstrumentRow;
}

export interface PositionWithInstrumentRow {
	position: PositionRow;
	instrument: InstrumentRow;
}

export class TradingRepositoryDataError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'TradingRepositoryDataError';
	}
}

function parseRow<T>(description: string, operation: () => T): T {
	try {
		return operation();
	} catch (error) {
		throw new TradingRepositoryDataError(`Invalid ${description} persisted by the trading store`, {
			cause: error
		});
	}
}

export function mapInstrumentRow(row: InstrumentRow): Instrument {
	return parseRow(`instrument ${row.symbol}`, () => {
		if (row.assetClass === 'stocks') {
			return stockInstrumentSchema.parse({
				assetClass: 'stocks',
				symbol: row.symbol,
				name: row.name,
				currency: row.currency,
				active: row.active,
				primaryExchange: row.primaryExchange ?? undefined,
				tickerType: row.tickerType ?? undefined,
				roundLot: row.roundLot
			});
		}
		if (row.assetClass === 'options') {
			return optionInstrumentSchema.parse({
				assetClass: 'options',
				symbol: row.symbol,
				name: row.name,
				currency: row.currency,
				active: row.active,
				primaryExchange: row.primaryExchange ?? undefined,
				underlyingSymbol: row.underlyingSymbol,
				optionType: row.optionType,
				exerciseStyle: row.exerciseStyle,
				expirationDate: row.expirationDate,
				strikePrice: row.strikePrice,
				multiplier: row.contractMultiplier,
				additionalUnderlyings: row.additionalUnderlyings
			});
		}
		throw new TradingRepositoryDataError(`Unknown asset class ${row.assetClass}`);
	});
}

export function mapAcceptedOrderRows(
	order: OrderRow,
	legRows: readonly OrderLegWithInstrumentRow[]
): AcceptedOrder {
	return parseRow(`order ${order.id}`, () => {
		if (!order.acceptedAt || !order.eligibleAt) {
			throw new TradingRepositoryDataError(
				'Accepted orders require acceptance and eligibility times'
			);
		}
		const legs = [...legRows]
			.sort((left, right) => left.leg.legNumber - right.leg.legNumber)
			.map(({ leg, instrument }) => {
				const mappedInstrument = mapInstrumentRow(instrument);
				if (mappedInstrument.symbol !== instrument.symbol) {
					throw new TradingRepositoryDataError('Order leg instrument symbol is inconsistent');
				}
				return {
					symbol: mappedInstrument.symbol,
					side: z.enum(['buy', 'sell']).parse(leg.side),
					positionEffect: positionEffectSchema.parse(leg.positionEffect),
					ratioQuantity: decimal(leg.ratioQuantity),
					instrument: mappedInstrument
				};
			});
		const draft = orderDraftSchema.parse({
			portfolioId: order.portfolioId,
			tradePlanId: order.tradePlanId ?? undefined,
			clientOrderId: order.clientOrderId,
			type: orderTypeSchema.parse(order.orderType),
			timeInForce: timeInForceSchema.parse(order.timeInForce),
			quantity: order.quantity,
			limitPrice: order.limitPrice ?? undefined,
			stopPrice: order.stopPrice ?? undefined,
			trailingPercent: order.trailingPercent ?? undefined,
			netPriceEffect: netPriceEffectSchema.parse(order.netPriceEffect),
			extendedHours: order.extendedHours,
			legs: legs.map(({ symbol, side, positionEffect, ratioQuantity }) => ({
				symbol,
				side,
				positionEffect,
				ratioQuantity
			}))
		});

		return {
			...draft,
			id: order.id,
			legs,
			status: orderStatusSchema.parse(order.status),
			executionModelVersion: order.executionModelVersion,
			filledQuantity: decimal(order.filledQuantity),
			acceptedAt: order.acceptedAt,
			eligibleAt: order.eligibleAt,
			triggeredAt: order.triggeredAt ?? undefined,
			trailingWatermark:
				order.trailingWatermark === null ? undefined : decimal(order.trailingWatermark),
			trailingStopPrice:
				order.trailingStopPrice === null ? undefined : decimal(order.trailingStopPrice),
			terminalAt: order.terminalAt ?? undefined,
			rejectionReason: order.rejectionReason ?? undefined,
			revision: order.revision
		};
	});
}

export function mapPositionRow(row: PositionWithInstrumentRow): Position {
	return parseRow(`position ${row.position.id}`, () =>
		positionSchema.parse({
			instrument: mapInstrumentRow(row.instrument),
			quantity: row.position.quantity,
			averageCost: row.position.averageCost,
			realizedPnl: row.position.realizedPnl
		})
	);
}

export function instrumentInsertValues(
	instrumentInput: Instrument
): typeof tradingInstruments.$inferInsert {
	const instrument = instrumentSchema.parse(instrumentInput);
	const base = {
		symbol: instrument.symbol,
		assetClass: instrument.assetClass,
		name: instrument.name,
		currency: instrument.currency,
		active: instrument.active,
		primaryExchange: instrument.primaryExchange ?? null,
		updatedAt: new Date()
	};
	if (instrument.assetClass === 'stocks') {
		return {
			...base,
			tickerType: instrument.tickerType ?? null,
			roundLot: decimalString(instrument.roundLot),
			underlyingSymbol: null,
			optionType: null,
			exerciseStyle: null,
			expirationDate: null,
			strikePrice: null,
			contractMultiplier: null,
			additionalUnderlyings: []
		};
	}
	return {
		...base,
		tickerType: null,
		roundLot: null,
		underlyingSymbol: instrument.underlyingSymbol,
		optionType: instrument.optionType,
		exerciseStyle: instrument.exerciseStyle,
		expirationDate: instrument.expirationDate,
		strikePrice: decimalString(instrument.strikePrice),
		contractMultiplier: decimalString(instrument.multiplier),
		additionalUnderlyings: instrument.additionalUnderlyings.map((underlying) => ({
			type: underlying.type,
			underlying: underlying.underlying,
			amount: decimalString(underlying.amount)
		}))
	};
}

function orderValues(order: AcceptedOrder): typeof tradingOrders.$inferInsert {
	return {
		id: order.id,
		portfolioId: order.portfolioId,
		tradePlanId: order.tradePlanId ?? null,
		clientOrderId: order.clientOrderId,
		orderType: order.type,
		timeInForce: order.timeInForce,
		netPriceEffect: order.netPriceEffect,
		status: order.status,
		quantity: decimalString(order.quantity),
		filledQuantity: decimalString(order.filledQuantity),
		limitPrice: order.limitPrice ? decimalString(order.limitPrice) : null,
		stopPrice: order.stopPrice ? decimalString(order.stopPrice) : null,
		trailingPercent: order.trailingPercent ? decimalString(order.trailingPercent) : null,
		trailingWatermark: order.trailingWatermark ? decimalString(order.trailingWatermark) : null,
		trailingStopPrice: order.trailingStopPrice ? decimalString(order.trailingStopPrice) : null,
		extendedHours: order.extendedHours,
		executionModelVersion: order.executionModelVersion,
		acceptedAt: order.acceptedAt,
		eligibleAt: order.eligibleAt,
		triggeredAt: order.triggeredAt ?? null,
		terminalAt: order.terminalAt ?? null,
		rejectionReason: order.rejectionReason ?? null,
		revision: order.revision,
		updatedAt: new Date()
	};
}

export function reservationInsertValues(
	input: OrderReservationRequest,
	instrumentIds: ReadonlyMap<string, string>
): Array<typeof tradingReservations.$inferInsert> {
	if (input.cashAmount.isNegative()) {
		throw new TradingRepositoryDataError('Reserved cash cannot be negative');
	}
	const values: Array<typeof tradingReservations.$inferInsert> = [];
	if (input.cashAmount.greaterThan(0)) {
		values.push({
			orderId: input.orderId,
			portfolioId: input.portfolioId,
			instrumentId: null,
			reservationType: 'cash',
			amount: decimalString(input.cashAmount),
			status: 'active'
		});
	}
	for (const [symbol, quantity] of input.shareQuantities) {
		if (!quantity.greaterThan(0)) {
			throw new TradingRepositoryDataError(
				`Reserved share quantity for ${symbol} must be positive`
			);
		}
		const instrumentId = instrumentIds.get(symbol);
		if (!instrumentId) {
			throw new TradingRepositoryDataError(`No database instrument exists for ${symbol}`);
		}
		values.push({
			orderId: input.orderId,
			portfolioId: input.portfolioId,
			instrumentId,
			reservationType: 'shares',
			amount: decimalString(quantity),
			status: 'active'
		});
	}
	return values;
}

class DrizzleTradingUnitOfWork implements TradingUnitOfWork {
	constructor(
		private readonly transactionClient: TransactionClient,
		private readonly portfolioId: string
	) {}

	async getPortfolioForUpdate(
		portfolioId: string,
		ownerUserId: string
	): Promise<PersistedPortfolio | null> {
		this.#assertPortfolio(portfolioId);
		const [portfolio] = await this.transactionClient
			.select()
			.from(tradingPortfolios)
			.where(
				and(eq(tradingPortfolios.id, portfolioId), eq(tradingPortfolios.ownerUserId, ownerUserId))
			)
			.limit(1)
			.for('update');
		if (!portfolio) return null;

		const [cash] = await this.transactionClient
			.select({
				balance: sql<string>`coalesce(sum(${tradingCashLedger.amount}), 0)::text`
			})
			.from(tradingCashLedger)
			.where(eq(tradingCashLedger.portfolioId, portfolioId));
		const [reserved] = await this.transactionClient
			.select({
				amount: sql<string>`coalesce(sum(${tradingReservations.amount}), 0)::text`
			})
			.from(tradingReservations)
			.where(
				and(
					eq(tradingReservations.portfolioId, portfolioId),
					eq(tradingReservations.status, 'active'),
					or(
						eq(tradingReservations.reservationType, 'cash'),
						eq(tradingReservations.reservationType, 'buying_power')
					)
				)
			);

		return parseRow(`portfolio ${portfolio.id}`, () => ({
			id: portfolio.id,
			ownerUserId: portfolio.ownerUserId,
			name: portfolio.name,
			baseCurrency: z.literal('USD').parse(portfolio.baseCurrency),
			startingCash: decimal(portfolio.startingCash),
			cashBalance: decimal(cash?.balance ?? '0'),
			reservedCash: decimal(reserved?.amount ?? '0'),
			dataMode: marketDataModeSchema.parse(portfolio.dataMode),
			status: z.enum(['active', 'archived']).parse(portfolio.status)
		}));
	}

	async getOrderForUpdate(orderId: string): Promise<AcceptedOrder | null> {
		const order = await this.#findOrder(
			and(eq(tradingOrders.id, orderId), eq(tradingOrders.portfolioId, this.portfolioId))
		);
		return order;
	}

	async findOrderByClientId(
		portfolioId: string,
		clientOrderId: string
	): Promise<AcceptedOrder | null> {
		this.#assertPortfolio(portfolioId);
		return this.#findOrder(
			and(
				eq(tradingOrders.portfolioId, portfolioId),
				eq(tradingOrders.clientOrderId, clientOrderId)
			)
		);
	}

	async getPositionsForUpdate(
		portfolioId: string,
		symbols: readonly string[]
	): Promise<Map<string, Position>> {
		this.#assertPortfolio(portfolioId);
		if (symbols.length === 0) return new Map();
		const rows = await this.transactionClient
			.select({ position: tradingPositions, instrument: tradingInstruments })
			.from(tradingPositions)
			.innerJoin(tradingInstruments, eq(tradingPositions.instrumentId, tradingInstruments.id))
			.where(
				and(
					eq(tradingPositions.portfolioId, portfolioId),
					inArray(tradingInstruments.symbol, [...new Set(symbols)])
				)
			)
			.for('update', { of: tradingPositions });
		return new Map(rows.map((row) => [row.instrument.symbol, mapPositionRow(row)]));
	}

	async getRiskStateForUpdate(
		portfolioId: string,
		ownerUserId: string,
		symbols: readonly string[]
	): Promise<PersistedRiskState | null> {
		this.#assertPortfolio(portfolioId);
		const [portfolio] = await this.transactionClient
			.select({ id: tradingPortfolios.id })
			.from(tradingPortfolios)
			.where(
				and(eq(tradingPortfolios.id, portfolioId), eq(tradingPortfolios.ownerUserId, ownerUserId))
			)
			.limit(1)
			.for('update');
		if (!portfolio) return null;

		const openOrders = await this.transactionClient
			.select({ id: tradingOrders.id })
			.from(tradingOrders)
			.where(
				and(
					eq(tradingOrders.portfolioId, portfolioId),
					inArray(tradingOrders.status, ['pending_new', 'open', 'partially_filled'])
				)
			)
			.for('update');
		const reservedPositionQuantities = new Map<string, Decimal>();
		const uniqueSymbols = [...new Set(symbols)];
		if (uniqueSymbols.length > 0) {
			const reservations = await this.transactionClient
				.select({
					symbol: tradingInstruments.symbol,
					amount: tradingReservations.amount
				})
				.from(tradingReservations)
				.innerJoin(tradingInstruments, eq(tradingReservations.instrumentId, tradingInstruments.id))
				.where(
					and(
						eq(tradingReservations.portfolioId, portfolioId),
						eq(tradingReservations.status, 'active'),
						eq(tradingReservations.reservationType, 'shares'),
						inArray(tradingInstruments.symbol, uniqueSymbols)
					)
				)
				.for('update', { of: tradingReservations });
			for (const reservation of reservations) {
				const current = reservedPositionQuantities.get(reservation.symbol) ?? new Decimal(0);
				reservedPositionQuantities.set(
					reservation.symbol,
					current.plus(decimal(reservation.amount))
				);
			}
		}

		return { openOrderCount: openOrders.length, reservedPositionQuantities };
	}

	async getActiveOrderCashReservationForUpdate(orderId: string): Promise<Decimal> {
		await this.#assertOrder(orderId);
		const reservations = await this.transactionClient
			.select({ amount: tradingReservations.amount })
			.from(tradingReservations)
			.where(
				and(
					eq(tradingReservations.orderId, orderId),
					eq(tradingReservations.portfolioId, this.portfolioId),
					eq(tradingReservations.status, 'active'),
					inArray(tradingReservations.reservationType, ['cash', 'buying_power'])
				)
			)
			.for('update');
		return reservations.reduce(
			(total, reservation) => total.plus(decimal(reservation.amount)),
			new Decimal(0)
		);
	}

	async insertOrder(order: AcceptedOrder): Promise<void> {
		this.#assertPortfolio(order.portfolioId);
		const instrumentIds = await this.#upsertInstruments(order.legs.map((leg) => leg.instrument));
		await this.transactionClient.insert(tradingOrders).values(orderValues(order));
		await this.transactionClient.insert(tradingOrderLegs).values(
			order.legs.map((leg, index) => ({
				orderId: order.id,
				instrumentId: this.#instrumentId(instrumentIds, leg.symbol),
				legNumber: index + 1,
				side: leg.side,
				positionEffect: leg.positionEffect,
				ratioQuantity: decimalString(leg.ratioQuantity),
				filledQuantity: decimalString(order.filledQuantity.times(leg.ratioQuantity))
			}))
		);
	}

	async insertOrderReservations(input: OrderReservationRequest): Promise<void> {
		this.#assertPortfolio(input.portfolioId);
		await this.#assertOrder(input.orderId);
		const [existing] = await this.transactionClient
			.select({ id: tradingReservations.id })
			.from(tradingReservations)
			.where(
				and(
					eq(tradingReservations.orderId, input.orderId),
					eq(tradingReservations.portfolioId, this.portfolioId)
				)
			)
			.limit(1)
			.for('update');
		if (existing) {
			throw new TradingRepositoryDataError('Order reservations already exist');
		}

		const symbols = [...input.shareQuantities.keys()];
		const instrumentIds = new Map<string, string>();
		if (symbols.length > 0) {
			const rows = await this.transactionClient
				.select({ id: tradingInstruments.id, symbol: tradingInstruments.symbol })
				.from(tradingInstruments)
				.where(inArray(tradingInstruments.symbol, symbols));
			for (const row of rows) instrumentIds.set(row.symbol, row.id);
		}
		const values = reservationInsertValues(input, instrumentIds);
		if (values.length > 0) await this.transactionClient.insert(tradingReservations).values(values);
	}

	async updateOrder(order: AcceptedOrder, expectedRevision: number): Promise<boolean> {
		this.#assertPortfolio(order.portfolioId);
		if (order.revision !== expectedRevision + 1) {
			throw new TradingRepositoryDataError(
				'An order update must advance exactly one optimistic revision'
			);
		}
		const [updated] = await this.transactionClient
			.update(tradingOrders)
			.set(orderValues(order))
			.where(
				and(
					eq(tradingOrders.id, order.id),
					eq(tradingOrders.portfolioId, this.portfolioId),
					eq(tradingOrders.revision, expectedRevision)
				)
			)
			.returning({ id: tradingOrders.id });
		if (!updated) return false;

		for (const [index, leg] of order.legs.entries()) {
			const [updatedLeg] = await this.transactionClient
				.update(tradingOrderLegs)
				.set({ filledQuantity: decimalString(order.filledQuantity.times(leg.ratioQuantity)) })
				.where(
					and(eq(tradingOrderLegs.orderId, order.id), eq(tradingOrderLegs.legNumber, index + 1))
				)
				.returning({ id: tradingOrderLegs.id });
			if (!updatedLeg) {
				throw new TradingRepositoryDataError(`Order ${order.id} is missing leg ${index + 1}`);
			}
		}
		return true;
	}

	async insertFill(persisted: PersistedFill): Promise<void> {
		const fill = persisted.fill;
		this.#assertPortfolio(fill.portfolioId);
		if (!fill.strategyQuantity.greaterThan(0) || fill.legs.length === 0) {
			throw new TradingRepositoryDataError('A fill requires positive strategy quantity and legs');
		}

		const [order] = await this.transactionClient
			.select({ id: tradingOrders.id })
			.from(tradingOrders)
			.where(
				and(eq(tradingOrders.id, fill.orderId), eq(tradingOrders.portfolioId, this.portfolioId))
			)
			.limit(1)
			.for('update');
		if (!order)
			throw new TradingRepositoryDataError('Fill order is outside the transaction portfolio');

		const orderLegRows = await this.transactionClient
			.select({ leg: tradingOrderLegs, instrument: tradingInstruments })
			.from(tradingOrderLegs)
			.innerJoin(tradingInstruments, eq(tradingOrderLegs.instrumentId, tradingInstruments.id))
			.where(eq(tradingOrderLegs.orderId, fill.orderId))
			.orderBy(asc(tradingOrderLegs.legNumber));
		if (orderLegRows.length !== fill.legs.length) {
			throw new TradingRepositoryDataError('A strategy fill must contain every order leg');
		}
		const orderLegsBySymbol = new Map(
			orderLegRows.map((row) => [row.instrument.symbol, row] as const)
		);

		const childValues = fill.legs.map((fillLeg) => {
			const stored = orderLegsBySymbol.get(fillLeg.leg.symbol);
			if (!stored) {
				throw new TradingRepositoryDataError(
					`Fill leg ${fillLeg.leg.symbol} is not part of the order`
				);
			}
			const expectedQuantity = fill.strategyQuantity.times(stored.leg.ratioQuantity);
			if (
				!fillLeg.quantity.equals(expectedQuantity) ||
				fillLeg.leg.side !== stored.leg.side ||
				fillLeg.leg.positionEffect !== stored.leg.positionEffect
			) {
				throw new TradingRepositoryDataError(
					`Fill leg ${fillLeg.leg.symbol} does not match its order leg`
				);
			}
			const instrument = mapInstrumentRow(stored.instrument);
			const multiplier =
				instrument.assetClass === 'options' ? instrument.multiplier : new Decimal(1);
			return {
				fillId: persisted.id,
				orderLegId: stored.leg.id,
				instrumentId: stored.instrument.id,
				quantity: decimalString(fillLeg.quantity),
				price: decimalString(fillLeg.price),
				multiplier: decimalString(multiplier),
				grossAmount: decimalString(
					fillGrossAmount({ ...fillLeg, leg: { ...fillLeg.leg, instrument } })
				),
				fees: decimalString(fillLeg.fee)
			};
		});

		await this.transactionClient.insert(tradingFills).values({
			id: persisted.id,
			orderId: fill.orderId,
			portfolioId: fill.portfolioId,
			strategyQuantity: decimalString(fill.strategyQuantity),
			marketDataMode: fill.marketDataMode,
			sourceEventKind: fill.sourceEventKind,
			sourceTimestamp: fill.sourceTime,
			receivedAt: fill.receivedAt,
			sourceSequence: fill.sourceSequence ?? null,
			executionModelVersion: fill.executionModelVersion
		});
		await this.transactionClient.insert(tradingFillLegs).values(childValues);
	}

	async insertLedgerEntries(entries: readonly CashLedgerEntry[]): Promise<void> {
		if (entries.length === 0) return;
		for (const entry of entries) this.#assertPortfolio(entry.portfolioId);
		await this.transactionClient.insert(tradingCashLedger).values(
			entries.map((entry) => ({
				id: entry.id,
				portfolioId: entry.portfolioId,
				fillId: entry.fillId ?? null,
				entryType: entry.type,
				amount: decimalString(entry.amount),
				currency: entry.currency,
				description: entry.description,
				occurredAt: entry.occurredAt
			}))
		);
	}

	async upsertPositions(
		portfolioId: string,
		positions: ReadonlyMap<string, Position>
	): Promise<void> {
		this.#assertPortfolio(portfolioId);
		if (positions.size === 0) return;
		const parsedPositions = [...positions.entries()].map(([symbol, position]) => {
			const parsed = positionSchema.parse(position);
			if (symbol !== parsed.instrument.symbol) {
				throw new TradingRepositoryDataError(
					'Position map key does not match its instrument symbol'
				);
			}
			return parsed;
		});
		const instrumentIds = await this.#upsertInstruments(
			parsedPositions.map((position) => position.instrument)
		);

		for (const position of parsedPositions) {
			const values = {
				portfolioId,
				instrumentId: this.#instrumentId(instrumentIds, position.instrument.symbol),
				quantity: decimalString(position.quantity),
				averageCost: decimalString(position.averageCost),
				realizedPnl: decimalString(position.realizedPnl),
				updatedAt: new Date()
			};
			await this.transactionClient
				.insert(tradingPositions)
				.values(values)
				.onConflictDoUpdate({
					target: [tradingPositions.portfolioId, tradingPositions.instrumentId],
					set: {
						quantity: values.quantity,
						averageCost: values.averageCost,
						realizedPnl: values.realizedPnl,
						updatedAt: values.updatedAt
					}
				});
		}
	}

	async consumeOrderReservations(input: OrderReservationConsumption): Promise<void> {
		if (
			!input.fillQuantity.greaterThan(0) ||
			!input.remainingQuantityBeforeFill.greaterThan(0) ||
			input.fillQuantity.greaterThan(input.remainingQuantityBeforeFill)
		) {
			throw new TradingRepositoryDataError(
				'Filled quantity must be positive and cannot exceed the order remainder'
			);
		}
		await this.#assertOrder(input.orderId);
		if (input.fillQuantity.equals(input.remainingQuantityBeforeFill)) {
			await this.transactionClient
				.update(tradingReservations)
				.set({ status: 'consumed', releasedAt: input.consumedAt })
				.where(
					and(
						eq(tradingReservations.orderId, input.orderId),
						eq(tradingReservations.portfolioId, this.portfolioId),
						eq(tradingReservations.status, 'active')
					)
				);
			return;
		}
		const remainingFraction = decimalString(
			input.remainingQuantityBeforeFill
				.minus(input.fillQuantity)
				.div(input.remainingQuantityBeforeFill)
		);
		await this.transactionClient
			.update(tradingReservations)
			.set({ amount: sql`${tradingReservations.amount} * ${remainingFraction}` })
			.where(
				and(
					eq(tradingReservations.orderId, input.orderId),
					eq(tradingReservations.portfolioId, this.portfolioId),
					eq(tradingReservations.status, 'active')
				)
			);
	}

	async releaseOrderReservations(orderId: string, releasedAt = new Date()): Promise<void> {
		await this.#assertOrder(orderId);
		await this.transactionClient
			.update(tradingReservations)
			.set({ status: 'released', releasedAt })
			.where(
				and(
					eq(tradingReservations.orderId, orderId),
					eq(tradingReservations.portfolioId, this.portfolioId),
					eq(tradingReservations.status, 'active')
				)
			);
	}

	async appendOrderEvent(input: {
		orderId: string;
		fromStatus?: OrderStatus;
		toStatus: OrderStatus;
		at: Date;
		reason?: string;
	}): Promise<void> {
		await this.#assertOrder(input.orderId);
		await this.transactionClient.insert(tradingOrderEvents).values({
			orderId: input.orderId,
			fromStatus: input.fromStatus === undefined ? null : orderStatusSchema.parse(input.fromStatus),
			toStatus: orderStatusSchema.parse(input.toStatus),
			reason: input.reason ?? null,
			occurredAt: input.at
		});
	}

	async #findOrder(condition: ReturnType<typeof and>): Promise<AcceptedOrder | null> {
		const [order] = await this.transactionClient
			.select()
			.from(tradingOrders)
			.where(condition)
			.limit(1)
			.for('update');
		if (!order) return null;
		const legs = await this.transactionClient
			.select({ leg: tradingOrderLegs, instrument: tradingInstruments })
			.from(tradingOrderLegs)
			.innerJoin(tradingInstruments, eq(tradingOrderLegs.instrumentId, tradingInstruments.id))
			.where(eq(tradingOrderLegs.orderId, order.id))
			.orderBy(asc(tradingOrderLegs.legNumber));
		return mapAcceptedOrderRows(order, legs);
	}

	async #assertOrder(orderId: string): Promise<void> {
		const [order] = await this.transactionClient
			.select({ id: tradingOrders.id })
			.from(tradingOrders)
			.where(and(eq(tradingOrders.id, orderId), eq(tradingOrders.portfolioId, this.portfolioId)))
			.limit(1)
			.for('update');
		if (!order) throw new TradingRepositoryDataError('Order is outside the transaction portfolio');
	}

	async #upsertInstruments(instruments: readonly Instrument[]): Promise<Map<string, string>> {
		const ids = new Map<string, string>();
		for (const instrument of instruments) {
			const values = instrumentInsertValues(instrument);
			const [row] = await this.transactionClient
				.insert(tradingInstruments)
				.values(values)
				.onConflictDoUpdate({
					target: tradingInstruments.symbol,
					set: {
						assetClass: values.assetClass,
						name: values.name,
						currency: values.currency,
						active: values.active,
						primaryExchange: values.primaryExchange,
						tickerType: values.tickerType,
						roundLot: values.roundLot,
						underlyingSymbol: values.underlyingSymbol,
						optionType: values.optionType,
						exerciseStyle: values.exerciseStyle,
						expirationDate: values.expirationDate,
						strikePrice: values.strikePrice,
						contractMultiplier: values.contractMultiplier,
						additionalUnderlyings: values.additionalUnderlyings,
						updatedAt: values.updatedAt
					}
				})
				.returning({ id: tradingInstruments.id, symbol: tradingInstruments.symbol });
			if (!row) throw new TradingRepositoryDataError(`Could not persist ${instrument.symbol}`);
			ids.set(row.symbol, row.id);
		}
		return ids;
	}

	#instrumentId(ids: ReadonlyMap<string, string>, symbol: string): string {
		const id = ids.get(symbol);
		if (!id) throw new TradingRepositoryDataError(`No database instrument exists for ${symbol}`);
		return id;
	}

	#assertPortfolio(portfolioId: string): void {
		if (portfolioId !== this.portfolioId) {
			throw new TradingRepositoryDataError('Operation is outside the transaction portfolio');
		}
	}
}

export class DrizzleTradingRepository implements TradingRepository {
	constructor(private readonly database?: ApplicationDatabase) {}

	async transaction<T>(
		portfolioId: string,
		operation: (unitOfWork: TradingUnitOfWork) => Promise<T>
	): Promise<T> {
		const database = this.database ?? (await import('../db')).db;
		return database.transaction(
			async (transactionClient) => {
				await transactionClient
					.select({ id: tradingPortfolios.id })
					.from(tradingPortfolios)
					.where(eq(tradingPortfolios.id, portfolioId))
					.limit(1)
					.for('update');
				return operation(new DrizzleTradingUnitOfWork(transactionClient, portfolioId));
			},
			{ isolationLevel: 'serializable' }
		);
	}
}

export const drizzleTradingRepository = new DrizzleTradingRepository();
