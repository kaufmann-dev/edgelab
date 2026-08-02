import { beforeEach, describe, expect, it } from 'vitest';
import {
	enforceLoginStartRateLimit,
	LoginRateLimitError,
	resetLoginStartRateLimitForTests
} from './login-rate-limit';

describe('OIDC login-start rate limit', () => {
	beforeEach(resetLoginStartRateLimitForTests);

	it('limits bursts and permits another attempt after the fixed window', () => {
		const startedAt = new Date('2026-08-01T12:00:00.000Z');
		for (let attempt = 0; attempt < 20; attempt += 1) {
			expect(() => enforceLoginStartRateLimit(startedAt)).not.toThrow();
		}
		expect(() => enforceLoginStartRateLimit(startedAt)).toThrow(LoginRateLimitError);
		expect(() => enforceLoginStartRateLimit(new Date(startedAt.getTime() + 60_001))).not.toThrow();
	});
});
