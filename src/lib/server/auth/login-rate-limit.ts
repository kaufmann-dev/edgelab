const LOGIN_RATE_WINDOW_MILLISECONDS = 60_000;
const MAX_LOGIN_STARTS_PER_WINDOW = 20;

const stateSymbol = Symbol.for('trading-simulator.oidc-login-rate-limit');
const processGlobal = globalThis as typeof globalThis & {
	[stateSymbol]?: { attempts: number[] };
};
const state = processGlobal[stateSymbol] ?? { attempts: [] };
processGlobal[stateSymbol] = state;

export class LoginRateLimitError extends Error {
	constructor(readonly retryAfterSeconds: number) {
		super('Too many login attempts. Try again shortly.');
		this.name = 'LoginRateLimitError';
	}
}

/** Applies a process-wide login-start limit before contacting the identity provider or database. */
export function enforceLoginStartRateLimit(now = new Date()): void {
	const nowMilliseconds = now.getTime();
	if (!Number.isFinite(nowMilliseconds)) throw new Error('Login attempt time is invalid');
	const cutoff = nowMilliseconds - LOGIN_RATE_WINDOW_MILLISECONDS;
	state.attempts = state.attempts.filter((attempt) => attempt > cutoff);
	if (state.attempts.length >= MAX_LOGIN_STARTS_PER_WINDOW) {
		const retryAt = state.attempts[0] + LOGIN_RATE_WINDOW_MILLISECONDS;
		throw new LoginRateLimitError(Math.max(1, Math.ceil((retryAt - nowMilliseconds) / 1_000)));
	}
	state.attempts.push(nowMilliseconds);
}

export function resetLoginStartRateLimitForTests(): void {
	state.attempts = [];
}
