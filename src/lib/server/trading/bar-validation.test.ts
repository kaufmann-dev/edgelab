import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { normalizedBarSchema, type NormalizedBar } from '../market-data/types';
import {
	executableBarContextSchema,
	type ExecutableBarContext,
	validateExecutableBar
} from './bar-validation';

const delayedAttemptAt = new Date('2026-01-02T14:30:02.000Z');
const delayedEligibleAt = new Date('2026-01-02T14:30:00.250Z');

function barContext(overrides: Partial<ExecutableBarContext> = {}): ExecutableBarContext {
	return executableBarContextSchema.parse({
		attemptAt: delayedAttemptAt,
		expectedMode: 'delayed',
		expectedDelayMilliseconds: 15 * 60_000,
		maxTransportAgeMilliseconds: 60_000,
		maxSourceAgeMilliseconds: 60_000,
		futureToleranceMilliseconds: 1_000,
		...overrides
	});
}

function bar(overrides: Partial<NormalizedBar> = {}): NormalizedBar {
	const startTime = new Date('2026-01-02T14:15:01.000Z');
	const endTime = new Date('2026-01-02T14:15:02.000Z');
	return normalizedBarSchema.parse({
		kind: 'bar',
		assetClass: 'stocks',
		symbol: 'AAPL',
		mode: 'delayed',
		interval: 'second',
		startTime,
		endTime,
		open: new Decimal(100),
		high: new Decimal(102),
		low: new Decimal(99),
		close: new Decimal(101),
		volume: new Decimal(100),
		sourceTime: endTime,
		receivedAt: delayedAttemptAt,
		rawTimestamp: endTime.getTime().toString(),
		...overrides
	});
}

describe('executable aggregate validation', () => {
	it('accepts a fresh delayed second bar after wall-clock and logical eligibility', () => {
		const validation = validateExecutableBar(bar(), barContext(), delayedEligibleAt);

		expect(validation.executable).toBe(true);
		expect(validation.logicalAt).toEqual(new Date('2026-01-02T14:15:02.000Z'));
		expect(validation.logicalEligibleAt).toEqual(new Date('2026-01-02T14:15:00.250Z'));
		expect(validation.issues).toEqual([]);
	});

	it.each([
		{
			name: 'market-data mode mismatch',
			bar: bar({ mode: 'realtime' }),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'mode_mismatch'
		},
		{
			name: 'non-second interval',
			bar: bar({
				interval: 'minute',
				startTime: new Date('2026-01-02T14:14:02.000Z')
			}),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'interval_mismatch'
		},
		{
			name: 'source identity differs from the completed interval',
			bar: bar({ sourceTime: new Date('2026-01-02T14:15:01.999Z') }),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'interval_mismatch'
		},
		{
			name: 'receipt before wall-clock eligibility',
			bar: bar({ receivedAt: new Date(delayedEligibleAt.getTime() - 1) }),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'receipt_before_eligibility'
		},
		{
			name: 'source window before logical eligibility',
			bar: bar({
				startTime: new Date('2026-01-02T14:15:00.000Z'),
				endTime: new Date('2026-01-02T14:15:01.000Z'),
				sourceTime: new Date('2026-01-02T14:15:01.000Z')
			}),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'source_before_eligibility'
		},
		{
			name: 'wall-clock transport staleness',
			bar: bar({ receivedAt: new Date(delayedAttemptAt.getTime() - 60_001) }),
			context: barContext(),
			eligibleAt: new Date('2026-01-02T14:29:00.000Z'),
			code: 'transport_stale'
		},
		{
			name: 'receipt time beyond future tolerance',
			bar: bar({ receivedAt: new Date(delayedAttemptAt.getTime() + 1_001) }),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'receipt_in_future'
		},
		{
			name: 'logical source staleness',
			bar: bar({
				startTime: new Date('2026-01-02T14:14:00.999Z'),
				endTime: new Date('2026-01-02T14:14:01.999Z'),
				sourceTime: new Date('2026-01-02T14:14:01.999Z')
			}),
			context: barContext(),
			eligibleAt: new Date('2026-01-02T14:28:00.000Z'),
			code: 'source_stale'
		},
		{
			name: 'source time beyond logical future tolerance',
			bar: bar({
				startTime: new Date('2026-01-02T14:15:03.000Z'),
				endTime: new Date('2026-01-02T14:15:04.000Z'),
				sourceTime: new Date('2026-01-02T14:15:04.000Z')
			}),
			context: barContext(),
			eligibleAt: delayedEligibleAt,
			code: 'source_in_future'
		}
	])('rejects $name', ({ bar: aggregate, context: aggregateContext, eligibleAt, code }) => {
		const validation = validateExecutableBar(aggregate, aggregateContext, eligibleAt);

		expect(validation.executable).toBe(false);
		expect(validation.issues.map((issue) => issue.code)).toContain(code);
	});
});
