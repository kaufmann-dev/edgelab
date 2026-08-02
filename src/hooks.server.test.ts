import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthEnvironment } from '$lib/server/auth/environment';
import type { AuthenticatedSession } from '$lib/server/auth/types';

const authMocks = vi.hoisted(() => ({
	loadAuthenticatedSession: vi.fn(),
	refreshAuthenticatedSession: vi.fn()
}));

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

vi.mock('$app/environment', () => ({ building: true }));
vi.mock('$lib/server/auth/environment', () => ({ getAuthEnvironment: () => environment }));
vi.mock('$lib/server/auth/session', () => authMocks);

import { SESSION_COOKIE_NAME } from '$lib/server/auth/constants';
import { handleAuthentication } from './hooks.server';

const authenticated: AuthenticatedSession = {
	user: {
		id: 'user-id',
		issuer: 'https://issuer.example/',
		subject: 'subject-id',
		email: 'trader@example.com',
		displayName: 'Trader',
		avatarUrl: null
	},
	session: {
		createdAt: new Date('2026-08-02T10:00:00.000Z'),
		lastActiveAt: new Date('2026-08-02T10:00:00.000Z'),
		idleExpiresAt: new Date('2026-08-02T11:00:00.000Z'),
		absoluteExpiresAt: new Date('2026-08-09T10:00:00.000Z')
	}
};

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.loadAuthenticatedSession.mockResolvedValue(authenticated);
});

describe('authentication handle hook', () => {
	test('adds a refreshed session cookie to the generated response', async () => {
		const refreshedExpiry = new Date('2026-08-02T12:00:00.000Z');
		authMocks.refreshAuthenticatedSession.mockResolvedValue(refreshedExpiry);
		let responseGenerated = false;
		const serialize = vi.fn(() => 'app_session=refreshed; Path=/; HttpOnly');
		const cookies = {
			get: vi.fn((name: string) => (name === SESSION_COOKIE_NAME ? 'opaque-session' : undefined)),
			set: vi.fn(() => {
				if (responseGenerated)
					throw new Error('cookie mutation happened after response generation');
			}),
			delete: vi.fn(),
			serialize
		} as unknown as Cookies;
		const event = {
			cookies,
			locals: {},
			request: new Request('https://trade.example.com/', {
				headers: { accept: 'text/html' }
			}),
			route: { id: '/' },
			url: new URL('https://trade.example.com/')
		} as unknown as RequestEvent;

		const response = await handleAuthentication({
			event,
			resolve: async () => {
				responseGenerated = true;
				return new Response('ok');
			}
		});

		expect(response.headers.get('set-cookie')).toBe('app_session=refreshed; Path=/; HttpOnly');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(cookies.set).not.toHaveBeenCalled();
		expect(serialize).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'opaque-session', {
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/',
			expires: refreshedExpiry
		});
	});
});
