import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { PageData } from './$types';
import Page from './+page.svelte';

const portfolioId = '11111111-1111-4111-8111-111111111111';

function tradeData(input: {
	symbol: string;
	expiration: string;
	contractSymbol: string;
	strike: number;
}): PageData {
	return {
		portfolio: { id: portfolioId, dataMode: 'delayed' },
		requestedSymbol: input.symbol,
		symbolValid: true,
		assetView: 'options',
		optionsViewRequested: true,
		optionsDataEnabled: true,
		optionsTradingEnabled: true,
		optionsTradingReason: '',
		optionsMarketData: {
			priceRecency: '15-minute-delayed prices',
			greeksRecency: 'Real-time Greeks and implied volatility',
			openInterestRecency: 'Daily open interest',
			showBidAsk: false,
			executionDescription: 'Fills wait for a future eligible aggregate.'
		},
		quote: null,
		marketFeed: null,
		marketError: null,
		options: {
			rows: [
				{
					id: String(input.strike),
					strike: input.strike,
					isAtTheMoney: true,
					call: {
						id: input.contractSymbol,
						symbol: input.contractSymbol,
						type: 'call',
						strike: input.strike,
						standardDeliverable: true,
						sessionClose: 2.5,
						asOf: '2026-08-01T19:45:00.000Z'
					}
				}
			],
			expiration: input.expiration,
			expirations: [input.expiration],
			error: null
		},
		policy: null,
		balances: { cashBalance: '100000.00' },
		tradePlans: []
	} as unknown as PageData;
}

test('clears selected option state when same-route market data changes', async () => {
	const aaplContract = 'O:AAPL260918C00200000';
	const screen = await render(Page, {
		params: { portfolioId },
		form: null,
		data: tradeData({
			symbol: 'AAPL',
			expiration: '2026-09-18',
			contractSymbol: aaplContract,
			strike: 200
		})
	});

	await screen
		.getByRole('button', { name: `Select ${aaplContract} call contract` })
		.first()
		.click();
	const ticket = screen.getByRole('region', { name: 'Single-contract limit ticket' });
	await expect.element(ticket.getByText(aaplContract, { exact: true })).toBeVisible();

	await screen.rerender({
		params: { portfolioId },
		form: null,
		data: tradeData({
			symbol: 'MSFT',
			expiration: '2026-10-16',
			contractSymbol: 'O:MSFT261016C00500000',
			strike: 500
		})
	});

	await expect
		.element(ticket.getByText('Select a standard contract', { exact: true }))
		.toBeVisible();
	await expect.element(ticket.getByText(aaplContract, { exact: true })).not.toBeInTheDocument();
});
