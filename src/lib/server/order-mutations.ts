import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	tradingOrderEvents,
	tradingOrders,
	tradingPortfolios,
	tradingReservations
} from '#lib/server/db/schema/trading.js';
import { notifyOrdersChanged } from '#lib/server/live-order-execution.js';

export type CancelOrderResult = 'canceled' | 'not_found' | 'already_terminal';

const cancellableStatuses = ['pending_new', 'open', 'partially_filled'] as const;

export async function cancelOwnedOrder(input: {
	ownerUserId: string;
	portfolioId: string;
	orderId: string;
	now?: Date;
}): Promise<CancelOrderResult> {
	const now = input.now ?? new Date();
	const result = await db.transaction(
		async (transaction) => {
			const [row] = await transaction
				.select({ id: tradingOrders.id, status: tradingOrders.status })
				.from(tradingOrders)
				.innerJoin(tradingPortfolios, eq(tradingOrders.portfolioId, tradingPortfolios.id))
				.where(
					and(
						eq(tradingOrders.id, input.orderId),
						eq(tradingOrders.portfolioId, input.portfolioId),
						eq(tradingPortfolios.ownerUserId, input.ownerUserId),
						eq(tradingPortfolios.status, 'active')
					)
				)
				.limit(1)
				.for('update');

			if (!row) return 'not_found';
			if (!cancellableStatuses.includes(row.status as (typeof cancellableStatuses)[number])) {
				return 'already_terminal';
			}

			const [updated] = await transaction
				.update(tradingOrders)
				.set({
					status: 'canceled',
					terminalAt: now,
					updatedAt: now,
					revision: sql`${tradingOrders.revision} + 1`
				})
				.where(
					and(
						eq(tradingOrders.id, input.orderId),
						inArray(tradingOrders.status, cancellableStatuses)
					)
				)
				.returning({ id: tradingOrders.id });
			if (!updated) return 'already_terminal';

			await Promise.all([
				transaction.insert(tradingOrderEvents).values({
					orderId: input.orderId,
					fromStatus: row.status,
					toStatus: 'canceled',
					reason: 'Canceled by portfolio owner',
					occurredAt: now
				}),
				transaction
					.update(tradingReservations)
					.set({ status: 'released', releasedAt: now })
					.where(
						and(
							eq(tradingReservations.orderId, input.orderId),
							eq(tradingReservations.status, 'active')
						)
					)
			]);

			return 'canceled';
		},
		{ isolationLevel: 'serializable' }
	);
	if (result === 'canceled') notifyOrdersChanged();
	return result;
}
