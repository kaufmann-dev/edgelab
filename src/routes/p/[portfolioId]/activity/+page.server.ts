import { error } from '@sveltejs/kit';
import { listPortfolioActivity, requirePortfolioReadAccess } from '#lib/server/portfolio-read.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');
	const portfolio = await requirePortfolioReadAccess(locals.user.id, params.portfolioId);
	if (!portfolio) error(404, 'Portfolio not found.');
	return { activity: await listPortfolioActivity(portfolio.id) };
};
