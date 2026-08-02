import { describe, expect, it } from 'vitest';
import {
	normalizeMassiveAggregateBar,
	normalizeMassiveOptionContract,
	normalizeMassiveTimestamp,
	normalizeMassiveWebSocketFrame
} from './normalize';

describe('Massive market-data normalization', () => {
	it('normalizes second, millisecond, microsecond, and nanosecond epochs', () => {
		const expected = '2023-11-14T22:13:20.000Z';

		expect(normalizeMassiveTimestamp(1_700_000_000).toISOString()).toBe(expected);
		expect(normalizeMassiveTimestamp(1_700_000_000_000).toISOString()).toBe(expected);
		expect(normalizeMassiveTimestamp(1_700_000_000_000_000n).toISOString()).toBe(expected);
		expect(normalizeMassiveTimestamp(1_700_000_000_000_000_000n).toISOString()).toBe(expected);
	});

	it('normalizes a mixed WebSocket frame without floating-point prices', () => {
		const receivedAt = new Date('2026-01-02T15:30:00.100Z');
		const events = normalizeMassiveWebSocketFrame(
			JSON.stringify([
				{ ev: 'status', status: 'success', message: 'connected' },
				{
					ev: 'Q',
					sym: 'AAPL',
					bp: '199.10',
					ap: '199.12',
					bs: 4,
					as: 7,
					t: 1_700_000_000_000_000_000n.toString(),
					q: 42
				},
				{
					ev: 'T',
					sym: 'AAPL',
					p: '199.115',
					s: 3,
					t: 1_700_000_000_001
				}
			]),
			{ assetClass: 'stocks', mode: 'realtime', receivedAt }
		);

		expect(events).toHaveLength(2);
		expect(events[0]?.kind).toBe('quote');
		if (events[0]?.kind !== 'quote') throw new Error('Expected a quote');
		expect(events[0].bidPrice.toFixed(2)).toBe('199.10');
		expect(events[0].askPrice.toFixed(2)).toBe('199.12');
		expect(events[0].sequence).toBe('42');
		expect(events[0].receivedAt).toEqual(receivedAt);
		expect(events[1]?.sourceTime.toISOString()).toBe('2023-11-14T22:13:20.001Z');
	});

	it('preserves option deliverables and contract multipliers', () => {
		const instrument = normalizeMassiveOptionContract({
			ticker: 'O:AAPL260116C00200000',
			underlying_ticker: 'AAPL',
			contract_type: 'call',
			exercise_style: 'american',
			expiration_date: '2026-01-16',
			strike_price: '200',
			shares_per_contract: '150',
			additional_underlyings: [{ type: 'cash', underlying: 'USD', amount: '12.50' }]
		});

		expect(instrument.multiplier.toFixed()).toBe('150');
		expect(instrument.additionalUnderlyings[0]?.amount.toFixed(2)).toBe('12.50');
	});

	it('uses fractional stock volume and the completed interval as bar provenance', () => {
		const receivedAt = new Date('2026-01-02T15:45:02.000Z');
		const [event] = normalizeMassiveWebSocketFrame(
			[
				{
					ev: 'A',
					sym: 'AAPL',
					o: '200',
					h: '201',
					l: '199',
					c: '200.5',
					v: 12,
					dv: '12.75',
					s: Date.parse('2026-01-02T15:30:01.000Z'),
					e: Date.parse('2026-01-02T15:30:02.000Z')
				}
			],
			{ assetClass: 'stocks', mode: 'delayed', receivedAt }
		);

		expect(event?.kind).toBe('bar');
		if (event?.kind !== 'bar') throw new Error('Expected a bar');
		expect(event.volume.toFixed(2)).toBe('12.75');
		expect(event.sourceTime).toEqual(event.endTime);
		expect(event.receivedAt).toEqual(receivedAt);
	});

	it('normalizes a delayed option second aggregate with contract-volume provenance', () => {
		const receivedAt = new Date('2026-01-02T15:45:02.000Z');
		const [event] = normalizeMassiveWebSocketFrame(
			[
				{
					ev: 'A',
					sym: 'O:AAPL260116C00200000',
					o: '4.10',
					h: '4.20',
					l: '4.05',
					c: '4.15',
					v: 7,
					s: Date.parse('2026-01-02T15:30:01.000Z'),
					e: Date.parse('2026-01-02T15:30:02.000Z')
				}
			],
			{ assetClass: 'options', mode: 'delayed', receivedAt }
		);

		expect(event?.kind).toBe('bar');
		if (event?.kind !== 'bar') throw new Error('Expected an option bar');
		expect(event).toMatchObject({
			assetClass: 'options',
			symbol: 'O:AAPL260116C00200000',
			mode: 'delayed',
			interval: 'second'
		});
		expect(event.volume.toFixed()).toBe('7');
		expect(event.sourceTime).toEqual(event.endTime);
		expect(event.receivedAt).toEqual(receivedAt);
	});

	it('uses the requested multiplier and interval for aggregate bar end times', () => {
		const bar = normalizeMassiveAggregateBar(
			{ o: 100, h: 103, l: 99, c: 102, v: 20, t: Date.UTC(2026, 0, 1) },
			{
				assetClass: 'stocks',
				symbol: 'AAPL',
				mode: 'delayed',
				interval: 'month',
				multiplier: 2,
				receivedAt: new Date('2026-03-01T00:00:00Z')
			}
		);

		expect(bar.interval).toBe('month');
		expect(bar.startTime.toISOString()).toBe('2026-01-01T00:00:00.000Z');
		expect(bar.endTime.toISOString()).toBe('2026-03-01T00:00:00.000Z');
		expect(bar.sourceTime).toEqual(bar.endTime);
	});
});
