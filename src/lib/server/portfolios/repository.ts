import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CreatePortfolioInput } from '$lib/domain/forms';
import { db } from '$lib/server/db';
import {
	tradingCashLedger,
	tradingEquitySnapshots,
	tradingOrders,
	tradingPortfolioPolicies,
	tradingPortfolios
} from '$lib/server/db/schema/trading';
import {
	DEFAULT_EXECUTION_MODEL_VERSION,
	DEFAULT_RISK_MODEL_VERSION
} from '$lib/server/trading/types';
import type { ArchivePortfolioResult, OwnedPortfolio, PortfolioSummary } from './types';

const openOrderStatuses = ['pending_new', 'open', 'partially_filled'] as const;

function optionalNumeric(value: number | undefined): string | null {
	return value === undefined ? null : String(value);
}

function toPortfolioSummary(portfolio: typeof tradingPortfolios.$inferSelect): PortfolioSummary {
	return {
		id: portfolio.id,
		name: portfolio.name,
		baseCurrency: portfolio.baseCurrency as 'USD',
		startingCash: portfolio.startingCash,
		dataMode: portfolio.dataMode as PortfolioSummary['dataMode'],
		status: portfolio.status as PortfolioSummary['status'],
		createdAt: portfolio.createdAt,
		archivedAt: portfolio.archivedAt
	};
}

export async function listOwnedPortfolios(ownerUserId: string): Promise<PortfolioSummary[]> {
	const portfolios = await db
		.select()
		.from(tradingPortfolios)
		.where(eq(tradingPortfolios.ownerUserId, ownerUserId))
		.orderBy(desc(tradingPortfolios.createdAt));

	return portfolios.map(toPortfolioSummary);
}

export async function getOwnedActivePortfolio(
	ownerUserId: string,
	portfolioId: string
): Promise<OwnedPortfolio | null> {
	const [portfolio] = await db
		.select()
		.from(tradingPortfolios)
		.where(
			and(
				eq(tradingPortfolios.id, portfolioId),
				eq(tradingPortfolios.ownerUserId, ownerUserId),
				eq(tradingPortfolios.status, 'active')
			)
		)
		.limit(1);

	if (!portfolio) return null;
	return {
		...toPortfolioSummary(portfolio),
		ownerUserId: portfolio.ownerUserId,
		executionModelVersion: portfolio.executionModelVersion,
		riskModelVersion: portfolio.riskModelVersion
	};
}

export async function createOwnedPortfolio(
	ownerUserId: string,
	input: CreatePortfolioInput,
	now = new Date()
): Promise<OwnedPortfolio> {
	return db.transaction(async (transaction) => {
		const [portfolio] = await transaction
			.insert(tradingPortfolios)
			.values({
				ownerUserId,
				name: input.name,
				baseCurrency: 'USD',
				startingCash: String(input.startingCapital),
				dataMode: input.dataMode,
				executionModelVersion: DEFAULT_EXECUTION_MODEL_VERSION,
				riskModelVersion: DEFAULT_RISK_MODEL_VERSION,
				status: 'active',
				createdAt: now
			})
			.returning();

		if (!portfolio) throw new Error('Portfolio insert did not return a row');

		await transaction.insert(tradingPortfolioPolicies).values({
			portfolioId: portfolio.id,
			benchmarkSymbol: input.benchmarkSymbol,
			accountType: input.accountType,
			allowShortEquity: input.allowShortEquity,
			allowLongOptions: input.allowLongOptions,
			allowCoveredOptions: input.allowCoveredOptions,
			allowDefinedRiskSpreads: input.allowDefinedRiskSpreads,
			allowExtendedHours: input.allowExtendedHours,
			requireTradePlan: input.requireTradePlan,
			maxOrderNotional: optionalNumeric(input.maxOrderNotional),
			maxPositionPercent: optionalNumeric(input.maxPositionPercent),
			maxGrossExposurePercent: optionalNumeric(input.maxGrossExposurePercent),
			maxDailyLoss: optionalNumeric(input.maxDailyLoss),
			maxDrawdownPercent: optionalNumeric(input.maxDrawdownPercent),
			maxOptionPremium: optionalNumeric(input.maxOptionPremium),
			riskBehavior: input.riskBehavior,
			createdAt: now,
			updatedAt: now
		});

		await transaction.insert(tradingCashLedger).values({
			portfolioId: portfolio.id,
			entryType: 'initial_capital',
			amount: String(input.startingCapital),
			currency: 'USD',
			description: 'Portfolio starting capital',
			occurredAt: now,
			createdAt: now
		});

		await transaction.insert(tradingEquitySnapshots).values({
			portfolioId: portfolio.id,
			asOf: now,
			cashBalance: String(input.startingCapital),
			netMarketValue: '0',
			grossExposure: '0',
			equity: String(input.startingCapital),
			realizedPnl: '0',
			unrealizedPnl: '0',
			benchmarkPrice: null,
			createdAt: now
		});

		return {
			...toPortfolioSummary(portfolio),
			ownerUserId: portfolio.ownerUserId,
			executionModelVersion: portfolio.executionModelVersion,
			riskModelVersion: portfolio.riskModelVersion
		};
	});
}

export async function archiveOwnedPortfolio(
	ownerUserId: string,
	portfolioId: string,
	now = new Date()
): Promise<ArchivePortfolioResult> {
	return db.transaction(
		async (transaction) => {
			const activePortfolios = await transaction
				.select({ id: tradingPortfolios.id })
				.from(tradingPortfolios)
				.where(
					and(
						eq(tradingPortfolios.ownerUserId, ownerUserId),
						eq(tradingPortfolios.status, 'active')
					)
				)
				.for('update');

			if (!activePortfolios.some((portfolio) => portfolio.id === portfolioId)) {
				return { status: 'not_found' };
			}
			if (activePortfolios.length === 1) return { status: 'last_active' };

			const [blockingOrder] = await transaction
				.select({ id: tradingOrders.id })
				.from(tradingOrders)
				.where(
					and(
						eq(tradingOrders.portfolioId, portfolioId),
						inArray(tradingOrders.status, openOrderStatuses)
					)
				)
				.limit(1)
				.for('update');
			if (blockingOrder) return { status: 'open_orders' };

			const [archived] = await transaction
				.update(tradingPortfolios)
				.set({ status: 'archived', archivedAt: now })
				.where(
					and(
						eq(tradingPortfolios.id, portfolioId),
						eq(tradingPortfolios.ownerUserId, ownerUserId),
						eq(tradingPortfolios.status, 'active')
					)
				)
				.returning({ id: tradingPortfolios.id });

			return archived ? { status: 'archived', portfolioId: archived.id } : { status: 'not_found' };
		},
		{ isolationLevel: 'serializable' }
	);
}
