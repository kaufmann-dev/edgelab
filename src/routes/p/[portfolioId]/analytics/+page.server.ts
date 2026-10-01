import { error } from '@sveltejs/kit';
import { calculatePerformanceMetrics } from '#lib/domain/analytics.js';
import {
	listPortfolioClosedTradeSamples,
	listPortfolioEquity,
	requirePortfolioReadAccess
} from '#lib/server/portfolio-read.js';
import { buildEquityCurve } from '#lib/server/portfolio-view.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');
	const portfolio = await requirePortfolioReadAccess(locals.user.id, params.portfolioId);
	if (!portfolio) error(404, 'Portfolio not found.');
	const [equity, closedTrades] = await Promise.all([
		listPortfolioEquity(portfolio.id),
		listPortfolioClosedTradeSamples(locals.user.id, portfolio.id)
	]);
	const curve = buildEquityCurve(equity, portfolio.startingCash);
	const metrics = calculatePerformanceMetrics(
		curve.map((point) => ({
			at: point.timestamp,
			netLiquidationValue: String(point.portfolioValue),
			benchmarkValue: point.benchmarkValue === undefined ? null : String(point.benchmarkValue)
		})),
		closedTrades
	);
	return { curve, metrics };
};
