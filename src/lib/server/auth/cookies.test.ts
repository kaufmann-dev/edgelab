import type { Cookies } from '@sveltejs/kit';
import { describe, expect, test, vi } from 'vitest';
import { OIDC_FLOW_COOKIE_NAME, SESSION_COOKIE_NAME } from './constants';
import {
	clearOidcFlowCookie,
	clearSessionCookie,
	setOidcFlowCookie,
	setSessionCookie
} from './cookies';
import type { AuthEnvironment } from './environment';

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

describe('authentication cookies', () => {
	test('sets the opaque session cookie with an idle expiry and hardened flags', () => {
		const set = vi.fn();
		const cookies = { set } as unknown as Cookies;
		const expires = new Date('2026-08-02T12:00:00.000Z');

		setSessionCookie(cookies, 'opaque-token', expires, environment);

		expect(set).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'opaque-token', {
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/',
			expires
		});
	});

	test('limits the login transaction cookie to ten minutes', () => {
		const set = vi.fn();
		const cookies = { set } as unknown as Cookies;

		setOidcFlowCookie(cookies, 'flow-token', environment);

		expect(set).toHaveBeenCalledWith(OIDC_FLOW_COOKIE_NAME, 'flow-token', {
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/',
			maxAge: 600
		});
	});

	test('deletes cookies on the same application-wide path', () => {
		const remove = vi.fn();
		const cookies = { delete: remove } as unknown as Cookies;

		clearSessionCookie(cookies, environment);
		clearOidcFlowCookie(cookies, environment);

		expect(remove).toHaveBeenNthCalledWith(1, SESSION_COOKIE_NAME, {
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/'
		});
		expect(remove).toHaveBeenNthCalledWith(2, OIDC_FLOW_COOKIE_NAME, {
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/'
		});
	});
});
