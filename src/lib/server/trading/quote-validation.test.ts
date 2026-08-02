import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { normalizedQuoteSchema, type NormalizedQuote } from '../market-data/types';
import {
	executableQuoteContextSchema,
	type ExecutableQuoteContext,
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
