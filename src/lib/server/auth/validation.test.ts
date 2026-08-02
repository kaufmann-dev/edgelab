import { describe, expect, test } from 'vitest';
import { getAuthEnvironment } from './environment';
import { assertSameOrigin, safeReturnTo } from './validation';

const source = {
	ORIGIN: 'https://trade.example.com',
	OIDC_ISSUER_URL: 'https://id.example.com',
	OIDC_CLIENT_ID: 'trading-simulator',
	OIDC_CLIENT_SECRET: 'client-secret',
	OIDC_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64')
};

describe('authentication input validation', () => {
	test('derives fixed callback URLs from the canonical origin', () => {
		const environment = getAuthEnvironment(source);

		expect(environment.origin).toBe('https://trade.example.com');
		expect(environment.callbackUrl).toBe('https://trade.example.com/auth/callback');
		expect(environment.logoutCallbackUrl).toBe('https://trade.example.com/auth/logout/callback');
		expect(environment.secureCookies).toBe(true);
	});

	test('allows HTTP only for local development', () => {
		expect(
			getAuthEnvironment({
				...source,
				ORIGIN: 'http://localhost:5173',
				OIDC_ISSUER_URL: 'http://127.0.0.1:1411'
			}).secureCookies
		).toBe(false);
		expect(() => getAuthEnvironment({ ...source, ORIGIN: 'http://trade.example.com' })).toThrow(
			/HTTPS/
		);
	});

	test('rejects an encryption key with the wrong decoded length', () => {
		expect(() =>
			getAuthEnvironment({
				...source,
				OIDC_DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64')
			})
		).toThrow(/32 bytes/);
	});

	test('accepts only internal non-authentication return paths', () => {
		const origin = 'https://trade.example.com';

		expect(safeReturnTo('/portfolio/123?tab=orders', origin)).toBe('/portfolio/123?tab=orders');
		expect(safeReturnTo('https://evil.example/', origin)).toBe('/');
		expect(safeReturnTo('//evil.example/', origin)).toBe('/');
		expect(safeReturnTo('/auth/logout', origin)).toBe('/');
		expect(safeReturnTo('/\\evil.example', origin)).toBe('/');
	});

	test('requires an exact Origin header for state-changing requests', () => {
		expect(() =>
			assertSameOrigin(
				new Request('https://trade.example.com/auth/logout', {
					method: 'POST',
					headers: { origin: 'https://trade.example.com' }
				}),
				'https://trade.example.com'
			)
		).not.toThrow();
		expect(() =>
			assertSameOrigin(
				new Request('https://trade.example.com/auth/logout', {
					method: 'POST',
					headers: { origin: 'https://evil.example' }
				}),
				'https://trade.example.com'
			)
		).toThrow(/Cross-origin/);
	});
});
