import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { archiveOwnedPortfolio, listOwnedPortfolios } from '#lib/server/portfolios/repository.js';

const portfolioIdSchema = z.uuid();

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Authentication required.');
	locals.markSessionActive();

	return { portfolios: await listOwnedPortfolios(locals.user.id) };
};

export const actions: Actions = {
	archive: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { archiveError: 'Authentication required.' });
		locals.markSessionActive();

		const portfolioId = portfolioIdSchema.safeParse((await request.formData()).get('portfolioId'));
		if (!portfolioId.success) {
			return fail(400, { archiveError: 'The portfolio identifier is invalid.' });
		}

		const result = await archiveOwnedPortfolio(locals.user.id, portfolioId.data);
		switch (result.status) {
			case 'archived':
				return { archivedPortfolioId: result.portfolioId };
			case 'last_active':
				return fail(409, {
					archiveError: 'Create another portfolio before archiving your last active one.'
				});
			case 'open_orders':
				return fail(409, {
					archiveError: 'Cancel or complete this portfolio’s open orders before archiving it.'
				});
			case 'not_found':
				return fail(404, { archiveError: 'That active portfolio was not found.' });
		}
	}
};
