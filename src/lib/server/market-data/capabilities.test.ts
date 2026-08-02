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

	it('supports aggregate option execution on complete same-clock plans', () => {
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'advanced', optionsTier: 'advanced' })
			)
		).toBe(true);
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'starter', optionsTier: 'starter' })
			)
		).toBe(true);
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'starter', optionsTier: 'developer' })
			)
		).toBe(true);
	});

	it('requires options to share both the stock execution mode and delay', () => {
		expect(
			supportsOptionsExecution(
				resolveMassiveCapabilities({ stocksTier: 'starter', optionsTier: 'advanced' })
			)
		).toBe(false);

		const delayed = resolveMassiveCapabilities({
			stocksTier: 'starter',
			optionsTier: 'starter'
		});
		expect(
			supportsOptionsExecution({
				...delayed,
				options: { ...delayed.options, delayMinutes: 10 }
			})
		).toBe(false);
	});

	it('requires option aggregate entitlements but not quotes or trades', () => {
		const starter = resolveMassiveCapabilities({
			stocksTier: 'starter',
			optionsTier: 'starter'
		});
		expect(starter.options).toMatchObject({ quotes: false, trades: false });
		expect(supportsOptionsExecution(starter)).toBe(true);

		for (const field of ['snapshots', 'websocket', 'secondBars', 'minuteBars'] as const) {
			expect(
				supportsOptionsExecution({
					...starter,
					options: { ...starter.options, [field]: false }
				})
			).toBe(false);
		}

		expect(supportsOptionsExecution(resolveMassiveCapabilities({ stocksTier: 'starter' }))).toBe(
			false
		);
	});
});
