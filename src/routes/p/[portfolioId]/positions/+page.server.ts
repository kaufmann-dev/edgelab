import { error } from '@sveltejs/kit';
import {
	getPortfolioBalances,
	getPortfolioPolicy,
	listPortfolioPositions,
	recordPortfolioEquitySnapshot,
	requirePortfolioReadAccess
} from '#lib/server/portfolio-read.js';
import { buildPositionView } from '#lib/server/portfolio-view.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');
	const portfolio = await requirePortfolioReadAccess(locals.user.id, params.portfolioId);
	if (!portfolio) error(404, 'Portfolio not found.');
	const [balances, positions, policy] = await Promise.all([
		getPortfolioBalances(portfolio.id),
		listPortfolioPositions(portfolio.id),
		getPortfolioPolicy(portfolio.id)
	]);
	const view = await buildPositionView({
		...balances,
		positions,
		benchmarkSymbol: policy?.benchmarkSymbol
	});
	if (view.valuation) {
		await recordPortfolioEquitySnapshot({
			ownerUserId: locals.user.id,
			portfolioId: portfolio.id,
			valuation: view.valuation,
			benchmarkPrice: view.benchmarkPrice ?? undefined
		});
	}
	return {
		positions: view.positions,
		metrics: view.metrics,
		marketFeed: view.marketFeed,
		marketError: view.marketError
	};
};
