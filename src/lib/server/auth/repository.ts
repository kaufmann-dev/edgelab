import { and, eq, gt, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { authSessions, oidcLoginRequests, users } from '$lib/server/db/schema/auth';
import type { AuthenticatedSession, AuthUser, LoginRequest, OidcIdentity } from './types';

const MAX_OUTSTANDING_LOGIN_REQUESTS = 1_000;

export class LoginFlowCapacityError extends Error {
	constructor() {
		super('The login service is temporarily busy. Try again shortly.');
		this.name = 'LoginFlowCapacityError';
	}
}

function toAuthUser(user: typeof users.$inferSelect): AuthUser {
	return {
		id: user.id,
		issuer: user.issuer,
		subject: user.subject,
		email: user.email,
		displayName: user.displayName,
		avatarUrl: user.avatarUrl
	};
}

export async function storeLoginRequest(tokenHash: string, request: LoginRequest): Promise<void> {
	await db.transaction(async (transaction) => {
		await transaction.execute(sql`select pg_advisory_xact_lock(178239, 1)`);
		await transaction
			.delete(oidcLoginRequests)
			.where(lte(oidcLoginRequests.expiresAt, request.createdAt));
		const [outstanding] = await transaction
			.select({ count: sql<number>`count(*)::integer` })
			.from(oidcLoginRequests);
		if ((outstanding?.count ?? 0) >= MAX_OUTSTANDING_LOGIN_REQUESTS) {
			throw new LoginFlowCapacityError();
		}
		await transaction.insert(oidcLoginRequests).values({ tokenHash, ...request });
	});
}

export async function deleteLoginRequest(tokenHash: string): Promise<void> {
	await db.delete(oidcLoginRequests).where(eq(oidcLoginRequests.tokenHash, tokenHash));
}

export async function consumeLoginRequest(tokenHash: string): Promise<LoginRequest | null> {
	const [request] = await db
		.delete(oidcLoginRequests)
		.where(eq(oidcLoginRequests.tokenHash, tokenHash))
		.returning({
			state: oidcLoginRequests.state,
			nonce: oidcLoginRequests.nonce,
			codeVerifierCiphertext: oidcLoginRequests.codeVerifierCiphertext,
			returnTo: oidcLoginRequests.returnTo,
			createdAt: oidcLoginRequests.createdAt,
			expiresAt: oidcLoginRequests.expiresAt
		});

	return request ?? null;
}

interface PersistSessionInput {
	tokenHash: string;
	idTokenCiphertext: string;
	identity: OidcIdentity;
	createdAt: Date;
	idleExpiresAt: Date;
	absoluteExpiresAt: Date;
}

export async function persistAuthenticatedSession(input: PersistSessionInput): Promise<AuthUser> {
	return db.transaction(async (transaction) => {
		await transaction
			.delete(authSessions)
			.where(
				or(
					lte(authSessions.idleExpiresAt, input.createdAt),
					lte(authSessions.absoluteExpiresAt, input.createdAt)
				)
			);
		const [user] = await transaction
			.insert(users)
			.values({
				issuer: input.identity.issuer,
				subject: input.identity.subject,
				email: input.identity.email,
				displayName: input.identity.displayName,
				avatarUrl: input.identity.avatarUrl,
				createdAt: input.createdAt,
				updatedAt: input.createdAt,
				lastLoginAt: input.createdAt
			})
			.onConflictDoUpdate({
				target: [users.issuer, users.subject],
				set: {
					email: input.identity.email,
					displayName: input.identity.displayName,
					avatarUrl: input.identity.avatarUrl,
					updatedAt: input.createdAt,
					lastLoginAt: input.createdAt
				}
			})
			.returning();

		if (!user) throw new Error('OIDC user upsert returned no row');

		await transaction.insert(authSessions).values({
			tokenHash: input.tokenHash,
			userId: user.id,
			idTokenCiphertext: input.idTokenCiphertext,
			createdAt: input.createdAt,
			lastActiveAt: input.createdAt,
			idleExpiresAt: input.idleExpiresAt,
			absoluteExpiresAt: input.absoluteExpiresAt
		});

		return toAuthUser(user);
	});
}

export async function findAuthenticatedSession(
	tokenHash: string
): Promise<AuthenticatedSession | null> {
	const [record] = await db
		.select({
			user: {
				id: users.id,
				issuer: users.issuer,
				subject: users.subject,
				email: users.email,
				displayName: users.displayName,
				avatarUrl: users.avatarUrl
			},
			session: {
				createdAt: authSessions.createdAt,
				lastActiveAt: authSessions.lastActiveAt,
				idleExpiresAt: authSessions.idleExpiresAt,
				absoluteExpiresAt: authSessions.absoluteExpiresAt
			}
		})
		.from(authSessions)
		.innerJoin(users, eq(authSessions.userId, users.id))
		.where(eq(authSessions.tokenHash, tokenHash))
		.limit(1);

	return record ?? null;
}

export async function deleteAuthenticatedSession(tokenHash: string): Promise<void> {
	await db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}

export async function consumeIdTokenCiphertext(tokenHash: string): Promise<string | null> {
	const [record] = await db
		.delete(authSessions)
		.where(eq(authSessions.tokenHash, tokenHash))
		.returning({ idTokenCiphertext: authSessions.idTokenCiphertext });

	return record?.idTokenCiphertext ?? null;
}

export async function touchAuthenticatedSession(
	tokenHash: string,
	now: Date,
	candidateIdleExpiry: Date
): Promise<{ idleExpiresAt: Date; absoluteExpiresAt: Date } | null> {
	const [record] = await db
		.update(authSessions)
		.set({
			lastActiveAt: now,
			idleExpiresAt: sql<Date>`least(${candidateIdleExpiry}, ${authSessions.absoluteExpiresAt})`
		})
		.where(
			and(
				eq(authSessions.tokenHash, tokenHash),
				gt(authSessions.idleExpiresAt, now),
				gt(authSessions.absoluteExpiresAt, now)
			)
		)
		.returning({
			idleExpiresAt: authSessions.idleExpiresAt,
			absoluteExpiresAt: authSessions.absoluteExpiresAt
		});

	return record ?? null;
}
