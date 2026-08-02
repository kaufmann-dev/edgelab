import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { LayoutServerLoad } from './$types';
import { getOwnedActivePortfolio } from '$lib/server/portfolios/repository';

const portfolioIdSchema = z.uuid();

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');

	const portfolioId = portfolioIdSchema.safeParse(params.portfolioId);
	if (!portfolioId.success) error(404, 'Portfolio not found.');

	const portfolio = await getOwnedActivePortfolio(locals.user.id, portfolioId.data);
	if (!portfolio) error(404, 'Portfolio not found.');

	locals.markSessionActive();
	return { portfolio };
};
