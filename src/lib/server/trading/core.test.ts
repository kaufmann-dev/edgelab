import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
	normalizedQuoteSchema,
	optionInstrumentSchema,
	stockInstrumentSchema,
	type Instrument,
	type OptionInstrument,
	type StockInstrument
} from '../market-data/types';
import { calculateQuoteFill } from './execution';
import { applyFillToLedger, assertCashLedgerInvariant, LedgerInvariantError } from './ledger';
import {
	acceptedOrderMatchesDraft,
	applyStrategyFill,
	createAcceptedOrder,
	markOrderTriggered,
	OrderTransitionError,
	transitionOrder
} from './orders';
import { previewOrder } from './risk';
import { executableQuoteContextSchema, type ExecutableQuoteContext } from './quote-validation';
import {
	executionModelSchema,
	orderDraftSchema,
	riskPolicySchema,
	type AcceptedOrder,
	type OrderDraft,
	type PortfolioAccountState,
	type Position,
	type StrategyFill
} from './types';

const portfolioId = '00000000-0000-4000-8000-000000000001';
const orderId = '00000000-0000-4000-8000-000000000002';
const acceptedAt = new Date('2026-01-02T14:30:00.000Z');

function stock(symbol = 'AAPL'): StockInstrument {
	return stockInstrumentSchema.parse({
		assetClass: 'stocks',
		symbol,
		name: symbol,
		currency: 'USD',
		active: true,
		roundLot: 1
	});
}

function option(input: {
	symbol: string;
	type: 'call' | 'put';
	strike: string;
	multiplier?: string;
	underlyingSymbol?: string;
	currency?: string;
}): OptionInstrument {
	return optionInstrumentSchema.parse({
		assetClass: 'options',
		symbol: input.symbol,
		name: input.symbol,
		currency: input.currency ?? 'USD',
		active: true,
		underlyingSymbol: input.underlyingSymbol ?? 'AAPL',
		optionType: input.type,
		exerciseStyle: 'american',
		expirationDate: '2026-06-19',
		strikePrice: input.strike,
		multiplier: input.multiplier ?? '100',
		additionalUnderlyings: []
	});
}

function quote(
	symbol: string,
	input: {
		bid: string;
		ask: string;
		bidSize?: string;
		askSize?: string;
		mode?: 'realtime' | 'delayed';
		sourceTime?: Date;
		receivedAt?: Date;
	}
) {
	return normalizedQuoteSchema.parse({
		kind: 'quote',
		assetClass: symbol.startsWith('O:') ? 'options' : 'stocks',
		symbol,
		mode: input.mode ?? 'realtime',
		bidPrice: input.bid,
		askPrice: input.ask,
		bidSize: input.bidSize ?? '1000',
		askSize: input.askSize ?? '1000',
		sourceTime: input.sourceTime ?? acceptedAt,
		receivedAt: input.receivedAt ?? acceptedAt,
		rawTimestamp: acceptedAt.getTime().toString()
	});
}

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
	return orderDraftSchema.parse({
		portfolioId,
		clientOrderId: '00000000-0000-4000-8000-000000000003',
		type: 'limit',
		timeInForce: 'day',
		quantity: '1',
		limitPrice: '200',
		netPriceEffect: 'debit',
		extendedHours: false,
		legs: [{ symbol: 'AAPL', side: 'buy', positionEffect: 'open', ratioQuantity: '1' }],
		...overrides
	});
}

function acceptedOrder(orderDraft: OrderDraft, instruments: Instrument[]): AcceptedOrder {
	return createAcceptedOrder({
		id: orderId,
		draft: orderDraft,
		instruments: new Map(instruments.map((instrument) => [instrument.symbol, instrument])),
		acceptedAt,
		latencyMilliseconds: 250
	});
}

function account(overrides: Partial<PortfolioAccountState> = {}): PortfolioAccountState {
	return {
		portfolioId,
		cashBalance: new Decimal(100_000),
		reservedCash: new Decimal(0),
		positions: new Map<string, Position>(),
		reservedPositionQuantities: new Map<string, Decimal>(),
		openOrderCount: 0,
		riskPolicy: riskPolicySchema.parse({}),
		...overrides
	};
}

const previewExecutionModel = executionModelSchema.parse({});

function quoteContext(overrides: Partial<ExecutableQuoteContext> = {}): ExecutableQuoteContext {
	return executableQuoteContextSchema.parse({
		attemptAt: acceptedAt,
		expectedMode: 'realtime',
		expectedDelayMilliseconds: 0,
		maxTransportAgeMilliseconds: 60_000,
		maxSourceAgeMilliseconds: 60_000,
		futureToleranceMilliseconds: 1_000,
		maxSourceSkewMilliseconds: 1_000,
		maxReceiptSkewMilliseconds: 1_000,
		...overrides
	});
}

type PreviewInput = Parameters<typeof previewOrder>[0];

function preview(
	input: Omit<PreviewInput, 'executionModel' | 'quoteContext'> &
		Partial<Pick<PreviewInput, 'executionModel' | 'quoteContext'>>
) {
	const {
		executionModel = previewExecutionModel,
		quoteContext: context = quoteContext(),
		...previewInput
	} = input;
	return previewOrder({ ...previewInput, executionModel, quoteContext: context });
}

describe('paper-order state machine', () => {
	it('applies partial and complete fills with one-way transitions', () => {
		const order = acceptedOrder(draft({ quantity: new Decimal(3) }), [stock()]);
		const partial = applyStrategyFill(order, new Decimal(1), new Date('2026-01-02T14:31:00Z'));
		const filled = applyStrategyFill(partial, new Decimal(2), new Date('2026-01-02T14:32:00Z'));

		expect(partial.status).toBe('partially_filled');
		expect(partial.filledQuantity.toFixed()).toBe('1');
		expect(filled.status).toBe('filled');
		expect(filled.terminalAt?.toISOString()).toBe('2026-01-02T14:32:00.000Z');
		expect(() => transitionOrder(filled, 'canceled', { at: new Date() })).toThrow(
			OrderTransitionError
		);
	});

	it('rejects overfills, limits strategies to four legs, and triggers idempotently', () => {
		const order = acceptedOrder(draft(), [stock()]);
		const triggered = markOrderTriggered(order, new Date('2026-01-02T14:31:00Z'));

		expect(markOrderTriggered(triggered, new Date('2026-01-02T14:32:00Z'))).toBe(triggered);
		expect(() => applyStrategyFill(order, new Decimal(2), new Date())).toThrow(
			OrderTransitionError
		);
		expect(
			orderDraftSchema.safeParse({
				...draft(),
				legs: Array.from({ length: 5 }, (_, index) => ({
					symbol: `TEST${index}`,
					side: 'buy',
					positionEffect: 'open',
					ratioQuantity: 1
				}))
			}).success
		).toBe(false);
	});

	it('treats a client order ID as idempotent only for the exact canonical draft', () => {
		const originalDraft = draft({ quantity: new Decimal(3) });
		const order = acceptedOrder(originalDraft, [stock()]);

		expect(acceptedOrderMatchesDraft(order, originalDraft)).toBe(true);
		expect(
			acceptedOrderMatchesDraft(
				order,
				draft({ clientOrderId: originalDraft.clientOrderId, quantity: new Decimal(4) })
			)
		).toBe(false);
		expect(
			acceptedOrderMatchesDraft(
				order,
				draft({
					clientOrderId: originalDraft.clientOrderId,
					legs: [
						{
							symbol: 'AAPL',
							side: 'sell',
							positionEffect: 'close',
							ratioQuantity: new Decimal(1)
						}
					]
				})
			)
		).toBe(false);
	});

	it('limits IOC orders to immediately executable order types', () => {
		expect(
			orderDraftSchema.safeParse({
				...draft(),
				type: 'stop',
				timeInForce: 'ioc',
				limitPrice: undefined,
				stopPrice: new Decimal(190)
			}).success
		).toBe(false);
	});

	it('rejects price fields that do not belong to the selected order type', () => {
		expect(
			orderDraftSchema.safeParse({
				...draft(),
				type: 'market',
				limitPrice: new Decimal(190)
			}).success
		).toBe(false);
		expect(
			orderDraftSchema.safeParse({
				...draft(),
				type: 'limit',
				stopPrice: new Decimal(180)
			}).success
		).toBe(false);
	});

	it('rejects zero order values and zero participation', () => {
		expect(orderDraftSchema.safeParse({ ...draft(), quantity: new Decimal(0) }).success).toBe(
			false
		);
		expect(executionModelSchema.safeParse({ participationRate: new Decimal(0) }).success).toBe(
			false
		);
	});
});

describe('order preview and collateral', () => {
	it('uses the option multiplier and fees when checking available cash', () => {
		const contract = option({ symbol: 'O:AAPL260619C00200000', type: 'call', strike: '200' });
		const order = draft({
			quantity: new Decimal(2),
			limitPrice: new Decimal('2.50'),
			legs: [
				{
					symbol: contract.symbol,
					side: 'buy',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				}
			]
		});
		const previewResult = preview({
			draft: order,
			instruments: new Map([[contract.symbol, contract]]),
			quotes: new Map(),
			account: account({ cashBalance: new Decimal(500) }),
			feeModel: {
				optionPerContract: new Decimal('0.65'),
				stockPerShare: new Decimal(0),
				minimumPerOrder: new Decimal(0)
			}
		});

		expect(previewResult.orderNotional.toFixed(2)).toBe('500.00');
		expect(previewResult.cashRequired.toFixed(2)).toBe('501.30');
		expect(previewResult.accepted).toBe(false);
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'insufficient_cash'
		);
	});

	it('accepts a covered call and rejects the same uncovered call', () => {
		const contract = option({ symbol: 'O:AAPL260619C00200000', type: 'call', strike: '200' });
		const order = draft({
			limitPrice: new Decimal(5),
			netPriceEffect: 'credit',
			legs: [
				{
					symbol: contract.symbol,
					side: 'sell',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				}
			]
		});
		const equity = stock();
		const coveredPosition: Position = {
			instrument: equity,
			quantity: new Decimal(100),
			averageCost: new Decimal(150),
			realizedPnl: new Decimal(0)
		};
		const inputs = {
			draft: order,
			instruments: new Map([[contract.symbol, contract]]),
			quotes: new Map()
		};

		const covered = preview({
			...inputs,
			account: account({ positions: new Map([[equity.symbol, coveredPosition]]) })
		});
		const uncovered = preview({ ...inputs, account: account() });

		expect(covered.accepted).toBe(true);
		expect(covered.shareCollateral.get('AAPL')?.toFixed()).toBe('100');
		expect(uncovered.accepted).toBe(false);
		expect(uncovered.violations.map((violation) => violation.code)).toContain('uncovered_option');
	});

	it('emits a close-position reservation and blocks a second close against it', () => {
		const equity = stock();
		const heldPosition: Position = {
			instrument: equity,
			quantity: new Decimal(100),
			averageCost: new Decimal(150),
			realizedPnl: new Decimal(0)
		};
		const closeOrder = draft({
			quantity: new Decimal(60),
			limitPrice: new Decimal(200),
			legs: [
				{
					symbol: equity.symbol,
					side: 'sell',
					positionEffect: 'close',
					ratioQuantity: new Decimal(1)
				}
			]
		});
		const previewInput = {
			draft: closeOrder,
			instruments: new Map([[equity.symbol, equity]]),
			quotes: new Map()
		};
		const first = preview({
			...previewInput,
			account: account({ positions: new Map([[equity.symbol, heldPosition]]) })
		});
		const second = preview({
			...previewInput,
			account: account({
				positions: new Map([[equity.symbol, heldPosition]]),
				reservedPositionQuantities: new Map([[equity.symbol, new Decimal(60)]])
			})
		});

		expect(first.accepted).toBe(true);
		expect(first.shareCollateral.get(equity.symbol)?.toFixed()).toBe('60');
		expect(second.accepted).toBe(false);
		expect(second.violations.map((violation) => violation.code)).toContain('insufficient_position');
	});

	it('reserves a market buy using the execution model slippage', () => {
		const equity = stock();
		const marketOrder = draft({ type: 'market', limitPrice: undefined });
		const previewResult = preview({
			draft: marketOrder,
			instruments: new Map([[equity.symbol, equity]]),
			quotes: new Map([[equity.symbol, quote(equity.symbol, { bid: '99', ask: '100' })]]),
			account: account({ cashBalance: new Decimal('100.05') }),
			executionModel: executionModelSchema.parse({ stockSlippageBps: '10' })
		});

		expect(previewResult.legs[0]?.referencePrice.toFixed(2)).toBe('100.10');
		expect(previewResult.estimatedNetCashChange.toFixed(2)).toBe('-100.10');
		expect(previewResult.cashRequired.toFixed(2)).toBe('100.10');
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'insufficient_cash'
		);
	});

	it.each([
		{
			name: 'mixed stock and option legs',
			instruments: [
				stock(),
				option({ symbol: 'O:AAPL260619C00200000', type: 'call', strike: '200' })
			] satisfies Instrument[]
		},
		{
			name: 'different option underlyings',
			instruments: [
				option({ symbol: 'O:AAPL260619C00100000', type: 'call', strike: '100' }),
				option({
					symbol: 'O:MSFT260619C00100000',
					type: 'call',
					strike: '100',
					underlyingSymbol: 'MSFT'
				})
			] satisfies Instrument[]
		},
		{
			name: 'different option currencies',
			instruments: [
				option({ symbol: 'O:AAPL260619C00110000', type: 'call', strike: '110' }),
				option({
					symbol: 'O:AAPL260619C00115000',
					type: 'call',
					strike: '115',
					currency: 'CAD'
				})
			] satisfies Instrument[]
		},
		{
			name: 'different option multipliers',
			instruments: [
				option({ symbol: 'O:AAPL260619P00090000', type: 'put', strike: '90' }),
				option({
					symbol: 'O:AAPL260619P00085000',
					type: 'put',
					strike: '85',
					multiplier: '10'
				})
			] satisfies Instrument[]
		}
	])('rejects multi-leg strategies with $name', ({ instruments }) => {
		const strategy = draft({
			limitPrice: new Decimal(3),
			legs: instruments.map((instrument) => ({
				symbol: instrument.symbol,
				side: 'buy' as const,
				positionEffect: 'open' as const,
				ratioQuantity: new Decimal(1)
			}))
		});
		const previewResult = preview({
			draft: strategy,
			instruments: new Map(instruments.map((instrument) => [instrument.symbol, instrument])),
			quotes: new Map(
				instruments.map((instrument) => [
					instrument.symbol,
					quote(instrument.symbol, { bid: '1', ask: '1.10' })
				])
			),
			account: account()
		});

		expect(previewResult.accepted).toBe(false);
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'unsupported_multi_leg_strategy'
		);
	});

	it('reserves a multi-leg debit at the worst permitted limit plus fees', () => {
		const firstCall = option({ symbol: 'O:AAPL260619C00120000', type: 'call', strike: '120' });
		const secondCall = option({ symbol: 'O:AAPL260619C00125000', type: 'call', strike: '125' });
		const order = draft({
			quantity: new Decimal(2),
			limitPrice: new Decimal(3),
			netPriceEffect: 'debit',
			legs: [
				{
					symbol: firstCall.symbol,
					side: 'buy',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				},
				{
					symbol: secondCall.symbol,
					side: 'buy',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				}
			]
		});
		const previewResult = preview({
			draft: order,
			instruments: new Map([
				[firstCall.symbol, firstCall],
				[secondCall.symbol, secondCall]
			]),
			quotes: new Map([
				[firstCall.symbol, quote(firstCall.symbol, { bid: '0.90', ask: '1' })],
				[secondCall.symbol, quote(secondCall.symbol, { bid: '0.90', ask: '1' })]
			]),
			account: account(),
			feeModel: {
				optionPerContract: new Decimal('0.65'),
				stockPerShare: new Decimal(0),
				minimumPerOrder: new Decimal(0)
			}
		});

		expect(previewResult.estimatedNetCashChange.toFixed(2)).toBe('-402.60');
		expect(previewResult.cashRequired.toFixed(2)).toBe('602.60');
		expect(previewResult.accepted).toBe(true);
	});

	it('reserves max loss less net credit for a defined-risk vertical', () => {
		const shortCall = option({ symbol: 'O:AAPL260619C00100000', type: 'call', strike: '100' });
		const longCall = option({ symbol: 'O:AAPL260619C00105000', type: 'call', strike: '105' });
		const order = draft({
			limitPrice: new Decimal(1),
			netPriceEffect: 'credit',
			legs: [
				{
					symbol: shortCall.symbol,
					side: 'sell',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				},
				{
					symbol: longCall.symbol,
					side: 'buy',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				}
			]
		});
		const previewResult = preview({
			draft: order,
			instruments: new Map([
				[shortCall.symbol, shortCall],
				[longCall.symbol, longCall]
			]),
			quotes: new Map([
				[shortCall.symbol, quote(shortCall.symbol, { bid: '5', ask: '5.10' })],
				[longCall.symbol, quote(longCall.symbol, { bid: '1.90', ask: '2' })]
			]),
			account: account(),
			feeModel: {
				optionPerContract: new Decimal('0.65'),
				stockPerShare: new Decimal(0),
				minimumPerOrder: new Decimal(0)
			}
		});

		expect(previewResult.estimatedNetCashChange.toFixed(2)).toBe('298.70');
		expect(previewResult.optionCollateral.toFixed(2)).toBe('401.30');
		expect(previewResult.cashRequired.toFixed(2)).toBe('401.30');
		expect(previewResult.accepted).toBe(true);
	});
});

describe('deterministic fills and ledger invariants', () => {
	it('executes an IOC attempt captured after acceptance against a newly received quote', () => {
		const instrument = stock();
		const order = createAcceptedOrder({
			id: orderId,
			draft: draft({ type: 'market', timeInForce: 'ioc', limitPrice: undefined }),
			instruments: new Map([[instrument.symbol, instrument]]),
			acceptedAt,
			latencyMilliseconds: 0
		});
		const quoteReceivedAt = new Date(acceptedAt.getTime() + 1);
		const attemptAt = new Date(quoteReceivedAt.getTime() + 1);
		const fill = calculateQuoteFill({
			order,
			quotes: new Map([
				[
					instrument.symbol,
					quote(instrument.symbol, {
						bid: '99',
						ask: '100',
						sourceTime: quoteReceivedAt,
						receivedAt: quoteReceivedAt
					})
				]
			]),
			executionModel: executionModelSchema.parse({ latencyMilliseconds: 0 }),
			quoteContext: quoteContext({ attemptAt })
		});

		expect(fill?.strategyQuantity.toFixed()).toBe('1');
	});

	it('honors latency, displayed liquidity, slippage, and delayed-data provenance', () => {
		const instrument = stock();
		const order = acceptedOrder(
			draft({ type: 'market', limitPrice: undefined, quantity: new Decimal(10) }),
			[instrument]
		);
		const tooEarly = quote('AAPL', { bid: '99', ask: '100', bidSize: '4', askSize: '4' });
		const fillAttemptAt = new Date('2026-01-02T14:30:00.250Z');
		const eligible = normalizedQuoteSchema.parse({
			...tooEarly,
			mode: 'delayed',
			sourceTime: new Date(fillAttemptAt.getTime() - 15 * 60_000),
			receivedAt: fillAttemptAt
		});
		const model = executionModelSchema.parse({ stockSlippageBps: '10', participationRate: '0.5' });

		expect(
			calculateQuoteFill({
				order,
				quotes: new Map([['AAPL', tooEarly]]),
				executionModel: model,
				quoteContext: quoteContext()
			})
		).toBeUndefined();
		expect(
			calculateQuoteFill({
				order,
				quotes: new Map([['AAPL', eligible]]),
				executionModel: model,
				quoteContext: quoteContext({ attemptAt: fillAttemptAt })
			})
		).toBeUndefined();
		expect(
			calculateQuoteFill({
				order,
				quotes: new Map([['AAPL', eligible]]),
				executionModel: model,
				quoteContext: quoteContext({
					expectedMode: 'delayed',
					expectedDelayMilliseconds: 15 * 60_000
				})
			})
		).toBeUndefined();
		const fill = calculateQuoteFill({
			order,
			quotes: new Map([['AAPL', eligible]]),
			executionModel: model,
			quoteContext: quoteContext({
				attemptAt: fillAttemptAt,
				expectedMode: 'delayed',
				expectedDelayMilliseconds: 15 * 60_000
			})
		});

		expect(fill?.strategyQuantity.toFixed()).toBe('2');
		expect(fill?.legs[0]?.price.toFixed(2)).toBe('100.10');
		expect(fill?.marketDataMode).toBe('delayed');
		expect(fill?.executionModelVersion).toBe('sim-execution-v1');
	});

	it('tests single-leg limit marketability on raw NBBO and clamps adverse slippage', () => {
		const instrument = stock();
		const fillAttemptAt = new Date('2026-01-02T14:30:00.250Z');
		const context = quoteContext({ attemptAt: fillAttemptAt });
		const model = executionModelSchema.parse({ stockSlippageBps: '100' });
		const buyOrder = acceptedOrder(draft({ limitPrice: new Decimal(100) }), [instrument]);
		const sellOrder = acceptedOrder(
			draft({
				limitPrice: new Decimal(100),
				legs: [
					{
						symbol: instrument.symbol,
						side: 'sell',
						positionEffect: 'close',
						ratioQuantity: new Decimal(1)
					}
				]
			}),
			[instrument]
		);
		const executableBuyQuote = quote(instrument.symbol, {
			bid: '99',
			ask: '100',
			sourceTime: fillAttemptAt,
			receivedAt: fillAttemptAt
		});
		const nonMarketableBuyQuote = quote(instrument.symbol, {
			bid: '99',
			ask: '100.01',
			sourceTime: fillAttemptAt,
			receivedAt: fillAttemptAt
		});
		const zeroCapacityBuyQuote = quote(instrument.symbol, {
			bid: '99',
			ask: '100',
			askSize: '0',
			sourceTime: fillAttemptAt,
			receivedAt: fillAttemptAt
		});
		const executableSellQuote = quote(instrument.symbol, {
			bid: '100',
			ask: '101',
			sourceTime: fillAttemptAt,
			receivedAt: fillAttemptAt
		});

		const buyFill = calculateQuoteFill({
			order: buyOrder,
			quotes: new Map([[instrument.symbol, executableBuyQuote]]),
			executionModel: model,
			quoteContext: context
		});
		const sellFill = calculateQuoteFill({
			order: sellOrder,
			quotes: new Map([[instrument.symbol, executableSellQuote]]),
			executionModel: model,
			quoteContext: context
		});

		expect(buyFill?.legs[0]?.price.toFixed(2)).toBe('100.00');
		expect(sellFill?.legs[0]?.price.toFixed(2)).toBe('100.00');
		expect(
			calculateQuoteFill({
				order: buyOrder,
				quotes: new Map([[instrument.symbol, nonMarketableBuyQuote]]),
				executionModel: model,
				quoteContext: context
			})
		).toBeUndefined();
		expect(
			calculateQuoteFill({
				order: buyOrder,
				quotes: new Map([[instrument.symbol, zeroCapacityBuyQuote]]),
				executionModel: model,
				quoteContext: context
			})
		).toBeUndefined();
	});

	it('posts balanced cash entries and realizes fee-adjusted P&L', () => {
		const instrument = stock();
		const openingOrder = acceptedOrder(
			draft({ quantity: new Decimal(2), limitPrice: new Decimal(100) }),
			[instrument]
		);
		const openingFill: StrategyFill = {
			orderId: openingOrder.id,
			portfolioId,
			strategyQuantity: new Decimal(2),
			legs: [
				{
					leg: openingOrder.legs[0],
					quantity: new Decimal(2),
					price: new Decimal(100),
					fee: new Decimal(2)
				}
			],
			marketDataMode: 'delayed',
			sourceEventKind: 'bar',
			sourceTime: acceptedAt,
			receivedAt: acceptedAt,
			executionModelVersion: 'sim-execution-v1'
		};
		let sequence = 0;
		const opened = applyFillToLedger({
			account: { portfolioId, cashBalance: new Decimal(1_000), positions: new Map() },
			fill: openingFill,
			fillId: 'fill-open',
			entryId: () => `entry-${++sequence}`
		});
		const closingLeg = {
			...openingOrder.legs[0],
			side: 'sell' as const,
			positionEffect: 'close' as const
		};
		const closingFill: StrategyFill = {
			...openingFill,
			strategyQuantity: new Decimal(1),
			legs: [
				{ leg: closingLeg, quantity: new Decimal(1), price: new Decimal(110), fee: new Decimal(1) }
			]
		};
		const closed = applyFillToLedger({
			account: opened.nextAccount,
			fill: closingFill,
			fillId: 'fill-close',
			entryId: () => `entry-${++sequence}`
		});

		expect(opened.nextAccount.cashBalance.toFixed()).toBe('798');
		expect(opened.nextAccount.positions.get('AAPL')?.averageCost.toFixed()).toBe('101');
		expect(closed.nextAccount.cashBalance.toFixed()).toBe('907');
		expect(closed.nextAccount.positions.get('AAPL')?.realizedPnl.toFixed()).toBe('8');
		assertCashLedgerInvariant({
			openingCash: new Decimal(1_000),
			entries: [...opened.entries, ...closed.entries],
			closingCash: closed.nextAccount.cashBalance
		});
		expect(() =>
			applyFillToLedger({
				account: { portfolioId, cashBalance: new Decimal(1), positions: new Map() },
				fill: openingFill,
				fillId: 'fill-invalid',
				entryId: () => 'entry-invalid'
			})
		).toThrow(LedgerInvariantError);
	});
});
