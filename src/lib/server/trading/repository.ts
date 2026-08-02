import Decimal from 'decimal.js';
import type { AcceptedOrder, OrderStatus, Position, StrategyFill } from './types';
import type { CashLedgerEntry } from './ledger';

export interface PersistedPortfolio {
	id: string;
	ownerUserId: string;
	name: string;
	baseCurrency: 'USD';
	startingCash: Decimal;
	cashBalance: Decimal;
	reservedCash: Decimal;
	dataMode: 'realtime' | 'delayed';
	status: 'active' | 'archived';
}

export interface PersistedFill {
	id: string;
	fill: StrategyFill;
}

export interface OrderReservationRequest {
	orderId: string;
	portfolioId: string;
	cashAmount: Decimal;
	shareQuantities: ReadonlyMap<string, Decimal>;
}

export interface OrderReservationConsumption {
	orderId: string;
	fillQuantity: Decimal;
	remainingQuantityBeforeFill: Decimal;
	consumedAt: Date;
}

export interface PersistedRiskState {
	openOrderCount: number;
	reservedPositionQuantities: Map<string, Decimal>;
}

/**
 * Implementations must keep order, fill, ledger, position, and reservation changes in one
 * SERIALIZABLE database transaction while locking the portfolio and affected order rows.
 */
export interface TradingUnitOfWork {
	getPortfolioForUpdate(
		portfolioId: string,
		ownerUserId: string
	): Promise<PersistedPortfolio | null>;
	getOrderForUpdate(orderId: string): Promise<AcceptedOrder | null>;
	findOrderByClientId(portfolioId: string, clientOrderId: string): Promise<AcceptedOrder | null>;
	getPositionsForUpdate(
		portfolioId: string,
		symbols: readonly string[]
	): Promise<Map<string, Position>>;
	getRiskStateForUpdate(
		portfolioId: string,
		ownerUserId: string,
		symbols: readonly string[]
	): Promise<PersistedRiskState | null>;
	getActiveOrderCashReservationForUpdate(orderId: string): Promise<Decimal>;
	insertOrder(order: AcceptedOrder): Promise<void>;
	insertOrderReservations(input: OrderReservationRequest): Promise<void>;
	updateOrder(order: AcceptedOrder, expectedRevision: number): Promise<boolean>;
	insertFill(fill: PersistedFill): Promise<void>;
	insertLedgerEntries(entries: readonly CashLedgerEntry[]): Promise<void>;
	upsertPositions(portfolioId: string, positions: ReadonlyMap<string, Position>): Promise<void>;
	consumeOrderReservations(input: OrderReservationConsumption): Promise<void>;
	releaseOrderReservations(orderId: string, releasedAt?: Date): Promise<void>;
	appendOrderEvent(input: {
		orderId: string;
		fromStatus?: OrderStatus;
		toStatus: OrderStatus;
		at: Date;
		reason?: string;
	}): Promise<void>;
}

export interface TradingRepository {
	transaction<T>(
		portfolioId: string,
		operation: (unitOfWork: TradingUnitOfWork) => Promise<T>
	): Promise<T>;
}
