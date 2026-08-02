import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { createPortfolioSchema } from '$lib/domain/forms';
import { getMarketEnvironment } from '$lib/server/market';
import {
	supportsOptionsExecution,
	supportsStockSimulation,
	type MarketDataMode
} from '$lib/server/market-data';
import { createOwnedPortfolio } from '$lib/server/portfolios/repository';

const createPortfolioAdapter = zod4(createPortfolioSchema);

interface PortfolioMarketConfiguration {
	supportedDataMode: MarketDataMode;
	optionsTradingEnabled: boolean;
}

function configuredPortfolioMarket(): PortfolioMarketConfiguration {
	const capabilities = getMarketEnvironment().capabilities;
	if (!supportsStockSimulation(capabilities.stocks)) {
		error(
			503,
			'Stock simulation requires a Massive Stocks Starter, Developer, or Advanced plan with snapshots, WebSockets, and aggregate bars.'
		);
	}
	return {
		supportedDataMode: capabilities.stocks.executionMode,
		optionsTradingEnabled: supportsOptionsExecution(capabilities)
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Authentication required.');
	locals.markSessionActive();

	const { supportedDataMode, optionsTradingEnabled } = configuredPortfolioMarket();
	const form = await superValidate(createPortfolioAdapter);
	form.data.dataMode = supportedDataMode;
	return { form, supportedDataMode, optionsTradingEnabled };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Authentication required.');
		locals.markSessionActive();

		const { supportedDataMode, optionsTradingEnabled } = configuredPortfolioMarket();
		const form = await superValidate(request, createPortfolioAdapter);
		if (!form.valid) {
			return fail(400, { form, supportedDataMode, optionsTradingEnabled });
		}
		if (form.data.dataMode !== supportedDataMode) {
			form.valid = false;
			form.data.dataMode = supportedDataMode;
			form.errors.dataMode = ['Market-data mode must match the configured Massive plans.'];
			return fail(400, { form, supportedDataMode, optionsTradingEnabled });
		}

		if (!optionsTradingEnabled) {
			const requestedLongOptions = form.data.allowLongOptions;
			const requestedCoveredOptions = form.data.allowCoveredOptions;
			const requestedDefinedRiskSpreads = form.data.allowDefinedRiskSpreads;
			const requestedMaxOptionPremium = form.data.maxOptionPremium !== undefined;
			form.data.allowLongOptions = false;
			form.data.allowCoveredOptions = false;
			form.data.allowDefinedRiskSpreads = false;
			form.data.maxOptionPremium = undefined;

			if (
				requestedLongOptions ||
				requestedCoveredOptions ||
				requestedDefinedRiskSpreads ||
				requestedMaxOptionPremium
			) {
				form.valid = false;
				const message =
					'Options permissions require a same-clock Massive options plan with snapshots, WebSockets, quotes, and trades.';
				if (requestedLongOptions) form.errors.allowLongOptions = [message];
				if (requestedCoveredOptions) form.errors.allowCoveredOptions = [message];
				if (requestedDefinedRiskSpreads) form.errors.allowDefinedRiskSpreads = [message];
				if (requestedMaxOptionPremium) form.errors.maxOptionPremium = [message];
				return fail(400, { form, supportedDataMode, optionsTradingEnabled });
			}
		}

		const portfolio = await createOwnedPortfolio(locals.user.id, form.data);
		redirect(303, `/p/${portfolio.id}/overview`);
	}
};
