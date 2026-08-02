import { beforeEach, describe, expect, it } from 'vitest';
import {
	acquireMarketStreamAccess,
	MarketStreamAccessError,
	resetMarketStreamAccessForTests
} from './market-stream-access';

describe('authenticated market-stream resource limits', () => {
	beforeEach(resetMarketStreamAccessForTests);

	it('caps concurrent connections per user and releases slots idempotently', () => {
		const releases = Array.from({ length: 4 }, () =>
			acquireMarketStreamAccess({ userId: 'user-a', topicCount: 2 })
		);
		expect(() => acquireMarketStreamAccess({ userId: 'user-a', topicCount: 2 })).toThrow(
			MarketStreamAccessError
		);
		releases[0]();
		releases[0]();
		expect(() => acquireMarketStreamAccess({ userId: 'user-a', topicCount: 2 })).not.toThrow();
	});

	it('rate-limits connection churn within one minute', () => {
		const now = new Date('2026-08-01T12:00:00.000Z');
		for (let index = 0; index < 12; index += 1) {
			acquireMarketStreamAccess({ userId: 'user-a', topicCount: 1, now })();
		}
		expect(() => acquireMarketStreamAccess({ userId: 'user-a', topicCount: 1, now })).toThrow(
			MarketStreamAccessError
		);
		expect(() =>
			acquireMarketStreamAccess({
				userId: 'user-a',
				topicCount: 1,
				now: new Date(now.getTime() + 60_001)
			})
		).not.toThrow();
	});
});
