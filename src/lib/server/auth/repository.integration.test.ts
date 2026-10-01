import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authSessions, users } from '#lib/server/db/schema/auth.js';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('auth repository integration', () => {
	it('encodes and caps session idle expiry timestamps', async () => {
		const { db } = await import('#lib/server/db/index.js');
		const { touchAuthenticatedSession } = await import('./repository');
		const now = new Date();
		const candidateIdleExpiry = new Date(now.getTime() + 60 * 60 * 1_000);
		const absoluteExpiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
		const tokenHash = crypto.randomUUID();
		const [user] = await db
			.insert(users)
			.values({
				issuer: `https://issuer.example/${crypto.randomUUID()}`,
				subject: crypto.randomUUID(),
				createdAt: now,
				updatedAt: now,
				lastLoginAt: now
			})
			.returning({ id: users.id });

		if (!user) throw new Error('Expected an inserted auth user');

		try {
			await db.insert(authSessions).values({
				tokenHash,
				userId: user.id,
				idTokenCiphertext: 'integration-test-token',
				createdAt: now,
				lastActiveAt: now,
				idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
				absoluteExpiresAt
			});

			const refreshed = await touchAuthenticatedSession(tokenHash, now, candidateIdleExpiry);
			expect(refreshed).toEqual({ idleExpiresAt: candidateIdleExpiry, absoluteExpiresAt });

			const afterAbsoluteExpiry = new Date(absoluteExpiresAt.getTime() + 60 * 60 * 1_000);
			const capped = await touchAuthenticatedSession(
				tokenHash,
				new Date(now.getTime() + 1_000),
				afterAbsoluteExpiry
			);
			expect(capped).toEqual({ idleExpiresAt: absoluteExpiresAt, absoluteExpiresAt });
		} finally {
			await db.delete(users).where(eq(users.id, user.id));
		}
	});
});
