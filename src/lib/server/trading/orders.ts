import Decimal from 'decimal.js';
import {
	DEFAULT_EXECUTION_MODEL_VERSION,
	orderDraftSchema,
	type AcceptedOrder,
	type OrderDraft,
	type OrderStatus
} from './types';
import type { Instrument } from '../market-data/types';

const terminalStatuses = new Set<OrderStatus>(['filled', 'canceled', 'expired', 'rejected']);

const allowedTransitions: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
	pending_new: new Set(['open', 'rejected']),
	open: new Set(['partially_filled', 'filled', 'canceled', 'expired']),
	partially_filled: new Set(['partially_filled', 'filled', 'canceled', 'expired']),
	filled: new Set(),
	canceled: new Set(),
	expired: new Set(),
	rejected: new Set()
};

export class OrderTransitionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OrderTransitionError';
	}
}

function optionalDecimalEquals(left: Decimal | undefined, right: Decimal | undefined): boolean {
	if (left === undefined || right === undefined) return left === right;
	return left.equals(right);
}

/**
 * A client order identifier is idempotent only for the exact canonical request that first used it.
 * Execution state and resolved instrument metadata are intentionally excluded from the comparison.
 */
export function acceptedOrderMatchesDraft(order: AcceptedOrder, draftInput: OrderDraft): boolean {
	const draft = orderDraftSchema.parse(draftInput);
	return (
		order.portfolioId === draft.portfolioId &&
		order.tradePlanId === draft.tradePlanId &&
		order.clientOrderId === draft.clientOrderId &&
		order.type === draft.type &&
		order.timeInForce === draft.timeInForce &&
		order.quantity.equals(draft.quantity) &&
		optionalDecimalEquals(order.limitPrice, draft.limitPrice) &&
		optionalDecimalEquals(order.stopPrice, draft.stopPrice) &&
		optionalDecimalEquals(order.trailingPercent, draft.trailingPercent) &&
		order.netPriceEffect === draft.netPriceEffect &&
		order.extendedHours === draft.extendedHours &&
		order.legs.length === draft.legs.length &&
		order.legs.every((leg, index) => {
			const draftLeg = draft.legs[index];
			return (
				draftLeg !== undefined &&
				leg.symbol === draftLeg.symbol &&
				leg.side === draftLeg.side &&
				leg.positionEffect === draftLeg.positionEffect &&
				leg.ratioQuantity.equals(draftLeg.ratioQuantity)
			);
		})
	);
}

export function createAcceptedOrder(input: {
	id: string;
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	acceptedAt: Date;
	latencyMilliseconds?: number;
	executionModelVersion?: string;
}): AcceptedOrder {
	const draft = orderDraftSchema.parse(input.draft);
	const legs = draft.legs.map((leg) => {
		const instrument = input.instruments.get(leg.symbol);
		if (!instrument) throw new Error(`Instrument ${leg.symbol} was not resolved`);
		return { ...leg, instrument };
	});
	return {
		...draft,
		id: input.id,
		legs,
		status: 'open',
		executionModelVersion: input.executionModelVersion ?? DEFAULT_EXECUTION_MODEL_VERSION,
		filledQuantity: new Decimal(0),
		acceptedAt: input.acceptedAt,
		eligibleAt: new Date(input.acceptedAt.getTime() + (input.latencyMilliseconds ?? 0)),
		revision: 1
	};
}

export function transitionOrder(
	order: AcceptedOrder,
	nextStatus: OrderStatus,
	input: { at: Date; reason?: string }
): AcceptedOrder {
	if (!allowedTransitions[order.status].has(nextStatus)) {
		throw new OrderTransitionError(`Cannot transition order from ${order.status} to ${nextStatus}`);
	}
	return {
		...order,
		status: nextStatus,
		terminalAt: terminalStatuses.has(nextStatus) ? input.at : order.terminalAt,
		rejectionReason: nextStatus === 'rejected' ? input.reason : order.rejectionReason,
		revision: order.revision + 1
	};
}

export function markOrderTriggered(order: AcceptedOrder, at: Date): AcceptedOrder {
	if (!['open', 'partially_filled'].includes(order.status)) {
		throw new OrderTransitionError(`Cannot trigger order in ${order.status} status`);
	}
	if (order.triggeredAt) return order;
	return { ...order, triggeredAt: at, revision: order.revision + 1 };
}

export function applyStrategyFill(
	order: AcceptedOrder,
	strategyQuantity: Decimal,
	at: Date
): AcceptedOrder {
	if (!['open', 'partially_filled'].includes(order.status)) {
		throw new OrderTransitionError(`Cannot fill order in ${order.status} status`);
	}
	if (!strategyQuantity.greaterThan(0))
		throw new OrderTransitionError('Fill quantity must be positive');
	const remaining = order.quantity.minus(order.filledQuantity);
	if (strategyQuantity.greaterThan(remaining)) {
		throw new OrderTransitionError('Fill quantity exceeds order remainder');
	}
	const filledQuantity = order.filledQuantity.plus(strategyQuantity);
	const status: OrderStatus = filledQuantity.equals(order.quantity) ? 'filled' : 'partially_filled';
	return {
		...order,
		filledQuantity,
		status,
		terminalAt: status === 'filled' ? at : order.terminalAt,
		revision: order.revision + 1
	};
}

export function isTerminalOrder(order: AcceptedOrder): boolean {
	return terminalStatuses.has(order.status);
}
