import { error } from '@sveltejs/kit';
import {
	getPortfolioBalances,
	getPortfolioPolicy,
	listPortfolioEquity,
	listPortfolioOrders,
	listPortfolioPositions,
	recordPortfolioEquitySnapshot,
	requirePortfolioReadAccess
} from '#lib/server/portfolio-read.js';
import { buildEquityCurve, buildOrderRows, buildPositionView } from '#lib/server/portfolio-view.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');
	const portfolio = await requirePortfolioReadAccess(locals.user.id, params.portfolioId);
	if (!portfolio) error(404, 'Portfolio not found.');

	const [balances, positions, orders, policy] = await Promise.all([
		getPortfolioBalances(portfolio.id),
		listPortfolioPositions(portfolio.id),
		listPortfolioOrders(portfolio.id),
		getPortfolioPolicy(portfolio.id)
	]);
	const positionView = await buildPositionView({
		...balances,
		positions,
		benchmarkSymbol: policy?.benchmarkSymbol
	});
	if (positionView.valuation) {
		await recordPortfolioEquitySnapshot({
			ownerUserId: locals.user.id,
			portfolioId: portfolio.id,
			valuation: positionView.valuation,
			benchmarkPrice: positionView.benchmarkPrice ?? undefined
		});
	}
	const equity = await listPortfolioEquity(portfolio.id);

	return {
		metrics: positionView.metrics,
		positions: positionView.positions.slice(0, 8),
		orders: buildOrderRows(orders).slice(0, 8),
		equityCurve: buildEquityCurve(equity, portfolio.startingCash),
		marketFeed: positionView.marketFeed,
		marketError: positionView.marketError
	};
};
