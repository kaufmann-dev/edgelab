import { describe, expect, it } from 'vitest';
import {
	normalizedQuoteSchema,
	normalizedTradeSchema,
	optionInstrumentSchema,
	optionSnapshotSchema
} from '#lib/server/market-data/index.js';
import { serializeOptionSnapshot } from './market-view';

const at = new Date('2026-08-03T15:15:00.000Z');
const symbol = 'O:AAPL260918C00200000';

function optionSnapshot() {
	return optionSnapshotSchema.parse({
		instrument: optionInstrumentSchema.parse({
			assetClass: 'options',
			symbol,
			name: 'AAPL Sep 2026 200 Call',
			currency: 'USD',
			active: true,
			underlyingSymbol: 'AAPL',
			optionType: 'call',
			exerciseStyle: 'american',
			expirationDate: '2026-09-18',
			strikePrice: '200',
			multiplier: '100',
			additionalUnderlyings: []
		}),
		mode: 'delayed',
		quote: normalizedQuoteSchema.parse({
			kind: 'quote',
			assetClass: 'options',
			symbol,
			mode: 'delayed',
			bidPrice: '2.40',
			askPrice: '2.60',
			bidSize: '10',
			askSize: '12',
			sourceTime: at,
			receivedAt: at,
			rawTimestamp: at.getTime().toString()
		}),
		lastTrade: normalizedTradeSchema.parse({
			kind: 'trade',
			assetClass: 'options',
			symbol,
			mode: 'delayed',
			price: '2.50',
			size: '1',
			conditions: [],
			sourceTime: at,
			receivedAt: at,
			rawTimestamp: at.getTime().toString()
		}),
		openInterest: '150',
		asOf: at
	});
}

describe('option snapshot serialization', () => {
	it('omits quote and trade fields without their explicit entitlements', () => {
		const serialized = serializeOptionSnapshot(optionSnapshot(), {
			quotes: false,
			trades: false
		});

		expect(serialized.quote).toBeUndefined();
		expect(serialized.lastTrade).toBeUndefined();
		expect(serialized.openInterest).toBe('150');
	});

	it('includes quote and trade fields when both are entitled', () => {
		const serialized = serializeOptionSnapshot(optionSnapshot(), {
			quotes: true,
			trades: true
		});

		expect(serialized.quote?.bidPrice).toBe('2.4');
		expect(serialized.lastTrade?.price).toBe('2.5');
	});
});
