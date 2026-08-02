import {
	ClientSecretPost,
	authorizationCodeGrant,
	buildAuthorizationUrl,
	buildEndSessionUrl,
	calculatePKCECodeChallenge,
	discovery,
	randomNonce,
	randomPKCECodeVerifier,
	randomState,
	type Configuration
} from 'openid-client';
import { OIDC_SCOPE } from './constants';
import type { AuthEnvironment } from './environment';
import type { OidcIdentity } from './types';

let configurationKey: string | undefined;
let configurationPromise: Promise<Configuration> | undefined;

function cacheKey(environment: AuthEnvironment): string {
	return `${environment.issuerUrl}\u0000${environment.clientId}`;
}

export async function discoverOidcConfiguration(
	environment: AuthEnvironment
): Promise<Configuration> {
	const configuration = await discovery(
		new URL(environment.issuerUrl),
		environment.clientId,
		{ token_endpoint_auth_method: 'client_secret_post' },
		ClientSecretPost(environment.clientSecret)
	);
	const metadata = configuration.serverMetadata();
	if (
		!metadata.authorization_endpoint ||
		!metadata.token_endpoint ||
		!metadata.end_session_endpoint
	) {
		throw new Error('OIDC provider metadata is missing a required endpoint');
	}
	return configuration;
}

export function getOidcConfiguration(environment: AuthEnvironment): Promise<Configuration> {
	const key = cacheKey(environment);
	if (!configurationPromise || configurationKey !== key) {
		configurationKey = key;
		configurationPromise = discoverOidcConfiguration(environment).catch((cause: unknown) => {
			configurationPromise = undefined;
			configurationKey = undefined;
			throw cause;
		});
	}
	return configurationPromise;
}

export interface AuthorizationRequest {
	url: URL;
	state: string;
	nonce: string;
	codeVerifier: string;
}

export async function createAuthorizationRequest(
	environment: AuthEnvironment
): Promise<AuthorizationRequest> {
	const [configuration, codeVerifier] = await Promise.all([
		getOidcConfiguration(environment),
		Promise.resolve(randomPKCECodeVerifier())
	]);
	const [codeChallenge, state, nonce] = await Promise.all([
		calculatePKCECodeChallenge(codeVerifier),
		Promise.resolve(randomState()),
		Promise.resolve(randomNonce())
	]);
	const url = buildAuthorizationUrl(configuration, {
		redirect_uri: environment.callbackUrl,
		scope: OIDC_SCOPE,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
		state,
		nonce
	});

	return { url, state, nonce, codeVerifier };
}

function optionalString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function exchangeAuthorizationCode(
	environment: AuthEnvironment,
	callbackUrl: URL,
	checks: { codeVerifier: string; state: string; nonce: string }
): Promise<{ identity: OidcIdentity; idToken: string }> {
	const configuration = await getOidcConfiguration(environment);
	const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
		pkceCodeVerifier: checks.codeVerifier,
		expectedState: checks.state,
		expectedNonce: checks.nonce,
		idTokenExpected: true
	});
	const claims = tokens.claims();
	if (!tokens.id_token || !claims?.iss || !claims.sub) {
		throw new Error('OIDC response did not contain a valid identity');
	}

	const expectedIssuer = configuration.serverMetadata().issuer;
	if (claims.iss !== expectedIssuer) {
		throw new Error('OIDC identity issuer did not match discovery metadata');
	}

	return {
		idToken: tokens.id_token,
		identity: {
			issuer: claims.iss,
			subject: claims.sub,
			email: optionalString(claims.email),
			displayName: optionalString(claims.name) ?? optionalString(claims.preferred_username),
			avatarUrl: optionalString(claims.picture)
		}
	};
}

export async function createLogoutUrl(environment: AuthEnvironment, idToken: string): Promise<URL> {
	const configuration = await getOidcConfiguration(environment);
	return buildEndSessionUrl(configuration, {
		id_token_hint: idToken,
		post_logout_redirect_uri: environment.logoutCallbackUrl
	});
}
