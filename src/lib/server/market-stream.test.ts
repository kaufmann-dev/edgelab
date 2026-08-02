import { describe, expect, it } from 'vitest';
import { buildMarketTopics } from './market-stream';

describe('market stream topics', () => {
	it('normalizes and deduplicates stock topics', () => {
		expect(
			buildMarketTopics({
				assetClass: 'stocks',
				symbols: ['aapl', 'AAPL'],
				events: ['Q', 'T']
			})
		).toEqual(['Q.AAPL', 'T.AAPL']);
	});

	it('requires option contract symbols', () => {
		expect(() =>
			buildMarketTopics({ assetClass: 'options', symbols: ['AAPL'], events: ['AM'] })
		).toThrow('Option streams require O: contract symbols');
	});

	it('rejects stock-only LULD events for options', () => {
		expect(() =>
			buildMarketTopics({
				assetClass: 'options',
				symbols: ['O:AAPL260918C00200000'],
				events: ['LULD']
			})
		).toThrow('LULD streams are available only for stocks');
	});
});
