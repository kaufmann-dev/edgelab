import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Button from './button.svelte';

test('forwards final anchor hrefs without resolving them again', async () => {
	const screen = await render(Button, {
		href: './portfolios',
		'aria-label': 'Portfolios'
	});

	await expect
		.element(screen.getByRole('link', { name: 'Portfolios' }))
		.toHaveAttribute('href', './portfolios');
});
