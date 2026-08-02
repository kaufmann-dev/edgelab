import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { createPortfolioSchema } from '$lib/domain/forms';
import { getMarketEnvironment } from '$lib/server/market';
import { createOwnedPortfolio } from '$lib/server/portfolios/repository';

const createPortfolioAdapter = zod4(createPortfolioSchema);

function configuredPortfolioDataMode(): 'real_time' {
	const { stocks, options } = getMarketEnvironment().capabilities;
	if (
		[stocks, options].some(
			(capability) =>
				capability.mode !== 'realtime' ||
				!capability.snapshots ||
				!capability.websocket ||
				!capability.quotes ||
				!capability.trades
		)
	) {
		error(
			503,
			'Live simulation requires Massive stock and option plans with real-time snapshots, WebSockets, quotes, and trades. Configure both plan tiers as advanced.'
		);
	}
	return 'real_time';
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Authentication required.');
	locals.markSessionActive();

	const supportedDataMode = configuredPortfolioDataMode();
	const form = await superValidate(createPortfolioAdapter);
	form.data.dataMode = supportedDataMode;
	return { form, supportedDataMode };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Authentication required.');
		locals.markSessionActive();

		const form = await superValidate(request, createPortfolioAdapter);
		if (!form.valid) return fail(400, { form });
		const supportedDataMode = configuredPortfolioDataMode();
		if (form.data.dataMode !== supportedDataMode) {
			form.valid = false;
			form.data.dataMode = supportedDataMode;
			form.errors.dataMode = ['Market-data mode must match the configured Massive plans.'];
			return fail(400, { form, supportedDataMode });
		}

		const portfolio = await createOwnedPortfolio(locals.user.id, form.data);
		redirect(303, `/p/${portfolio.id}/overview`);
	}
};
