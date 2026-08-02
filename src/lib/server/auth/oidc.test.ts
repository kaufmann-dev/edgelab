import { describe, expect, test, vi } from 'vitest';

const oidcMocks = vi.hoisted(() => {
	const metadata = {
		issuer: 'https://id.example.com/',
		authorization_endpoint: 'https://id.example.com/authorize',
		token_endpoint: 'https://id.example.com/token',
		end_session_endpoint: 'https://id.example.com/logout'
	};
	const configuration = { serverMetadata: () => metadata };
	const clientAuthentication = { method: 'client_secret_post' };

	return {
		configuration,
		clientAuthentication,
		clientSecretPost: vi.fn(() => clientAuthentication),
		discovery: vi.fn(async () => configuration),
		randomPKCECodeVerifier: vi.fn(() => 'pkce-verifier'),
		calculatePKCECodeChallenge: vi.fn(async () => 'pkce-challenge'),
		randomState: vi.fn(() => 'csrf-state'),
		randomNonce: vi.fn(() => 'oidc-nonce'),
		buildAuthorizationUrl: vi.fn((_configuration: unknown, parameters: Record<string, string>) => {
			const url = new URL(metadata.authorization_endpoint);
			for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
			return url;
		}),
		authorizationCodeGrant: vi.fn(async () => ({
			id_token: 'signed-id-token',
			access_token: 'discarded-access-token',
			refresh_token: 'discarded-refresh-token',
			claims: () => ({
				iss: metadata.issuer,
				sub: 'subject-123',
				aud: 'trading-simulator',
				iat: 1,
				exp: 2,
				email: 'trader@example.com',
				name: 'Demo Trader',
				picture: 'https://id.example.com/avatar.png'
			})
		})),
		buildEndSessionUrl: vi.fn((_configuration: unknown, parameters: Record<string, string>) => {
			const url = new URL(metadata.end_session_endpoint);
			for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
			return url;
		})
	};
});

vi.mock('openid-client', () => ({
	ClientSecretPost: oidcMocks.clientSecretPost,
	authorizationCodeGrant: oidcMocks.authorizationCodeGrant,
	buildAuthorizationUrl: oidcMocks.buildAuthorizationUrl,
	buildEndSessionUrl: oidcMocks.buildEndSessionUrl,
	calculatePKCECodeChallenge: oidcMocks.calculatePKCECodeChallenge,
	discovery: oidcMocks.discovery,
	randomNonce: oidcMocks.randomNonce,
	randomPKCECodeVerifier: oidcMocks.randomPKCECodeVerifier,
	randomState: oidcMocks.randomState
}));

import type { AuthEnvironment } from './environment';
import { createAuthorizationRequest, createLogoutUrl, exchangeAuthorizationCode } from './oidc';

const environment: AuthEnvironment = {
	origin: 'https://trade.example.com',
	issuerUrl: 'https://id.example.com/',
	clientId: 'trading-simulator',
	clientSecret: 'confidential-secret',
	dataEncryptionKey: Buffer.alloc(32).toString('base64'),
	callbackUrl: 'https://trade.example.com/auth/callback',
	logoutCallbackUrl: 'https://trade.example.com/auth/logout/callback',
	secureCookies: true
};

describe('OIDC protocol integration', () => {
	test('uses client_secret_post, PKCE S256, validated OIDC claims, and RP logout', async () => {
		const authorization = await createAuthorizationRequest(environment);

		expect(oidcMocks.clientSecretPost).toHaveBeenCalledWith('confidential-secret');
		expect(oidcMocks.discovery).toHaveBeenCalledWith(
			new URL('https://id.example.com/'),
			'trading-simulator',
			{ token_endpoint_auth_method: 'client_secret_post' },
			oidcMocks.clientAuthentication
		);
		expect(oidcMocks.calculatePKCECodeChallenge).toHaveBeenCalledWith('pkce-verifier');
		expect(oidcMocks.buildAuthorizationUrl).toHaveBeenCalledWith(
			oidcMocks.configuration,
			expect.objectContaining({
				redirect_uri: environment.callbackUrl,
				scope: 'openid profile email',
				code_challenge: 'pkce-challenge',
				code_challenge_method: 'S256',
				state: 'csrf-state',
				nonce: 'oidc-nonce'
			})
		);
		expect(authorization.url.searchParams.get('scope')).not.toContain('offline_access');

		const callbackUrl = new URL(
			`${environment.callbackUrl}?code=authorization-code&state=csrf-state`
		);
		const exchange = await exchangeAuthorizationCode(environment, callbackUrl, {
			codeVerifier: authorization.codeVerifier,
			state: authorization.state,
			nonce: authorization.nonce
		});

		expect(oidcMocks.authorizationCodeGrant).toHaveBeenCalledWith(
			oidcMocks.configuration,
			callbackUrl,
			{
				pkceCodeVerifier: 'pkce-verifier',
				expectedState: 'csrf-state',
				expectedNonce: 'oidc-nonce',
				idTokenExpected: true
			}
		);
		expect(exchange).toEqual({
			idToken: 'signed-id-token',
			identity: {
				issuer: 'https://id.example.com/',
				subject: 'subject-123',
				email: 'trader@example.com',
				displayName: 'Demo Trader',
				avatarUrl: 'https://id.example.com/avatar.png'
			}
		});

		const logoutUrl = await createLogoutUrl(environment, exchange.idToken);
		expect(oidcMocks.buildEndSessionUrl).toHaveBeenCalledWith(oidcMocks.configuration, {
			id_token_hint: 'signed-id-token',
			post_logout_redirect_uri: environment.logoutCallbackUrl
		});
		expect(logoutUrl.origin).toBe('https://id.example.com');
	});
});
