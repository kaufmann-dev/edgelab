import { OIDC_FLOW_LIFETIME_MS } from './constants';
import { decryptSecret, encryptSecret, hashOpaqueToken, randomOpaqueToken } from './crypto';
import type { AuthEnvironment } from './environment';
import { enforceLoginStartRateLimit } from './login-rate-limit';
import { createAuthorizationRequest } from './oidc';
import { consumeLoginRequest, deleteLoginRequest, storeLoginRequest } from './repository';

export interface StartedLoginFlow {
	token: string;
	authorizationUrl: URL;
}

export interface ConsumedLoginFlow {
	state: string;
	nonce: string;
	codeVerifier: string;
	returnTo: string;
}

export async function startLoginFlow(
	returnTo: string,
	environment: AuthEnvironment,
	now = new Date()
): Promise<StartedLoginFlow> {
	enforceLoginStartRateLimit(now);
	const authorization = await createAuthorizationRequest(environment);
	const token = randomOpaqueToken();
	await storeLoginRequest(hashOpaqueToken(token), {
		state: authorization.state,
		nonce: authorization.nonce,
		codeVerifierCiphertext: encryptSecret(
			authorization.codeVerifier,
			environment.dataEncryptionKey,
			'pkce-verifier'
		),
		returnTo,
		createdAt: now,
		expiresAt: new Date(now.getTime() + OIDC_FLOW_LIFETIME_MS)
	});

	return { token, authorizationUrl: authorization.url };
}

export async function abandonLoginFlow(token: string): Promise<void> {
	await deleteLoginRequest(hashOpaqueToken(token));
}

export async function finishLoginFlow(
	token: string,
	environment: AuthEnvironment,
	now = new Date()
): Promise<ConsumedLoginFlow | null> {
	const request = await consumeLoginRequest(hashOpaqueToken(token));
	if (!request || request.expiresAt.getTime() <= now.getTime()) return null;

	return {
		state: request.state,
		nonce: request.nonce,
		codeVerifier: decryptSecret(
			request.codeVerifierCiphertext,
			environment.dataEncryptionKey,
			'pkce-verifier'
		),
		returnTo: request.returnTo
	};
}
