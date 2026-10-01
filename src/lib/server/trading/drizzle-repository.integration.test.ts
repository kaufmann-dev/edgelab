import Decimal from 'decimal.js';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { users } from '#lib/server/db/schema/auth.js';
import {
	tradingCashLedger,
	tradingPortfolioPolicies,
	tradingPortfolios,
	tradingReservations
} from '#lib/server/db/schema/trading.js';
import { createAcceptedOrder } from './orders';
import { drizzleTradingRepository } from './drizzle-repository';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('DrizzleTradingRepository integration', () => {
	it('locks an owned portfolio and atomically persists an idempotent reserved order', async () => {
		const { db } = await import('#lib/server/db/index.js');
		const now = new Date();
		const [user] = await db
			.insert(users)
			.values({
				issuer: `https://issuer.example/${crypto.randomUUID()}`,
				subject: crypto.randomUUID(),
				createdAt: now,
				updatedAt: now,
				lastLoginAt: now
			})
			.returning();
		const [portfolio] = await db
			.insert(tradingPortfolios)
			.values({
				ownerUserId: user.id,
				name: 'Repository integration',
				startingCash: '100000',
				dataMode: 'realtime',
				executionModelVersion: 'sim-execution-v2',
				riskModelVersion: 'risk-policy-v1',
				createdAt: now
			})
			.returning();
		await Promise.all([
			db.insert(tradingPortfolioPolicies).values({ portfolioId: portfolio.id }),
			db.insert(tradingCashLedger).values({
				portfolioId: portfolio.id,
				entryType: 'initial_capital',
				amount: '100000',
				description: 'Portfolio starting capital',
				occurredAt: now
			})
		]);

		const result = await drizzleTradingRepository.transaction(portfolio.id, async (unitOfWork) => {
			const account = await unitOfWork.getPortfolioForUpdate(portfolio.id, user.id);
			expect(account?.cashBalance.toString()).toBe('100000');

			const order = createAcceptedOrder({
				id: crypto.randomUUID(),
				acceptedAt: now,
				draft: {
					portfolioId: portfolio.id,
					clientOrderId: crypto.randomUUID(),
					type: 'limit',
					timeInForce: 'day',
					quantity: new Decimal(10),
					limitPrice: new Decimal(100),
					netPriceEffect: 'debit',
					extendedHours: false,
					legs: [
						{
							symbol: 'TEST',
							side: 'buy',
							positionEffect: 'open',
							ratioQuantity: new Decimal(1)
						}
					]
				},
				instruments: new Map([
					[
						'TEST',
						{
							assetClass: 'stocks' as const,
							symbol: 'TEST',
							name: 'Test Instrument',
							currency: 'USD',
							active: true,
							roundLot: new Decimal(100)
						}
					]
				])
			});

			await unitOfWork.insertOrder(order);
			await unitOfWork.appendOrderEvent({ orderId: order.id, toStatus: 'open', at: now });
			await unitOfWork.insertOrderReservations({
				orderId: order.id,
				portfolioId: portfolio.id,
				cashAmount: new Decimal(1000),
				shareQuantities: new Map()
			});

			const persisted = await unitOfWork.findOrderByClientId(portfolio.id, order.clientOrderId);
			const risk = await unitOfWork.getRiskStateForUpdate(portfolio.id, user.id, ['TEST']);
			const cashReservation = await unitOfWork.getActiveOrderCashReservationForUpdate(order.id);
			return {
				orderId: persisted?.id,
				openOrderCount: risk?.openOrderCount,
				cashReservation: cashReservation.toString()
			};
		});

		expect(result).toEqual({
			orderId: expect.any(String),
			openOrderCount: 1,
			cashReservation: '1000'
		});
		if (!result.orderId) throw new Error('Expected a persisted order');

		await drizzleTradingRepository.transaction(portfolio.id, (unitOfWork) =>
			unitOfWork.consumeOrderReservations({
				orderId: result.orderId as string,
				fillQuantity: new Decimal(2),
				remainingQuantityBeforeFill: new Decimal(10),
				consumedAt: new Date(now.getTime() + 1_000)
			})
		);
		let [reservation] = await db
			.select()
			.from(tradingReservations)
			.where(eq(tradingReservations.orderId, result.orderId));
		expect(reservation).toMatchObject({ amount: '800.00000000', status: 'active' });

		await drizzleTradingRepository.transaction(portfolio.id, (unitOfWork) =>
			unitOfWork.consumeOrderReservations({
				orderId: result.orderId as string,
				fillQuantity: new Decimal(2),
				remainingQuantityBeforeFill: new Decimal(8),
				consumedAt: new Date(now.getTime() + 2_000)
			})
		);
		[reservation] = await db
			.select()
			.from(tradingReservations)
			.where(eq(tradingReservations.orderId, result.orderId));
		expect(reservation).toMatchObject({ amount: '600.00000000', status: 'active' });

		const consumedAt = new Date(now.getTime() + 3_000);
		await drizzleTradingRepository.transaction(portfolio.id, (unitOfWork) =>
			unitOfWork.consumeOrderReservations({
				orderId: result.orderId as string,
				fillQuantity: new Decimal(6),
				remainingQuantityBeforeFill: new Decimal(6),
				consumedAt
			})
		);
		[reservation] = await db
			.select()
			.from(tradingReservations)
			.where(eq(tradingReservations.orderId, result.orderId));
		expect(reservation).toMatchObject({ amount: '600.00000000', status: 'consumed' });
		expect(reservation?.releasedAt).toEqual(consumedAt);
	});
});
