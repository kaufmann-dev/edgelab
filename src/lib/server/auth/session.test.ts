import { beforeEach, describe, expect, test, vi } from 'vitest';

const repositoryMocks = vi.hoisted(() => ({
	persistAuthenticatedSession: vi.fn(),
	findAuthenticatedSession: vi.fn(),
	deleteAuthenticatedSession: vi.fn(),
	touchAuthenticatedSession: vi.fn(),
	consumeIdTokenCiphertext: vi.fn()
}));

vi.mock('./repository', () => repositoryMocks);

import { SESSION_ABSOLUTE_LIFETIME_MS, SESSION_IDLE_TIMEOUT_MS } from './constants';
import { encryptSecret, hashOpaqueToken } from './crypto';
import type { AuthEnvironment } from './environment';
import {
	createAuthenticatedSession,
	endAuthenticatedSession,
	loadAuthenticatedSession,
	refreshAuthenticatedSession
} from './session';
import type { AuthenticatedSession, AuthUser, OidcIdentity } from './types';

const now = new Date('2026-08-01T12:00:00.000Z');
const environment: AuthEnvironment = {
	origin: 'https://trade.example.com',
	issuerUrl: 'https://id.example.com/',
	clientId: 'client',
	clientSecret: 'secret',
	dataEncryptionKey: Buffer.alloc(32, 11).toString('base64'),
	callbackUrl: 'https://trade.example.com/auth/callback',
	logoutCallbackUrl: 'https://trade.example.com/auth/logout/callback',
	secureCookies: true
};
const identity: OidcIdentity = {
	issuer: 'https://id.example.com/',
	subject: 'subject-123',
	email: 'trader@example.com',
	displayName: 'Demo Trader',
	avatarUrl: null
};
const user: AuthUser = { id: 'user-id', ...identity };

beforeEach(() => {
	vi.clearAllMocks();
});

describe('server-side session service', () => {
	test('persists only a token hash and encrypted ID token', async () => {
		repositoryMocks.persistAuthenticatedSession.mockResolvedValue(user);

		const created = await createAuthenticatedSession(
			identity,
			'provider-id-token',
			environment,
			now
		);
		const persisted = repositoryMocks.persistAuthenticatedSession.mock.calls[0]?.[0];
		if (!persisted) throw new Error('Expected the session to be persisted');

		expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(persisted.tokenHash).toBe(hashOpaqueToken(created.token));
		expect(persisted.tokenHash).not.toBe(created.token);
		expect(persisted.idTokenCiphertext).not.toContain('provider-id-token');
		expect(persisted.createdAt).toEqual(now);
		expect(persisted.idleExpiresAt.getTime()).toBe(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
		expect(persisted.absoluteExpiresAt.getTime()).toBe(
			now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS
		);
	});

	test('deletes and rejects a session at its idle boundary', async () => {
		const authenticated: AuthenticatedSession = {
			user,
			session: {
				createdAt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS),
				lastActiveAt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS),
				idleExpiresAt: now,
				absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS)
			}
		};
		repositoryMocks.findAuthenticatedSession.mockResolvedValue(authenticated);

		await expect(loadAuthenticatedSession('opaque-session', now)).resolves.toBeNull();
		expect(repositoryMocks.deleteAuthenticatedSession).toHaveBeenCalledWith(
			hashOpaqueToken('opaque-session')
		);
	});

	test('refreshes idle expiry only when explicitly invoked', async () => {
		const refreshedExpiry = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
		repositoryMocks.touchAuthenticatedSession.mockResolvedValue({
			idleExpiresAt: refreshedExpiry,
			absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS)
		});

		await expect(refreshAuthenticatedSession('opaque-session', now)).resolves.toEqual(
			refreshedExpiry
		);
		expect(repositoryMocks.touchAuthenticatedSession).toHaveBeenCalledWith(
			hashOpaqueToken('opaque-session'),
			now,
			refreshedExpiry
		);
	});

	test('atomically consumes and decrypts the ID token for RP logout', async () => {
		repositoryMocks.consumeIdTokenCiphertext.mockResolvedValue(
			encryptSecret('provider-id-token', environment.dataEncryptionKey, 'id-token')
		);

		await expect(endAuthenticatedSession('opaque-session', environment)).resolves.toBe(
			'provider-id-token'
		);
		expect(repositoryMocks.consumeIdTokenCiphertext).toHaveBeenCalledWith(
			hashOpaqueToken('opaque-session')
		);
	});
});
