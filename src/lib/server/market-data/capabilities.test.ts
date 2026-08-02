import { describe, expect, it } from 'vitest';
import {
	capabilitiesForPlan,
	resolveMassiveCapabilities,
	supportsOptionsExecution,
	supportsStockSimulation
} from './capabilities';

describe('Massive plan capabilities', () => {
	it('does not treat Basic or an unavailable plan as an executable stock feed', () => {
		const basic = capabilitiesForPlan('stocks', 'basic');
		const unavailable = capabilitiesForPlan('stocks', 'none');

		expect(supportsStockSimulation(basic)).toBe(false);
		expect(basic).toMatchObject({
			recency: 'end_of_day',
			executionMode: null,
			label: 'END OF DAY',
			delayMinutes: null
		});
		expect(supportsStockSimulation(unavailable)).toBe(false);
		expect(unavailable).toMatchObject({
			recency: 'unavailable',
			executionMode: null,
			label: 'UNAVAILABLE',
			delayMinutes: null
		});
	});

	it('supports a delayed stock simulation with Stocks Starter', () => {
		const capabilities = resolveMassiveCapabilities({ stocksTier: 'starter' });

		expect(supportsStockSimulation(capabilities.stocks)).toBe(true);
		expect(capabilities.stocks.executionMode).toBe('delayed');
		expect(capabilities.stocks.luld).toBe(false);
	});

	it('requires a complete same-clock options feed for options execution', () => {
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'advanced', optionsTier: 'advanced' })
			)
		).toBe(true);
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'starter', optionsTier: 'advanced' })
			)
		).toBe(false);
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'starter', optionsTier: 'starter' })
			)
		).toBe(false);
		expect(supportsOptionsExecution(resolveMassiveCapabilities({ stocksTier: 'starter' }))).toBe(
			false
		);
	});
});
