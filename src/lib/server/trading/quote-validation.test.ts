import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
	normalizedBarSchema,
	normalizedQuoteSchema,
	type NormalizedBar,
	type NormalizedQuote
} from '../market-data/types';
import {
	executableBarContextSchema,
	executableQuoteContextSchema,
	type ExecutableBarContext,
	type ExecutableQuoteContext,
	validateExecutableBar,
	validateExecutableQuotes
} from './quote-validation';

const attemptAt = new Date('2026-01-02T14:30:00.000Z');

function context(overrides: Partial<ExecutableQuoteContext> = {}): ExecutableQuoteContext {
	return executableQuoteContextSchema.parse({
		attemptAt,
		expectedMode: 'realtime',
		expectedDelayMilliseconds: 0,
		maxTransportAgeMilliseconds: 60_000,
		maxSourceAgeMilliseconds: 60_000,
		futureToleranceMilliseconds: 1_000,
		maxSourceSkewMilliseconds: 500,
		maxReceiptSkewMilliseconds: 500,
		...overrides
	});
}

function quote(symbol: string, overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
	return normalizedQuoteSchema.parse({
		kind: 'quote',
		assetClass: 'stocks',
		symbol,
		mode: 'realtime',
		bidPrice: new Decimal(99),
		askPrice: new Decimal(100),
		bidSize: new Decimal(10),
		askSize: new Decimal(10),
		sourceTime: attemptAt,
		receivedAt: attemptAt,
		rawTimestamp: attemptAt.getTime().toString(),
		...overrides
	});
}

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

describe('executable quote validation', () => {
	it('accepts fresh realtime quotes and computes the realtime logical time', () => {
		const validation = validateExecutableQuotes([quote('AAPL')], context());

		expect(validation.executable).toBe(true);
		expect(validation.logicalAt).toEqual(attemptAt);
		expect(validation.issues).toEqual([]);
	});

	it('evaluates delayed source freshness against delayed logical market time', () => {
		const delayedSourceTime = new Date('2026-01-02T14:15:00.000Z');
		const validation = validateExecutableQuotes(
			[quote('AAPL', { mode: 'delayed', sourceTime: delayedSourceTime })],
			context({ expectedMode: 'delayed', expectedDelayMilliseconds: 15 * 60_000 })
		);

		expect(validation.executable).toBe(true);
		expect(validation.logicalAt).toEqual(delayedSourceTime);
	});

	it.each([
		{
			name: 'wall-clock transport staleness',
			quote: quote('AAPL', { receivedAt: new Date(attemptAt.getTime() - 60_001) }),
			context: context(),
			code: 'transport_stale'
		},
		{
			name: 'logical source staleness',
			quote: quote('AAPL', { sourceTime: new Date(attemptAt.getTime() - 60_001) }),
			context: context(),
			code: 'source_stale'
		},
		{
			name: 'receipt time beyond future tolerance',
			quote: quote('AAPL', { receivedAt: new Date(attemptAt.getTime() + 1_001) }),
			context: context(),
			code: 'receipt_in_future'
		},
		{
			name: 'source time beyond logical future tolerance',
			quote: quote('AAPL', { sourceTime: new Date(attemptAt.getTime() + 1_001) }),
			context: context(),
			code: 'source_in_future'
		},
		{
			name: 'market-data mode mismatch',
			quote: quote('AAPL', { mode: 'delayed' }),
			context: context(),
			code: 'mode_mismatch'
		},
		{
			name: 'zero NBBO price',
			quote: quote('AAPL', { bidPrice: new Decimal(0) }),
			context: context(),
			code: 'invalid_nbbo'
		},
		{
			name: 'crossed NBBO',
			quote: quote('AAPL', { bidPrice: new Decimal(101) }),
			context: context(),
			code: 'invalid_nbbo'
		}
	])('rejects $name', ({ quote: marketQuote, context: quoteContext, code }) => {
		const validation = validateExecutableQuotes([marketQuote], quoteContext);

		expect(validation.executable).toBe(false);
		expect(validation.issues.map((issue) => issue.code)).toContain(code);
	});

	it('rejects excessive source-time skew across strategy legs', () => {
		const validation = validateExecutableQuotes(
			[quote('AAPL'), quote('MSFT', { sourceTime: new Date(attemptAt.getTime() - 501) })],
			context()
		);

		expect(validation.issues.map((issue) => issue.code)).toContain('source_skew');
	});

	it('rejects excessive receipt-time skew across strategy legs', () => {
		const validation = validateExecutableQuotes(
			[quote('AAPL'), quote('MSFT', { receivedAt: new Date(attemptAt.getTime() - 501) })],
			context()
		);

		expect(validation.issues.map((issue) => issue.code)).toContain('receipt_skew');
	});
});

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
