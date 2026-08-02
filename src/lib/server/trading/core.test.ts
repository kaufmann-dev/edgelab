import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
	normalizedBarSchema,
	optionInstrumentSchema,
	stockInstrumentSchema,
	type Instrument,
	type NormalizedBar,
	type OptionInstrument,
	type StockInstrument
} from '../market-data/types';
import { calculateBarFill } from './execution';
import { applyFillToLedger, assertCashLedgerInvariant, LedgerInvariantError } from './ledger';
import {
	acceptedOrderMatchesDraft,
	applyStrategyFill,
	createAcceptedOrder,
	OrderTransitionError,
	transitionOrder
} from './orders';
import { previewOrder } from './risk';
import { executableBarContextSchema, type ExecutableBarContext } from './bar-validation';
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
	expirationDate?: string;
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
		expirationDate: input.expirationDate ?? '2026-06-19',
		strikePrice: input.strike,
		multiplier: input.multiplier ?? '100',
		additionalUnderlyings: []
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

function barContext(overrides: Partial<ExecutableBarContext> = {}): ExecutableBarContext {
	return executableBarContextSchema.parse({
		attemptAt: new Date('2026-01-02T14:30:02.000Z'),
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
		volume: new Decimal(8),
		sourceTime: endTime,
		receivedAt: new Date('2026-01-02T14:30:02.000Z'),
		rawTimestamp: endTime.getTime().toString(),
		...overrides
	});
}

type PreviewInput = Parameters<typeof previewOrder>[0];

function preview(
	input: Omit<PreviewInput, 'bars' | 'executionModel' | 'barContext'> &
		Partial<Pick<PreviewInput, 'bars' | 'executionModel' | 'barContext'>>
) {
	const {
		bars = new Map(),
		executionModel = previewExecutionModel,
		barContext: context = barContext(),
		...previewInput
	} = input;
	return previewOrder({ ...previewInput, bars, executionModel, barContext: context });
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

	it('rejects overfills and multiple legs', () => {
		const order = acceptedOrder(draft(), [stock()]);

		expect(() => applyStrategyFill(order, new Decimal(2), new Date())).toThrow(
			OrderTransitionError
		);
		expect(
			orderDraftSchema.safeParse({
				...draft(),
				legs: Array.from({ length: 2 }, (_, index) => ({
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

	it('requires the canonical unit leg ratio', () => {
		expect(
			orderDraftSchema.safeParse({
				...draft(),
				legs: [
					{
						symbol: 'AAPL',
						side: 'buy',
						positionEffect: 'open',
						ratioQuantity: new Decimal(2)
					}
				]
			}).success
		).toBe(false);
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

	it('rejects option sell-to-open even when the call is covered', () => {
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
		const previewResult = preview({
			draft: order,
			instruments: new Map([[contract.symbol, contract]]),
			account: account({ positions: new Map([[equity.symbol, coveredPosition]]) })
		});

		expect(previewResult.accepted).toBe(false);
		expect(previewResult.optionCollateral.isZero()).toBe(true);
		expect(previewResult.shareCollateral.size).toBe(0);
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'unsupported_option_order'
		);
	});

	it('reserves held contracts for an option sell-to-close', () => {
		const contract = option({ symbol: 'O:AAPL260619C00200000', type: 'call', strike: '200' });
		const position: Position = {
			instrument: contract,
			quantity: new Decimal(3),
			averageCost: new Decimal('1.50'),
			realizedPnl: new Decimal(0)
		};
		const order = draft({
			quantity: new Decimal(2),
			limitPrice: new Decimal('2.50'),
			netPriceEffect: 'credit',
			legs: [
				{
					symbol: contract.symbol,
					side: 'sell',
					positionEffect: 'close',
					ratioQuantity: new Decimal(1)
				}
			]
		});
		const previewResult = preview({
			draft: order,
			instruments: new Map([[contract.symbol, contract]]),
			account: account({ positions: new Map([[contract.symbol, position]]) })
		});

		expect(previewResult.shareCollateral.get(contract.symbol)?.toFixed()).toBe('2');
		expect(previewResult.optionCollateral.isZero()).toBe(true);
		expect(previewResult.accepted).toBe(true);
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
			instruments: new Map([[equity.symbol, equity]])
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

	it.each([
		{ side: 'buy', heldQuantity: -10, direction: 'short' },
		{ side: 'sell', heldQuantity: 10, direction: 'long' }
	] as const)(
		'rejects a $side-to-open order against an existing $direction position',
		({ side, heldQuantity }) => {
			const equity = stock();
			const heldPosition: Position = {
				instrument: equity,
				quantity: new Decimal(heldQuantity),
				averageCost: new Decimal(150),
				realizedPnl: new Decimal(0)
			};
			const previewResult = preview({
				draft: draft({
					legs: [
						{
							symbol: equity.symbol,
							side,
							positionEffect: 'open',
							ratioQuantity: new Decimal(1)
						}
					]
				}),
				instruments: new Map([[equity.symbol, equity]]),
				account: account({
					positions: new Map([[equity.symbol, heldPosition]]),
					riskPolicy: riskPolicySchema.parse({ allowShortStock: true })
				})
			});

			expect(previewResult.accepted).toBe(false);
			expect(previewResult.violations.map((violation) => violation.code)).toContain(
				'position_effect_conflict'
			);
		}
	);

	it('reserves a stock market buy from the aggregate close', () => {
		const equity = stock();
		const marketOrder = draft({ type: 'market', limitPrice: undefined });
		const aggregateEnd = new Date('2026-01-02T14:15:02.000Z');
		const previewResult = preview({
			draft: marketOrder,
			instruments: new Map([[equity.symbol, equity]]),
			bars: new Map([
				[
					equity.symbol,
					bar({
						interval: 'minute',
						startTime: new Date(aggregateEnd.getTime() - 60_000),
						endTime: aggregateEnd,
						sourceTime: aggregateEnd,
						open: new Decimal(99),
						close: new Decimal(100)
					})
				]
			]),
			account: account({ cashBalance: new Decimal('100.05') }),
			executionModel: executionModelSchema.parse({ stockSlippageBps: '10' }),
			barContext: barContext({
				attemptAt: new Date('2026-01-02T14:30:02.000Z'),
				expectedMode: 'delayed',
				expectedDelayMilliseconds: 15 * 60_000
			})
		});

		expect(previewResult.legs[0]?.referencePrice.toFixed(2)).toBe('100.10');
		expect(previewResult.estimatedNetCashChange.toFixed(2)).toBe('-100.10');
		expect(previewResult.cashRequired.toFixed(2)).toBe('100.10');
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'insufficient_cash'
		);
	});

	it('blocks a stale completed aggregate from stock preview pricing', () => {
		const equity = stock();
		const aggregateEnd = new Date('2026-01-02T14:10:00.000Z');
		const previewResult = preview({
			draft: draft({ type: 'market', limitPrice: undefined }),
			instruments: new Map([[equity.symbol, equity]]),
			bars: new Map([
				[
					equity.symbol,
					bar({
						interval: 'minute',
						startTime: new Date(aggregateEnd.getTime() - 60_000),
						endTime: aggregateEnd,
						sourceTime: aggregateEnd
					})
				]
			]),
			account: account(),
			barContext: barContext({
				attemptAt: new Date('2026-01-02T14:30:02.000Z'),
				expectedMode: 'delayed',
				expectedDelayMilliseconds: 15 * 60_000
			})
		});

		expect(previewResult.accepted).toBe(false);
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'market_data_stale'
		);
	});

	it('blocks a stock market preview when no aggregate price is available', () => {
		const equity = stock();
		const previewResult = preview({
			draft: draft({ type: 'market', limitPrice: undefined }),
			instruments: new Map([[equity.symbol, equity]]),
			account: account()
		});

		expect(previewResult.accepted).toBe(false);
		expect(previewResult.violations.map((violation) => violation.code)).toContain(
			'market_data_unavailable'
		);
	});

	it('rejects multiple legs at the canonical order boundary', () => {
		const singleLegDraft = draft();
		const parsed = orderDraftSchema.safeParse({
			...singleLegDraft,
			legs: [
				...singleLegDraft.legs,
				{
					symbol: 'MSFT',
					side: 'buy',
					positionEffect: 'open',
					ratioQuantity: new Decimal(1)
				}
			]
		});

		expect(parsed.success).toBe(false);
		if (parsed.success) throw new Error('Expected the multi-leg order to be rejected');
		expect(parsed.error.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: ['legs'],
					message: 'Orders require exactly one leg'
				})
			])
		);
	});
});

describe('deterministic fills and ledger invariants', () => {
	it('executes a delayed market order on the first logically eligible second bar', () => {
		const instrument = stock();
		const order = acceptedOrder(
			draft({ type: 'market', limitPrice: undefined, quantity: new Decimal(10) }),
			[instrument]
		);
		const result = calculateBarFill({
			order,
			bar: bar(),
			executionModel: executionModelSchema.parse({
				stockSlippageBps: '10',
				participationRate: '0.25'
			}),
			barContext: barContext()
		});

		expect(result.triggered).toBe(false);
		expect(result.fill?.strategyQuantity.toFixed()).toBe('2');
		expect(result.fill?.legs[0]?.price.toFixed(2)).toBe('100.10');
		expect(result.fill?.sourceTime).toEqual(new Date('2026-01-02T14:15:02.000Z'));
		expect(result.fill?.sourceSequence).toBe('1767363302000');
	});

	it('fills a touched limit at the limit and a favorable opening gap at the open', () => {
		const instrument = stock();
		const order = acceptedOrder(draft({ limitPrice: new Decimal(100) }), [instrument]);
		const model = executionModelSchema.parse({});
		const touched = calculateBarFill({
			order,
			bar: bar({ open: new Decimal(101), low: new Decimal(99) }),
			executionModel: model,
			barContext: barContext()
		});
		const improved = calculateBarFill({
			order,
			bar: bar({ open: new Decimal(99), low: new Decimal(98) }),
			executionModel: model,
			barContext: barContext()
		});

		expect(touched.fill?.legs[0]?.price.toFixed(2)).toBe('100.00');
		expect(improved.fill?.legs[0]?.price.toFixed(2)).toBe('99.00');
	});

	it('collars favorable option sell-to-close gaps at the accepted limit without changing stock improvement', () => {
		const optionContract = option({
			symbol: 'O:AAPL260619C00200000',
			type: 'call',
			strike: '200'
		});
		const optionOrder = acceptedOrder(
			draft({
				limitPrice: new Decimal(5),
				netPriceEffect: 'credit',
				legs: [
					{
						symbol: optionContract.symbol,
						side: 'sell',
						positionEffect: 'close',
						ratioQuantity: new Decimal(1)
					}
				]
			}),
			[optionContract]
		);
		const stockInstrument = stock();
		const stockOrder = acceptedOrder(
			draft({
				limitPrice: new Decimal(100),
				netPriceEffect: 'credit',
				legs: [
					{
						symbol: stockInstrument.symbol,
						side: 'sell',
						positionEffect: 'open',
						ratioQuantity: new Decimal(1)
					}
				]
			}),
			[stockInstrument]
		);
		const model = executionModelSchema.parse({});

		const optionFill = calculateBarFill({
			order: optionOrder,
			bar: bar({
				assetClass: 'options',
				symbol: optionContract.symbol,
				open: new Decimal(6),
				high: new Decimal('6.50'),
				low: new Decimal('5.50'),
				close: new Decimal(6)
			}),
			executionModel: model,
			barContext: barContext()
		});
		const stockFill = calculateBarFill({
			order: stockOrder,
			bar: bar({
				open: new Decimal(101),
				high: new Decimal(102),
				low: new Decimal(100),
				close: new Decimal(101)
			}),
			executionModel: model,
			barContext: barContext()
		});

		expect(optionFill.fill?.legs[0]?.price.toFixed(2)).toBe('5.00');
		expect(stockFill.fill?.legs[0]?.price.toFixed(2)).toBe('101.00');
	});

	it('defensively refuses unsupported and expiration-day option fills', () => {
		const openShort = option({
			symbol: 'O:AAPL260619C00200000',
			type: 'call',
			strike: '200'
		});
		const expiring = option({
			symbol: 'O:AAPL260102C00200000',
			type: 'call',
			strike: '200',
			expirationDate: '2026-01-02'
		});
		const sellToOpen = acceptedOrder(
			draft({
				limitPrice: new Decimal(5),
				netPriceEffect: 'credit',
				legs: [
					{
						symbol: openShort.symbol,
						side: 'sell',
						positionEffect: 'open',
						ratioQuantity: new Decimal(1)
					}
				]
			}),
			[openShort]
		);
		const expirationDay = acceptedOrder(
			draft({
				limitPrice: new Decimal(5),
				legs: [
					{
						symbol: expiring.symbol,
						side: 'buy',
						positionEffect: 'open',
						ratioQuantity: new Decimal(1)
					}
				]
			}),
			[expiring]
		);
		const aggregateFor = (symbol: string) =>
			bar({
				assetClass: 'options',
				symbol,
				open: new Decimal(5),
				high: new Decimal(6),
				low: new Decimal(4),
				close: new Decimal(5)
			});

		expect(
			calculateBarFill({
				order: sellToOpen,
				bar: aggregateFor(openShort.symbol),
				executionModel: executionModelSchema.parse({}),
				barContext: barContext()
			}).fill
		).toBeUndefined();
		expect(
			calculateBarFill({
				order: expirationDay,
				bar: aggregateFor(expiring.symbol),
				executionModel: executionModelSchema.parse({}),
				barContext: barContext()
			}).fill
		).toBeUndefined();
	});

	it('triggers an intrabar stop and fills it as a slipped market order', () => {
		const instrument = stock();
		const order = acceptedOrder(
			draft({ type: 'stop', limitPrice: undefined, stopPrice: new Decimal(105) }),
			[instrument]
		);
		const result = calculateBarFill({
			order,
			bar: bar({ open: new Decimal(100), high: new Decimal(106) }),
			executionModel: executionModelSchema.parse({ stockSlippageBps: '10' }),
			barContext: barContext()
		});

		expect(result.triggered).toBe(true);
		expect(result.fill?.legs[0]?.price.toFixed(2)).toBe('105.11');
	});

	it('treats an already-triggered stop as market and stop-limit as an ordinary limit', () => {
		const instrument = stock();
		const triggeredAt = new Date('2026-01-02T14:15:00.000Z');
		const triggeredStop = {
			...acceptedOrder(
				draft({ type: 'stop', limitPrice: undefined, stopPrice: new Decimal(105) }),
				[instrument]
			),
			triggeredAt
		};
		const triggeredStopLimit = {
			...acceptedOrder(
				draft({ type: 'stop_limit', stopPrice: new Decimal(105), limitPrice: new Decimal(106) }),
				[instrument]
			),
			triggeredAt
		};
		const aggregate = bar({
			open: new Decimal(104),
			high: new Decimal('104.50'),
			low: new Decimal(103),
			close: new Decimal(104)
		});
		const model = executionModelSchema.parse({ stockSlippageBps: '10' });

		const marketResult = calculateBarFill({
			order: triggeredStop,
			bar: aggregate,
			executionModel: model,
			barContext: barContext()
		});
		const limitResult = calculateBarFill({
			order: triggeredStopLimit,
			bar: aggregate,
			executionModel: model,
			barContext: barContext()
		});

		expect(marketResult.fill?.legs[0]?.price.toFixed(2)).toBe('104.10');
		expect(limitResult.fill?.legs[0]?.price.toFixed(2)).toBe('104.00');
	});

	it('triggers an intrabar stop-limit without filling until a later bar', () => {
		const instrument = stock();
		const order = acceptedOrder(
			draft({ type: 'stop_limit', stopPrice: new Decimal(105), limitPrice: new Decimal(106) }),
			[instrument]
		);
		const result = calculateBarFill({
			order,
			bar: bar({
				open: new Decimal(100),
				high: new Decimal(107),
				low: new Decimal(99),
				close: new Decimal(106)
			}),
			executionModel: executionModelSchema.parse({}),
			barContext: barContext()
		});

		expect(result.triggered).toBe(true);
		expect(result.fill).toBeUndefined();
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
			executionModelVersion: 'sim-execution-v2'
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
