import Decimal from 'decimal.js';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ClosedTradeSample } from '#lib/domain/analytics.js';
import { db } from '#lib/server/db/index.js';
import {
	tradingCashLedger,
	tradingEquitySnapshots,
	tradingFillLegs,
	tradingFills,
	tradingInstruments,
	tradingJournalEntries,
	tradingOrderEvents,
	tradingOrderLegs,
	tradingOrders,
	tradingPortfolioPolicies,
	tradingPortfolios,
	tradingPositions,
	tradingReservations
} from '#lib/server/db/schema/trading.js';
import { getOwnedActivePortfolio } from '#lib/server/portfolios/repository.js';

export interface PositionRecord {
	id: string;
	instrumentId: string;
	symbol: string;
	name: string;
	assetClass: 'stocks' | 'options';
	underlyingSymbol: string | null;
	expirationDate: string | null;
	contractMultiplier: string | null;
	quantity: string;
	averageCost: string;
	realizedPnl: string;
	updatedAt: Date;
}

export interface OrderLegRecord {
	id: string;
	symbol: string;
	assetClass: 'stocks' | 'options';
	legNumber: number;
	side: 'buy' | 'sell';
	positionEffect: 'open' | 'close';
	ratioQuantity: string;
	filledQuantity: string;
}

export interface OrderRecord {
	id: string;
	clientOrderId: string;
	orderType: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
	timeInForce: 'day' | 'gtc' | 'ioc';
	status:
		'pending_new' | 'open' | 'partially_filled' | 'filled' | 'canceled' | 'expired' | 'rejected';
	quantity: string;
	filledQuantity: string;
	limitPrice: string | null;
	stopPrice: string | null;
	trailingPercent: string | null;
	extendedHours: boolean;
	acceptedAt: Date | null;
	terminalAt: Date | null;
	rejectionReason: string | null;
	averageFillPrice: string | null;
	createdAt: Date;
	legs: OrderLegRecord[];
}

export interface ActivityRecord {
	id: string;
	kind: 'order' | 'fill' | 'cash';
	at: Date;
	title: string;
	detail: string | null;
	amount: string | null;
}

export interface JournalRecord {
	id: string;
	symbol: string | null;
	phase: 'pre_trade' | 'post_trade' | 'general';
	thesis: string | null;
	invalidation: string | null;
	notes: string;
	tags: string[];
	confidence: number | null;
	followedPlan: boolean | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PortfolioValuation {
	cashBalance: Decimal;
	netMarketValue: Decimal;
	grossExposure: Decimal;
	equity: Decimal;
	realizedPnl: Decimal;
	unrealizedPnl: Decimal;
	asOf: Date;
}

export interface PersistedFillLegRecord {
	fillId: string;
	fillLegId: string;
	legNumber: number;
	instrumentId: string;
	symbol: string;
	receivedAt: Date;
	side: 'buy' | 'sell';
	positionEffect: 'open' | 'close';
	quantity: string;
	price: string;
	multiplier: string;
	fees: string;
	followedPlan: boolean | null;
}

interface FifoLot {
	fillLegId: string;
	remainingQuantity: Decimal;
	remainingFees: Decimal;
	price: Decimal;
	multiplier: Decimal;
	openedAt: Date;
	followedPlan: boolean | null;
}

type PositionDirection = 'long' | 'short';

function directionForOpeningSide(side: PersistedFillLegRecord['side']): PositionDirection {
	return side === 'buy' ? 'long' : 'short';
}

function directionClosedBySide(side: PersistedFillLegRecord['side']): PositionDirection {
	return side === 'sell' ? 'long' : 'short';
}

function fifoKey(instrumentId: string, direction: PositionDirection): string {
	return `${instrumentId}:${direction}`;
}

function proportionalFeeAllocation(total: Decimal, quantity: Decimal, remaining: Decimal): Decimal {
	return quantity.equals(remaining)
		? total
		: total.times(quantity).dividedBy(remaining).toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN);
}

function assertPositiveFillValue(value: Decimal, field: string, fillLegId: string): void {
	if (!value.greaterThan(0)) {
		throw new Error(`Persisted fill leg ${fillLegId} has a non-positive ${field}`);
	}
}

/**
 * Reconstructs realized outcomes from immutable fills instead of aggregate position cost basis.
 * Each sample represents one FIFO match between an opening lot and a closing fill.
 */
export function deriveFifoClosedTradeSamples(
	fillLegs: readonly PersistedFillLegRecord[]
): ClosedTradeSample[] {
	const orderedFillLegs = [...fillLegs].sort((left, right) => {
		const timeDifference = left.receivedAt.getTime() - right.receivedAt.getTime();
		if (timeDifference !== 0) return timeDifference;
		const fillDifference = left.fillId.localeCompare(right.fillId);
		if (fillDifference !== 0) return fillDifference;
		const legDifference = left.legNumber - right.legNumber;
		return legDifference === 0 ? left.fillLegId.localeCompare(right.fillLegId) : legDifference;
	});
	const lotsByInstrumentAndDirection = new Map<string, FifoLot[]>();
	const samples: ClosedTradeSample[] = [];

	for (const fillLeg of orderedFillLegs) {
		const quantity = new Decimal(fillLeg.quantity);
		const price = new Decimal(fillLeg.price);
		const multiplier = new Decimal(fillLeg.multiplier);
		const fees = new Decimal(fillLeg.fees);
		assertPositiveFillValue(quantity, 'quantity', fillLeg.fillLegId);
		assertPositiveFillValue(price, 'price', fillLeg.fillLegId);
		assertPositiveFillValue(multiplier, 'multiplier', fillLeg.fillLegId);
		if (fees.lessThan(0)) {
			throw new Error(`Persisted fill leg ${fillLeg.fillLegId} has negative fees`);
		}

		if (fillLeg.positionEffect === 'open') {
			const key = fifoKey(fillLeg.instrumentId, directionForOpeningSide(fillLeg.side));
			const lots = lotsByInstrumentAndDirection.get(key) ?? [];
			lots.push({
				fillLegId: fillLeg.fillLegId,
				remainingQuantity: quantity,
				remainingFees: fees,
				price,
				multiplier,
				openedAt: fillLeg.receivedAt,
				followedPlan: fillLeg.followedPlan
			});
			lotsByInstrumentAndDirection.set(key, lots);
			continue;
		}

		const direction = directionClosedBySide(fillLeg.side);
		const lots = lotsByInstrumentAndDirection.get(fifoKey(fillLeg.instrumentId, direction)) ?? [];
		let remainingCloseQuantity = quantity;
		let remainingCloseFees = fees;

		while (remainingCloseQuantity.greaterThan(0) && lots.length > 0) {
			const lot = lots[0];
			const matchedQuantity = Decimal.min(remainingCloseQuantity, lot.remainingQuantity);
			const openingFees = proportionalFeeAllocation(
				lot.remainingFees,
				matchedQuantity,
				lot.remainingQuantity
			);
			const closingFees = proportionalFeeAllocation(
				remainingCloseFees,
				matchedQuantity,
				remainingCloseQuantity
			);
			const openingValuePerUnit = lot.price.times(lot.multiplier);
			const closingValuePerUnit = price.times(multiplier);
			const grossRealized =
				direction === 'long'
					? closingValuePerUnit.minus(openingValuePerUnit).times(matchedQuantity)
					: openingValuePerUnit.minus(closingValuePerUnit).times(matchedQuantity);

			samples.push({
				id: `${lot.fillLegId}:${fillLeg.fillLegId}`,
				realizedPnl: grossRealized.minus(openingFees).minus(closingFees).toFixed(8),
				openedAt: lot.openedAt,
				closedAt: fillLeg.receivedAt,
				plannedRisk: null,
				slippage: null,
				followedPlan: lot.followedPlan
			});

			lot.remainingQuantity = lot.remainingQuantity.minus(matchedQuantity);
			lot.remainingFees = lot.remainingFees.minus(openingFees);
			remainingCloseQuantity = remainingCloseQuantity.minus(matchedQuantity);
			remainingCloseFees = remainingCloseFees.minus(closingFees);
			if (lot.remainingQuantity.isZero()) lots.shift();
		}
	}

	return samples;
}

export function bucketToUtcMinute(value: Date): Date {
	if (!Number.isFinite(value.getTime())) throw new Error('Valuation time is invalid');
	return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}

function storedMoney(value: Decimal): string {
	return value.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8);
}

export async function requirePortfolioReadAccess(ownerUserId: string, portfolioId: string) {
	return getOwnedActivePortfolio(ownerUserId, portfolioId);
}

export async function getPortfolioBalances(portfolioId: string) {
	const [[cash], [reserved], [realized]] = await Promise.all([
		db
			.select({
				balance: sql<string>`coalesce(sum(${tradingCashLedger.amount}), 0)`
			})
			.from(tradingCashLedger)
			.where(eq(tradingCashLedger.portfolioId, portfolioId)),
		db
			.select({
				balance: sql<string>`coalesce(sum(${tradingReservations.amount}), 0)`
			})
			.from(tradingReservations)
			.where(
				and(
					eq(tradingReservations.portfolioId, portfolioId),
					eq(tradingReservations.reservationType, 'cash'),
					eq(tradingReservations.status, 'active')
				)
			),
		db
			.select({
				balance: sql<string>`coalesce(sum(${tradingPositions.realizedPnl}), 0)`
			})
			.from(tradingPositions)
			.where(eq(tradingPositions.portfolioId, portfolioId))
	]);

	return {
		cashBalance: cash?.balance ?? '0',
		reservedCash: reserved?.balance ?? '0',
		realizedPnl: realized?.balance ?? '0'
	};
}

export async function listPortfolioPositions(portfolioId: string): Promise<PositionRecord[]> {
	const rows = await db
		.select({
			id: tradingPositions.id,
			instrumentId: tradingInstruments.id,
			symbol: tradingInstruments.symbol,
			name: tradingInstruments.name,
			assetClass: tradingInstruments.assetClass,
			underlyingSymbol: tradingInstruments.underlyingSymbol,
			expirationDate: tradingInstruments.expirationDate,
			contractMultiplier: tradingInstruments.contractMultiplier,
			quantity: tradingPositions.quantity,
			averageCost: tradingPositions.averageCost,
			realizedPnl: tradingPositions.realizedPnl,
			updatedAt: tradingPositions.updatedAt
		})
		.from(tradingPositions)
		.innerJoin(tradingInstruments, eq(tradingPositions.instrumentId, tradingInstruments.id))
		.where(
			and(eq(tradingPositions.portfolioId, portfolioId), sql`${tradingPositions.quantity} <> 0`)
		)
		.orderBy(asc(tradingInstruments.symbol));

	return rows.map((row) => ({
		...row,
		assetClass: row.assetClass as PositionRecord['assetClass']
	}));
}

export async function listPortfolioOrders(
	portfolioId: string,
	statuses?: OrderRecord['status'][]
): Promise<OrderRecord[]> {
	const predicate = statuses?.length
		? and(eq(tradingOrders.portfolioId, portfolioId), inArray(tradingOrders.status, statuses))
		: eq(tradingOrders.portfolioId, portfolioId);
	const [orders, legs, fillPrices] = await Promise.all([
		db
			.select()
			.from(tradingOrders)
			.where(predicate)
			.orderBy(desc(tradingOrders.createdAt))
			.limit(200),
		db
			.select({
				orderId: tradingOrderLegs.orderId,
				id: tradingOrderLegs.id,
				symbol: tradingInstruments.symbol,
				assetClass: tradingInstruments.assetClass,
				legNumber: tradingOrderLegs.legNumber,
				side: tradingOrderLegs.side,
				positionEffect: tradingOrderLegs.positionEffect,
				ratioQuantity: tradingOrderLegs.ratioQuantity,
				filledQuantity: tradingOrderLegs.filledQuantity
			})
			.from(tradingOrderLegs)
			.innerJoin(tradingOrders, eq(tradingOrderLegs.orderId, tradingOrders.id))
			.innerJoin(tradingInstruments, eq(tradingOrderLegs.instrumentId, tradingInstruments.id))
			.where(predicate)
			.orderBy(asc(tradingOrderLegs.legNumber)),
		db
			.select({
				orderId: tradingFills.orderId,
				averagePrice: sql<string>`sum(${tradingFillLegs.price} * ${tradingFillLegs.quantity}) / nullif(sum(${tradingFillLegs.quantity}), 0)`
			})
			.from(tradingFillLegs)
			.innerJoin(tradingFills, eq(tradingFillLegs.fillId, tradingFills.id))
			.innerJoin(tradingOrders, eq(tradingFills.orderId, tradingOrders.id))
			.where(predicate)
			.groupBy(tradingFills.orderId)
	]);

	const legsByOrder = new Map<string, OrderLegRecord[]>();
	for (const leg of legs) {
		const orderLegs = legsByOrder.get(leg.orderId) ?? [];
		orderLegs.push({
			...leg,
			assetClass: leg.assetClass as OrderLegRecord['assetClass'],
			side: leg.side as OrderLegRecord['side'],
			positionEffect: leg.positionEffect as OrderLegRecord['positionEffect']
		});
		legsByOrder.set(leg.orderId, orderLegs);
	}

	const fillPriceByOrder = new Map(fillPrices.map((fill) => [fill.orderId, fill.averagePrice]));
	return orders.map((order) => ({
		id: order.id,
		clientOrderId: order.clientOrderId,
		orderType: order.orderType as OrderRecord['orderType'],
		timeInForce: order.timeInForce as OrderRecord['timeInForce'],
		status: order.status as OrderRecord['status'],
		quantity: order.quantity,
		filledQuantity: order.filledQuantity,
		limitPrice: order.limitPrice,
		stopPrice: order.stopPrice,
		trailingPercent: order.trailingPercent,
		extendedHours: order.extendedHours,
		acceptedAt: order.acceptedAt,
		terminalAt: order.terminalAt,
		rejectionReason: order.rejectionReason,
		averageFillPrice: fillPriceByOrder.get(order.id) ?? null,
		createdAt: order.createdAt,
		legs: legsByOrder.get(order.id) ?? []
	}));
}

export async function listPortfolioEquity(portfolioId: string) {
	const rows = await db
		.select()
		.from(tradingEquitySnapshots)
		.where(eq(tradingEquitySnapshots.portfolioId, portfolioId))
		.orderBy(desc(tradingEquitySnapshots.asOf))
		.limit(366);
	return rows.reverse();
}

export async function listPortfolioClosedTradeSamples(
	ownerUserId: string,
	portfolioId: string
): Promise<ClosedTradeSample[]> {
	const rows = await db
		.select({
			fillId: tradingFills.id,
			fillLegId: tradingFillLegs.id,
			legNumber: tradingOrderLegs.legNumber,
			instrumentId: tradingInstruments.id,
			symbol: tradingInstruments.symbol,
			receivedAt: tradingFills.receivedAt,
			side: tradingOrderLegs.side,
			positionEffect: tradingOrderLegs.positionEffect,
			quantity: tradingFillLegs.quantity,
			price: tradingFillLegs.price,
			multiplier: tradingFillLegs.multiplier,
			fees: tradingFillLegs.fees,
			followedPlan: tradingJournalEntries.followedPlan
		})
		.from(tradingFillLegs)
		.innerJoin(tradingFills, eq(tradingFillLegs.fillId, tradingFills.id))
		.innerJoin(tradingOrders, eq(tradingFills.orderId, tradingOrders.id))
		.innerJoin(
			tradingOrderLegs,
			and(
				eq(tradingFillLegs.orderLegId, tradingOrderLegs.id),
				eq(tradingOrderLegs.orderId, tradingOrders.id)
			)
		)
		.innerJoin(tradingInstruments, eq(tradingFillLegs.instrumentId, tradingInstruments.id))
		.innerJoin(
			tradingPortfolios,
			and(
				eq(tradingFills.portfolioId, tradingPortfolios.id),
				eq(tradingOrders.portfolioId, tradingPortfolios.id)
			)
		)
		.leftJoin(
			tradingJournalEntries,
			and(
				eq(tradingOrders.tradePlanId, tradingJournalEntries.id),
				eq(tradingJournalEntries.portfolioId, tradingPortfolios.id)
			)
		)
		.where(
			and(
				eq(tradingPortfolios.id, portfolioId),
				eq(tradingPortfolios.ownerUserId, ownerUserId),
				eq(tradingPortfolios.status, 'active')
			)
		)
		.orderBy(
			asc(tradingFills.receivedAt),
			asc(tradingFills.id),
			asc(tradingOrderLegs.legNumber),
			asc(tradingFillLegs.id)
		);

	return deriveFifoClosedTradeSamples(
		rows.map((row) => ({
			...row,
			side: row.side as PersistedFillLegRecord['side'],
			positionEffect: row.positionEffect as PersistedFillLegRecord['positionEffect']
		}))
	);
}

export async function recordPortfolioEquitySnapshot(input: {
	ownerUserId: string;
	portfolioId: string;
	valuation: PortfolioValuation;
	benchmarkPrice?: Decimal | null;
}) {
	const [ownedPortfolio] = await db
		.select({ id: tradingPortfolios.id })
		.from(tradingPortfolios)
		.where(
			and(
				eq(tradingPortfolios.id, input.portfolioId),
				eq(tradingPortfolios.ownerUserId, input.ownerUserId),
				eq(tradingPortfolios.status, 'active')
			)
		)
		.limit(1);
	if (!ownedPortfolio) return null;

	const cashBalance = new Decimal(storedMoney(input.valuation.cashBalance));
	const netMarketValue = new Decimal(storedMoney(input.valuation.netMarketValue));
	const values = {
		portfolioId: ownedPortfolio.id,
		asOf: bucketToUtcMinute(input.valuation.asOf),
		cashBalance: cashBalance.toFixed(8),
		netMarketValue: netMarketValue.toFixed(8),
		grossExposure: storedMoney(input.valuation.grossExposure),
		equity: cashBalance.plus(netMarketValue).toFixed(8),
		realizedPnl: storedMoney(input.valuation.realizedPnl),
		unrealizedPnl: storedMoney(input.valuation.unrealizedPnl),
		benchmarkPrice:
			input.benchmarkPrice === undefined || input.benchmarkPrice === null
				? null
				: storedMoney(input.benchmarkPrice)
	};
	const updateValues = {
		cashBalance: values.cashBalance,
		netMarketValue: values.netMarketValue,
		grossExposure: values.grossExposure,
		equity: values.equity,
		realizedPnl: values.realizedPnl,
		unrealizedPnl: values.unrealizedPnl,
		...(input.benchmarkPrice === undefined ? {} : { benchmarkPrice: values.benchmarkPrice })
	};

	const [snapshot] = await db
		.insert(tradingEquitySnapshots)
		.values(values)
		.onConflictDoUpdate({
			target: [tradingEquitySnapshots.portfolioId, tradingEquitySnapshots.asOf],
			set: updateValues
		})
		.returning({ id: tradingEquitySnapshots.id, asOf: tradingEquitySnapshots.asOf });
	return snapshot ?? null;
}

export async function getPortfolioPolicy(portfolioId: string) {
	const [policy] = await db
		.select()
		.from(tradingPortfolioPolicies)
		.where(eq(tradingPortfolioPolicies.portfolioId, portfolioId))
		.limit(1);
	return policy ?? null;
}

export async function listPortfolioActivity(portfolioId: string): Promise<ActivityRecord[]> {
	const [events, fills, cash] = await Promise.all([
		db
			.select({
				id: tradingOrderEvents.id,
				at: tradingOrderEvents.occurredAt,
				status: tradingOrderEvents.toStatus,
				reason: tradingOrderEvents.reason,
				clientOrderId: tradingOrders.clientOrderId
			})
			.from(tradingOrderEvents)
			.innerJoin(tradingOrders, eq(tradingOrderEvents.orderId, tradingOrders.id))
			.where(eq(tradingOrders.portfolioId, portfolioId))
			.orderBy(desc(tradingOrderEvents.occurredAt))
			.limit(100),
		db
			.select({
				id: tradingFillLegs.id,
				at: tradingFills.receivedAt,
				symbol: tradingInstruments.symbol,
				quantity: tradingFillLegs.quantity,
				price: tradingFillLegs.price,
				fees: tradingFillLegs.fees
			})
			.from(tradingFillLegs)
			.innerJoin(tradingFills, eq(tradingFillLegs.fillId, tradingFills.id))
			.innerJoin(tradingInstruments, eq(tradingFillLegs.instrumentId, tradingInstruments.id))
			.where(eq(tradingFills.portfolioId, portfolioId))
			.orderBy(desc(tradingFills.receivedAt))
			.limit(100),
		db
			.select()
			.from(tradingCashLedger)
			.where(eq(tradingCashLedger.portfolioId, portfolioId))
			.orderBy(desc(tradingCashLedger.occurredAt))
			.limit(100)
	]);

	return [
		...events.map((event): ActivityRecord => ({
			id: event.id,
			kind: 'order',
			at: event.at,
			title: `Order ${event.status.replaceAll('_', ' ')}`,
			detail: event.reason ?? `Receipt ${event.clientOrderId}`,
			amount: null
		})),
		...fills.map((fill): ActivityRecord => ({
			id: fill.id,
			kind: 'fill',
			at: fill.at,
			title: `${fill.symbol} fill`,
			detail: `${fill.quantity} @ ${fill.price}; fees ${fill.fees}`,
			amount: null
		})),
		...cash.map((entry): ActivityRecord => ({
			id: entry.id,
			kind: 'cash',
			at: entry.occurredAt,
			title: entry.description,
			detail: entry.entryType.replaceAll('_', ' '),
			amount: entry.amount
		}))
	]
		.sort((left, right) => right.at.getTime() - left.at.getTime())
		.slice(0, 200);
}

export async function listPortfolioJournal(portfolioId: string): Promise<JournalRecord[]> {
	const entries = await db
		.select()
		.from(tradingJournalEntries)
		.where(eq(tradingJournalEntries.portfolioId, portfolioId))
		.orderBy(desc(tradingJournalEntries.createdAt))
		.limit(200);
	return entries.map((entry) => ({
		id: entry.id,
		symbol: entry.symbol,
		phase: entry.phase as JournalRecord['phase'],
		thesis: entry.thesis,
		invalidation: entry.invalidation,
		notes: entry.notes,
		tags: entry.tags,
		confidence: entry.confidence,
		followedPlan: entry.followedPlan,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt
	}));
}

export async function portfolioExistsForOwner(ownerUserId: string, portfolioId: string) {
	const [portfolio] = await db
		.select({ id: tradingPortfolios.id })
		.from(tradingPortfolios)
		.where(
			and(
				eq(tradingPortfolios.id, portfolioId),
				eq(tradingPortfolios.ownerUserId, ownerUserId),
				eq(tradingPortfolios.status, 'active')
			)
		)
		.limit(1);
	return Boolean(portfolio);
}
