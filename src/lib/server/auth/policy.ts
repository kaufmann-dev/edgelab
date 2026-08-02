import { SESSION_ABSOLUTE_LIFETIME_MS, SESSION_IDLE_TIMEOUT_MS } from './constants';
import type { AuthSession } from './types';

export interface SessionWindow {
	idleExpiresAt: Date;
	absoluteExpiresAt: Date;
}

export function createSessionWindow(now: Date): SessionWindow {
	return {
		idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS),
		absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS)
	};
}

export function isSessionExpired(session: AuthSession, now: Date): boolean {
	return (
		session.idleExpiresAt.getTime() <= now.getTime() ||
		session.absoluteExpiresAt.getTime() <= now.getTime()
	);
}

export function candidateIdleExpiry(now: Date): Date {
	return new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
}
