import { describe, expect, test, vi } from 'vitest';
import type { AuthEnvironment } from '$lib/server/auth/environment';

const environment: AuthEnvironment = {
	origin: 'https://trade.example.com',
	issuerUrl: 'https://id.example.com/',
	clientId: 'client',
	clientSecret: 'secret',
	dataEncryptionKey: Buffer.alloc(32).toString('base64'),
	callbackUrl: 'https://trade.example.com/auth/callback',
	logoutCallbackUrl: 'https://trade.example.com/auth/logout/callback',
	secureCookies: true
};

vi.mock('$lib/server/auth/environment', () => ({ getAuthEnvironment: () => environment }));

import { load } from './+page.server';

describe('login page load', () => {
	test('renders the login screen without starting OIDC for an unauthenticated visitor', async () => {
		const setHeaders = vi.fn();
		const markSessionActive = vi.fn();

		const result = await load({
			locals: { user: null, session: null, markSessionActive },
			setHeaders,
			url: new URL('https://trade.example.com/auth/login?returnTo=%2Fp%2Fportfolio-id%2Forders')
		} as unknown as Parameters<typeof load>[0]);

		expect(result).toEqual({ returnTo: '/p/portfolio-id/orders' });
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
		expect(markSessionActive).not.toHaveBeenCalled();
	});

	test('redirects an authenticated visitor to the validated destination', async () => {
		const markSessionActive = vi.fn();

		await expect(
			Promise.resolve().then(() =>
				load({
					locals: {
						user: {
							id: 'user-id',
							issuer: 'https://id.example.com/',
							subject: 'subject-id',
							email: 'trader@example.com',
							displayName: 'Trader',
							avatarUrl: null
						},
						session: null,
						markSessionActive
					},
					setHeaders: vi.fn(),
					url: new URL('https://trade.example.com/auth/login?returnTo=%2Fsettings')
				} as unknown as Parameters<typeof load>[0])
			)
		).rejects.toMatchObject({ status: 303, location: '/settings' });
		expect(markSessionActive).toHaveBeenCalledOnce();
	});
});
