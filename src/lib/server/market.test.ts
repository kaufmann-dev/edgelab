import { describe, expect, it } from 'vitest';
import { getMarketEnvironment } from './market';

describe('market environment', () => {
	it('treats an omitted options plan as unavailable', () => {
		const environment = getMarketEnvironment({
			MASSIVE_API_KEY: 'test-key',
			MASSIVE_STOCKS_PLAN: 'starter'
		});

		expect(environment.optionsPlan).toBe('none');
		expect(environment.capabilities.options).toMatchObject({
			available: false,
			recency: 'unavailable',
			executionMode: null,
			websocket: false,
			snapshots: false,
			secondBars: false,
			minuteBars: false,
			trades: false,
			quotes: false,
			luld: false,
			label: 'UNAVAILABLE'
		});
	});

	it('derives the delayed aggregate capabilities included with Stocks Starter', () => {
		const environment = getMarketEnvironment({
			MASSIVE_API_KEY: 'test-key',
			MASSIVE_STOCKS_PLAN: 'starter'
		});

		expect(environment.capabilities.stocks).toMatchObject({
			available: true,
			recency: 'delayed',
			executionMode: 'delayed',
			delayMinutes: 15,
			websocket: true,
			snapshots: true,
			secondBars: true,
			minuteBars: true,
			trades: false,
			quotes: false
		});
	});

	it('derives independent stock and option capabilities', () => {
		const environment = getMarketEnvironment({
			MASSIVE_API_KEY: 'test-key',
			MASSIVE_STOCKS_PLAN: 'advanced',
			MASSIVE_OPTIONS_PLAN: 'starter'
		});

		expect(environment.capabilities.stocks.executionMode).toBe('realtime');
		expect(environment.capabilities.stocks.quotes).toBe(true);
		expect(environment.capabilities.options.executionMode).toBe('delayed');
		expect(environment.capabilities.options.quotes).toBe(false);
	});

	it('still requires an explicit stocks plan', () => {
		expect(() => getMarketEnvironment({ MASSIVE_API_KEY: 'test-key' })).toThrow(
			'MASSIVE_STOCKS_PLAN is not set'
		);
	});
});
