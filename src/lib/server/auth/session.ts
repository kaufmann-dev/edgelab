import { decryptSecret, encryptSecret, hashOpaqueToken, randomOpaqueToken } from './crypto';
import type { AuthEnvironment } from './environment';
import { candidateIdleExpiry, createSessionWindow, isSessionExpired } from './policy';
import {
	consumeIdTokenCiphertext,
	deleteAuthenticatedSession,
	findAuthenticatedSession,
	persistAuthenticatedSession,
	touchAuthenticatedSession
} from './repository';
import type { AuthenticatedSession, OidcIdentity } from './types';

export async function createAuthenticatedSession(
	identity: OidcIdentity,
	idToken: string,
	environment: AuthEnvironment,
	now = new Date()
): Promise<{ token: string; authenticated: AuthenticatedSession }> {
	const token = randomOpaqueToken();
	const tokenHash = hashOpaqueToken(token);
	const window = createSessionWindow(now);
	const user = await persistAuthenticatedSession({
		tokenHash,
		idTokenCiphertext: encryptSecret(idToken, environment.dataEncryptionKey, 'id-token'),
		identity,
		createdAt: now,
		...window
	});

	return {
		token,
		authenticated: {
			user,
			session: {
				createdAt: now,
				lastActiveAt: now,
				...window
			}
		}
	};
}

export async function loadAuthenticatedSession(
	token: string,
	now = new Date()
): Promise<AuthenticatedSession | null> {
	const tokenHash = hashOpaqueToken(token);
	const authenticated = await findAuthenticatedSession(tokenHash);
	if (!authenticated) return null;

	if (isSessionExpired(authenticated.session, now)) {
		await deleteAuthenticatedSession(tokenHash);
		return null;
	}

	return authenticated;
}

export async function refreshAuthenticatedSession(
	token: string,
	now = new Date()
): Promise<Date | null> {
	const refreshed = await touchAuthenticatedSession(
		hashOpaqueToken(token),
		now,
		candidateIdleExpiry(now)
	);

	return refreshed?.idleExpiresAt ?? null;
}

export async function endAuthenticatedSession(
	token: string,
	environment: AuthEnvironment
): Promise<string | null> {
	const ciphertext = await consumeIdTokenCiphertext(hashOpaqueToken(token));
	return ciphertext ? decryptSecret(ciphertext, environment.dataEncryptionKey, 'id-token') : null;
}
