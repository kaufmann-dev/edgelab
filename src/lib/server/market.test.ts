import { describe, expect, it } from 'vitest';
import { getMarketEnvironment } from './market';

describe('market environment', () => {
	it('requires declared plan tiers so freshness is never guessed', () => {
		expect(() =>
			getMarketEnvironment({
				MASSIVE_API_KEY: 'test-key',
				MASSIVE_STOCKS_PLAN: 'advanced'
			})
		).toThrow('MASSIVE_OPTIONS_PLAN is not set');
	});

	it('derives independent stock and option capabilities', () => {
		const environment = getMarketEnvironment({
			MASSIVE_API_KEY: 'test-key',
			MASSIVE_STOCKS_PLAN: 'advanced',
			MASSIVE_OPTIONS_PLAN: 'starter'
		});

		expect(environment.capabilities.stocks.mode).toBe('realtime');
		expect(environment.capabilities.stocks.quotes).toBe(true);
		expect(environment.capabilities.options.mode).toBe('delayed');
		expect(environment.capabilities.options.quotes).toBe(false);
	});
});
