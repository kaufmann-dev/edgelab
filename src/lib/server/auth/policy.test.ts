import { describe, expect, test } from 'vitest';
import { SESSION_ABSOLUTE_LIFETIME_MS, SESSION_IDLE_TIMEOUT_MS } from './constants';
import { candidateIdleExpiry, createSessionWindow, isSessionExpired } from './policy';

const now = new Date('2026-08-01T12:00:00.000Z');

describe('local session policy', () => {
	test('creates a 24-hour idle window and fixed seven-day absolute lifetime', () => {
		const window = createSessionWindow(now);

		expect(window.idleExpiresAt.getTime() - now.getTime()).toBe(SESSION_IDLE_TIMEOUT_MS);
		expect(window.absoluteExpiresAt.getTime() - now.getTime()).toBe(SESSION_ABSOLUTE_LIFETIME_MS);
	});

	test('expires at either boundary, including the exact instant', () => {
		const window = createSessionWindow(now);
		const session = { createdAt: now, lastActiveAt: now, ...window };

		expect(isSessionExpired(session, new Date(window.idleExpiresAt.getTime() - 1))).toBe(false);
		expect(isSessionExpired(session, window.idleExpiresAt)).toBe(true);
		expect(
			isSessionExpired(
				{ ...session, idleExpiresAt: window.absoluteExpiresAt },
				window.absoluteExpiresAt
			)
		).toBe(true);
	});

	test('calculates sliding idle expiry from explicit activity time', () => {
		expect(candidateIdleExpiry(now).getTime()).toBe(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
	});
});
