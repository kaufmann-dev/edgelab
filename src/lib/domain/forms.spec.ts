import { describe, expect, it } from 'vitest';
import { createPortfolioSchema, stockOrderSchema } from './forms';

describe('createPortfolioSchema', () => {
	it('normalizes a valid portfolio and preserves intentional defaults', () => {
		expect.assertions(7);
		const parsed = createPortfolioSchema.parse({
			name: '  First run  ',
			startingCapital: '25000',
			benchmarkSymbol: 'spy',
			accountType: 'cash',
			acknowledgeSimulation: true
		});

		expect(parsed.name).toBe('First run');
		expect(parsed.startingCapital).toBe(25_000);
		expect(parsed.benchmarkSymbol).toBe('SPY');
		expect(parsed.riskBehavior).toBe('block');
		expect(parsed.dataMode).toBe('delayed');
		expect(parsed.allowLongOptions).toBe(false);
		expect('allowCoveredOptions' in parsed).toBe(false);
	});

	it('rejects short selling in a cash portfolio', () => {
		expect.assertions(1);
		const parsed = createPortfolioSchema.safeParse({
			name: 'Cash run',
			startingCapital: 10_000,
			benchmarkSymbol: 'SPY',
			accountType: 'cash',
			dataMode: 'realtime',
			allowShortEquity: true,
			acknowledgeSimulation: true
		});

		expect(parsed.error?.flatten().fieldErrors.allowShortEquity).toContain(
			'Short selling requires a margin portfolio'
		);
	});

	it('accepts only the canonical executable market-data modes', () => {
		expect.assertions(4);
		const portfolio = {
			name: 'Market data modes',
			startingCapital: 10_000,
			benchmarkSymbol: 'SPY',
			accountType: 'cash',
			acknowledgeSimulation: true
		};

		expect(createPortfolioSchema.safeParse({ ...portfolio, dataMode: 'realtime' }).success).toBe(
			true
		);
		expect(createPortfolioSchema.safeParse({ ...portfolio, dataMode: 'delayed' }).success).toBe(
			true
		);
		expect(createPortfolioSchema.safeParse({ ...portfolio, dataMode: 'real_time' }).success).toBe(
			false
		);
		expect(createPortfolioSchema.safeParse({ ...portfolio, dataMode: 'end_of_day' }).success).toBe(
			false
		);
	});
});

describe('stockOrderSchema', () => {
	it('requires prices only for the applicable order type', () => {
		expect.assertions(3);
		const base = {
			clientOrderId: 'd37828cb-09f2-42eb-959e-38d441dcb90f',
			symbol: 'aapl',
			side: 'buy',
			positionEffect: 'open',
			quantity: '5',
			timeInForce: 'day',
			session: 'regular'
		};

		expect(stockOrderSchema.safeParse({ ...base, orderType: 'market' }).success).toBe(true);
		expect(stockOrderSchema.safeParse({ ...base, orderType: 'limit' }).success).toBe(false);
		expect(
			stockOrderSchema.safeParse({ ...base, orderType: 'limit', limitPrice: '198.50' }).success
		).toBe(true);
	});
});
