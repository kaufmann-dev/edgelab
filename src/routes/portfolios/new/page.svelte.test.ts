import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { defaults } from 'sveltekit-superforms';
import { zod4Client } from 'sveltekit-superforms/adapters';
import { createPortfolioSchema } from '$lib/domain/forms';
import type { PageData } from './$types';
import Page from './+page.svelte';

test('renders every portfolio field with an associated label', async () => {
	const form = defaults(
		{
			name: '',
			startingCapital: 100_000,
			benchmarkSymbol: 'SPY',
			accountType: 'cash',
			dataMode: 'delayed',
			allowShortEquity: false,
			allowLongOptions: false,
			allowExtendedHours: false,
			requireTradePlan: false,
			maxOrderNotional: undefined,
			maxPositionPercent: undefined,
			maxGrossExposurePercent: undefined,
			maxDailyLoss: undefined,
			maxDrawdownPercent: undefined,
			maxOptionPremium: undefined,
			riskBehavior: 'block',
			acknowledgeSimulation: true
		},
		zod4Client(createPortfolioSchema)
	);

	const screen = await render(Page, {
		params: {},
		form: null,
		data: {
			form,
			supportedDataMode: 'delayed',
			optionsTradingEnabled: true
		} as unknown as PageData
	});

	await expect
		.element(screen.getByRole('heading', { name: 'Set your trading rules' }))
		.toBeVisible();
	await expect.element(screen.getByRole('checkbox', { name: 'Short equities' })).toBeVisible();
	await expect
		.element(screen.getByRole('checkbox', { name: 'I understand this is a simulation' }))
		.toBeVisible();
});
