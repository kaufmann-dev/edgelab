import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AppHeaderActions from './AppHeaderActions.svelte';

const user = { displayName: 'Ada Lovelace', email: 'ada@example.com' };

test('omits portfolio-scoped search when there is no active portfolio', async () => {
	const screen = await render(AppHeaderActions, { user, searchHref: undefined });

	await expect
		.element(screen.getByRole('link', { name: 'Search stocks and options' }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Search stocks and options' }))
		.not.toBeInTheDocument();
});

test('links active portfolios to market search', async () => {
	const screen = await render(AppHeaderActions, {
		user,
		searchHref: '/p/portfolio-id/markets#market-search'
	});

	await expect
		.element(screen.getByRole('link', { name: 'Search stocks and options' }))
		.toHaveAttribute('href', '/p/portfolio-id/markets#market-search');
});
