import Decimal from 'decimal.js';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import {
	tradingInstruments,
	tradingOrderLegs,
	tradingOrders,
	tradingPortfolios
} from '$lib/server/db/schema/trading';
import {
	assetClassSchema,
	marketDataModeSchema,
	type AssetClass,
	type MassiveMarketHoliday,
	type MarketDataMode,
	type NormalizedMarketEvent,
	type NormalizedQuote,
	type NormalizedTrade
} from '$lib/server/market-data';
import { getMarketEnvironment } from '$lib/server/market';
import {
	dayOrderExpiration,
	getMassiveMarketHolidays,
	logicalMarketTime,
	orderAllowsSession,
	usEquitySessionAt
} from '$lib/server/market-session';
import { marketStreamHub } from '$lib/server/market-stream';
import {
	SIMULATION_EXECUTION_MODEL,
	SIMULATION_FEE_MODEL,
	applyFillToLedger,
	applyStrategyFill,
	calculateQuoteFill,
	drizzleTradingRepository,
	evaluateStopTrigger,
	fillGrossAmount,
	orderTypeSchema,
	timeInForceSchema,
	transitionOrder,
	type AcceptedOrder,
	type OrderType,
	type TimeInForce
} from '$lib/server/trading';

const REFRESH_INTERVAL_MILLISECONDS = 15_000;
const MAX_QUOTE_AGE_MILLISECONDS = 60_000;
const SERIALIZATION_RETRY_DELAYS = [0, 25, 100] as const;
const ACTIVE_ORDER_STATUSES = ['open', 'partially_filled'] as const;
const STOP_ORDER_TYPES = new Set<OrderType>(['stop', 'stop_limit', 'trailing_stop']);

export interface LiveOrderTopicLeg {
	symbol: string;
	assetClass: AssetClass;
}

export interface LiveOrderTopicInput {
	orderType: OrderType;
	timeInForce: TimeInForce;
	dataMode: MarketDataMode;
	legs: readonly LiveOrderTopicLeg[];
}

export interface LiveOrderTopicPlan {
	realtime: Record<AssetClass, string[]>;
	delayed: Record<AssetClass, string[]>;
}

interface TrackedOrder extends LiveOrderTopicInput {
	orderId: string;
	portfolioId: string;
	ownerUserId: string;
	acceptedAt: Date;
	legs: LiveOrderTopicLeg[];
}

interface OrderProcessingResult {
	terminal: boolean;
}

interface PostgreSqlErrorDetails {
	code?: string;
	constraint?: string;
}

export function isDayOrderExpired(input: {
	timeInForce: TimeInForce;
	acceptedAt: Date;
	delayMilliseconds: number;
	extendedHours: boolean;
	holidays: readonly MassiveMarketHoliday[];
	at: Date;
}): boolean {
	return (
		input.timeInForce === 'day' &&
		input.at >=
			dayOrderExpiration({
				acceptedAt: input.acceptedAt,
				delayMilliseconds: input.delayMilliseconds,
				extendedHours: input.extendedHours,
				holidays: input.holidays
			})
	);
}

export function planLiveOrderTopics(orders: readonly LiveOrderTopicInput[]): LiveOrderTopicPlan {
	const topics: Record<MarketDataMode, Record<AssetClass, Set<string>>> = {
		realtime: { stocks: new Set<string>(), options: new Set<string>() },
		delayed: { stocks: new Set<string>(), options: new Set<string>() }
	};
	for (const order of orders) {
		if (order.timeInForce === 'ioc') continue;
		for (const leg of order.legs) {
			topics[order.dataMode][leg.assetClass].add(`Q.${leg.symbol}`);
			if (order.legs.length === 1 && STOP_ORDER_TYPES.has(order.orderType)) {
				topics[order.dataMode][leg.assetClass].add(`T.${leg.symbol}`);
			}
		}
	}
	return {
		realtime: {
			stocks: [...topics.realtime.stocks].sort(),
			options: [...topics.realtime.options].sort()
		},
		delayed: {
			stocks: [...topics.delayed.stocks].sort(),
			options: [...topics.delayed.options].sort()
		}
	};
}

export function isQuoteEligibleForEvent(input: {
	quote: Pick<NormalizedQuote, 'mode' | 'sourceTime'>;
	expectedMode: MarketDataMode;
	eventSourceTime: Date;
	triggeredAt?: Date;
	maxAgeMilliseconds?: number;
}): boolean {
	if (input.quote.mode !== input.expectedMode) return false;
	const age = input.eventSourceTime.getTime() - input.quote.sourceTime.getTime();
	if (age < 0 || age > (input.maxAgeMilliseconds ?? MAX_QUOTE_AGE_MILLISECONDS)) return false;
	return !input.triggeredAt || input.quote.sourceTime >= input.triggeredAt;
}

export function isStopTradeEligible(input: {
	trade: Pick<NormalizedTrade, 'mode' | 'sourceTime' | 'receivedAt'>;
	expectedMode: MarketDataMode;
	eligibleAt: Date;
	delayMilliseconds: number;
	maxSourceAgeMilliseconds?: number;
	futureToleranceMilliseconds?: number;
}): boolean {
	if (input.trade.mode !== input.expectedMode || input.trade.receivedAt < input.eligibleAt) {
		return false;
	}
	const logicalAt = logicalMarketTime(input.trade.receivedAt, input.delayMilliseconds);
	const sourceAge = logicalAt.getTime() - input.trade.sourceTime.getTime();
	return (
		sourceAge <= (input.maxSourceAgeMilliseconds ?? MAX_QUOTE_AGE_MILLISECONDS) &&
		sourceAge >= -(input.futureToleranceMilliseconds ?? 1_000)
	);
}

export function hasAvailableCashForLiveFill(input: {
	cashBalance: Decimal;
	reservedCash: Decimal;
	orderCashReservation: Decimal;
	netCashChange: Decimal;
}): boolean {
	if (
		input.reservedCash.isNegative() ||
		input.orderCashReservation.isNegative() ||
		input.orderCashReservation.greaterThan(input.reservedCash)
	) {
		throw new Error('Active cash reservations are inconsistent');
	}
	const netCashDebit = Decimal.max(input.netCashChange.negated(), 0);
	if (netCashDebit.isZero()) return true;
	const availableCash = input.cashBalance
		.minus(input.reservedCash)
		.plus(input.orderCashReservation);
	return availableCash.greaterThanOrEqualTo(netCashDebit);
}

function quoteKey(mode: MarketDataMode, assetClass: AssetClass, symbol: string): string {
	return `${mode}:${assetClass}:${symbol}`;
}

function eventKey(assetClass: AssetClass, symbol: string): string {
	return `${assetClass}:${symbol}`;
}

function compareTrackedOrders(left: TrackedOrder, right: TrackedOrder): number {
	return (
		left.acceptedAt.getTime() - right.acceptedAt.getTime() ||
		left.orderId.localeCompare(right.orderId)
	);
}

function errorDetails(error: unknown): PostgreSqlErrorDetails {
	let candidate: unknown = error;
	for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
		const details = candidate as PostgreSqlErrorDetails & { cause?: unknown };
		if (details.code || details.constraint) return details;
		candidate = details.cause;
	}
	return {};
}

function isRetryableTransactionError(error: unknown): boolean {
	return ['40001', '40P01'].includes(errorDetails(error).code ?? '');
}

function isDuplicateSourceFill(error: unknown): boolean {
	const details = errorDetails(error);
	return details.code === '23505' && details.constraint === 'trading_fills_order_source_uidx';
}

function sleep(milliseconds: number): Promise<void> {
	if (milliseconds === 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (const delay of SERIALIZATION_RETRY_DELAYS) {
		await sleep(delay);
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!isRetryableTransactionError(error)) throw error;
		}
	}
	throw lastError;
}

function updateCachedQuote(cache: Map<string, NormalizedQuote>, quote: NormalizedQuote): void {
	const key = quoteKey(quote.mode, quote.assetClass, quote.symbol);
	const current = cache.get(key);
	if (
		!current ||
		quote.sourceTime > current.sourceTime ||
		(quote.sourceTime.getTime() === current.sourceTime.getTime() &&
			quote.receivedAt > current.receivedAt)
	) {
		cache.set(key, quote);
	}
}

function trailingStateChanged(
	order: AcceptedOrder,
	state: NonNullable<ReturnType<typeof evaluateStopTrigger>>
): boolean {
	return (
		!order.trailingWatermark?.equals(state.watermark) ||
		!order.trailingStopPrice?.equals(state.stopPrice)
	);
}

export class LiveOrderExecutionCoordinator {
	readonly #orders = new Map<string, TrackedOrder>();
	readonly #orderIdsBySymbol = new Map<string, Set<string>>();
	readonly #quotes = new Map<string, NormalizedQuote>();
	readonly #unsubscribeByStream = new Map<string, () => void>();
	readonly #topicSignatureByStream = new Map<string, string>();
	readonly #lastReportedError = new Map<string, string>();
	#holidays?: readonly MassiveMarketHoliday[];
	#queue: Promise<void> = Promise.resolve();
	#refreshTimer?: ReturnType<typeof setTimeout>;
	#started = false;

	start(): void {
		if (this.#started) return;
		this.#started = true;
		this.#scheduleRefresh(0);
	}

	notifyOrdersChanged(): void {
		this.start();
		if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
		this.#refreshTimer = undefined;
		this.#scheduleRefresh(25);
	}

	#scheduleRefresh(delay: number): void {
		if (!this.#started || this.#refreshTimer) return;
		this.#refreshTimer = setTimeout(() => {
			this.#refreshTimer = undefined;
			void this.#enqueue(() => this.#refresh()).finally(() => {
				this.#scheduleRefresh(REFRESH_INTERVAL_MILLISECONDS);
			});
		}, delay);
		this.#refreshTimer.unref?.();
	}

	#enqueue(operation: () => Promise<void>): Promise<void> {
		const run = this.#queue.then(operation);
		this.#queue = run.catch((error: unknown) => {
			this.#reportError('event loop', error);
		});
		return this.#queue;
	}

	async #refresh(): Promise<void> {
		const now = new Date();
		try {
			this.#holidays = await getMassiveMarketHolidays(now);
			this.#lastReportedError.delete('market calendar');
		} catch (error) {
			this.#holidays = undefined;
			this.#stopSubscriptions();
			this.#reportError('market calendar', error);
			throw error;
		}
		const discovered = await this.#loadOpenOrders();
		this.#lastReportedError.delete('refresh');
		this.#orders.clear();
		for (const order of discovered) this.#orders.set(order.orderId, order);
		this.#rebuildSymbolIndex();

		for (const order of [...this.#orders.values()].sort(compareTrackedOrders)) {
			if (order.timeInForce === 'day') await this.#expireOrder(order, now);
		}
		this.#syncSubscriptions();
		this.#pruneQuoteCache();
	}

	async #loadOpenOrders(): Promise<TrackedOrder[]> {
		try {
			const { db } = await import('$lib/server/db');
			const rows = await db
				.select({
					orderId: tradingOrders.id,
					portfolioId: tradingOrders.portfolioId,
					ownerUserId: tradingPortfolios.ownerUserId,
					dataMode: tradingPortfolios.dataMode,
					acceptedAt: tradingOrders.acceptedAt,
					orderType: tradingOrders.orderType,
					timeInForce: tradingOrders.timeInForce,
					legNumber: tradingOrderLegs.legNumber,
					symbol: tradingInstruments.symbol,
					assetClass: tradingInstruments.assetClass
				})
				.from(tradingOrders)
				.innerJoin(tradingPortfolios, eq(tradingPortfolios.id, tradingOrders.portfolioId))
				.innerJoin(tradingOrderLegs, eq(tradingOrderLegs.orderId, tradingOrders.id))
				.innerJoin(tradingInstruments, eq(tradingInstruments.id, tradingOrderLegs.instrumentId))
				.where(
					and(
						inArray(tradingOrders.status, ACTIVE_ORDER_STATUSES),
						ne(tradingOrders.timeInForce, 'ioc'),
						eq(tradingPortfolios.status, 'active'),
						isNotNull(tradingOrders.acceptedAt),
						isNotNull(tradingOrders.eligibleAt)
					)
				)
				.orderBy(
					asc(tradingOrders.acceptedAt),
					asc(tradingOrders.id),
					asc(tradingOrderLegs.legNumber)
				);

			const orders = new Map<string, TrackedOrder>();
			for (const row of rows) {
				if (!row.acceptedAt) continue;
				const leg = {
					symbol: row.symbol,
					assetClass: assetClassSchema.parse(row.assetClass)
				};
				const existing = orders.get(row.orderId);
				if (existing) {
					existing.legs.push(leg);
					continue;
				}
				orders.set(row.orderId, {
					orderId: row.orderId,
					portfolioId: row.portfolioId,
					ownerUserId: row.ownerUserId,
					dataMode: marketDataModeSchema.parse(row.dataMode),
					acceptedAt: row.acceptedAt,
					orderType: orderTypeSchema.parse(row.orderType),
					timeInForce: timeInForceSchema.parse(row.timeInForce),
					legs: [leg]
				});
			}
			return [...orders.values()].sort(compareTrackedOrders);
		} catch (error) {
			this.#reportError('refresh', error);
			throw error;
		}
	}

	#rebuildSymbolIndex(): void {
		this.#orderIdsBySymbol.clear();
		for (const order of this.#orders.values()) {
			for (const leg of order.legs) {
				const key = eventKey(leg.assetClass, leg.symbol);
				const ids = this.#orderIdsBySymbol.get(key) ?? new Set<string>();
				ids.add(order.orderId);
				this.#orderIdsBySymbol.set(key, ids);
			}
		}
	}

	#syncSubscriptions(): void {
		const plan = planLiveOrderTopics([...this.#orders.values()]);
		for (const mode of ['realtime', 'delayed'] as const) {
			this.#syncAssetSubscription(mode, 'stocks', plan[mode].stocks);
			this.#syncAssetSubscription(mode, 'options', plan[mode].options);
		}
	}

	#stopSubscriptions(): void {
		for (const unsubscribe of this.#unsubscribeByStream.values()) unsubscribe();
		this.#unsubscribeByStream.clear();
		this.#topicSignatureByStream.clear();
	}

	#syncAssetSubscription(mode: MarketDataMode, assetClass: AssetClass, topics: string[]): void {
		const streamKey = `${mode}:${assetClass}`;
		const signature = topics.join(',');
		if (this.#topicSignatureByStream.get(streamKey) === signature) return;
		if (topics.length === 0) {
			this.#unsubscribeByStream.get(streamKey)?.();
			this.#unsubscribeByStream.delete(streamKey);
			this.#topicSignatureByStream.set(streamKey, signature);
			return;
		}
		try {
			const unsubscribe = marketStreamHub.subscribeEvents(
				assetClass,
				topics,
				(event) => {
					if (event.kind === 'quote') updateCachedQuote(this.#quotes, event);
					void this.#enqueue(() => this.#processEvent(event));
				},
				mode,
				(status, message) => {
					if (status === 'authenticated') {
						this.#lastReportedError.delete(`stream ${streamKey}`);
					} else if (status === 'error') {
						this.#reportError(`stream ${streamKey}`, message ?? 'Massive WebSocket error');
					}
				}
			);
			this.#unsubscribeByStream.get(streamKey)?.();
			this.#unsubscribeByStream.set(streamKey, unsubscribe);
			this.#topicSignatureByStream.set(streamKey, signature);
			this.#lastReportedError.delete(`subscribe ${streamKey}`);
		} catch (error) {
			this.#reportError(`subscribe ${streamKey}`, error);
		}
	}

	#pruneQuoteCache(): void {
		const expected = new Set(
			[...this.#orders.values()].flatMap((order) =>
				order.legs.map((leg) => quoteKey(order.dataMode, leg.assetClass, leg.symbol))
			)
		);
		for (const key of this.#quotes.keys()) {
			if (!expected.has(key)) this.#quotes.delete(key);
		}
	}

	async #processEvent(event: NormalizedMarketEvent): Promise<void> {
		if (event.kind !== 'quote' && event.kind !== 'trade') return;
		const ids = this.#orderIdsBySymbol.get(eventKey(event.assetClass, event.symbol));
		if (!ids) return;
		const orders = [...ids]
			.map((id) => this.#orders.get(id))
			.filter((order): order is TrackedOrder => order !== undefined)
			.sort(compareTrackedOrders);
		for (const tracked of orders) {
			if (event.kind === 'trade' && !STOP_ORDER_TYPES.has(tracked.orderType)) continue;
			try {
				const result = await retrySerializable(() => this.#processOrder(tracked, event));
				if (result.terminal) this.#removeTrackedOrder(tracked.orderId);
			} catch (error) {
				if (isDuplicateSourceFill(error)) continue;
				this.#reportError(`order ${tracked.orderId}`, error);
			}
		}
	}

	async #processOrder(
		tracked: TrackedOrder,
		event: NormalizedQuote | NormalizedTrade
	): Promise<OrderProcessingResult> {
		return drizzleTradingRepository.transaction(tracked.portfolioId, async (unitOfWork) => {
			const holidays = this.#holidays;
			if (!holidays) return { terminal: false };
			const portfolio = await unitOfWork.getPortfolioForUpdate(
				tracked.portfolioId,
				tracked.ownerUserId
			);
			if (!portfolio || portfolio.status !== 'active') return { terminal: true };
			let order = await unitOfWork.getOrderForUpdate(tracked.orderId);
			if (
				!order ||
				!ACTIVE_ORDER_STATUSES.includes(order.status as (typeof ACTIVE_ORDER_STATUSES)[number])
			) {
				return { terminal: true };
			}
			if (order.timeInForce === 'ioc') return { terminal: true };
			if (portfolio.dataMode !== event.mode) return { terminal: false };
			const delayMilliseconds = this.#delayMilliseconds(order.legs, portfolio.dataMode);

			if (
				isDayOrderExpired({
					...order,
					delayMilliseconds,
					holidays,
					at: event.receivedAt
				})
			) {
				await this.#persistExpiry(unitOfWork, order, delayMilliseconds, holidays);
				return { terminal: true };
			}
			if (!this.#orderAllowsEvent(order, event, delayMilliseconds, holidays)) {
				return { terminal: false };
			}

			if (event.kind === 'trade') {
				if (!STOP_ORDER_TYPES.has(order.type) || order.triggeredAt) return { terminal: false };
				if (
					!isStopTradeEligible({
						trade: event,
						expectedMode: portfolio.dataMode,
						eligibleAt: order.eligibleAt,
						delayMilliseconds
					})
				) {
					return { terminal: false };
				}
				const state = evaluateStopTrigger({
					order,
					trade: event,
					state:
						order.type === 'trailing_stop' && order.trailingWatermark && order.trailingStopPrice
							? {
									watermark: order.trailingWatermark,
									stopPrice: order.trailingStopPrice,
									triggered: false
								}
							: undefined
				});
				if (!state) return { terminal: false };
				const newlyTriggered = state.triggered && !order.triggeredAt;
				const persistTrailing =
					order.type === 'trailing_stop' && trailingStateChanged(order, state);
				if (newlyTriggered || persistTrailing) {
					const previousRevision = order.revision;
					order = {
						...order,
						triggeredAt: newlyTriggered ? event.sourceTime : order.triggeredAt,
						trailingWatermark:
							order.type === 'trailing_stop' ? state.watermark : order.trailingWatermark,
						trailingStopPrice:
							order.type === 'trailing_stop' ? state.stopPrice : order.trailingStopPrice,
						revision: previousRevision + 1
					};
					if (!(await unitOfWork.updateOrder(order, previousRevision))) {
						throw new Error('Order changed while its stop state was being updated');
					}
					if (newlyTriggered) {
						await unitOfWork.appendOrderEvent({
							orderId: order.id,
							fromStatus: order.status,
							toStatus: order.status,
							at: event.sourceTime,
							reason: 'Triggered by a matching live trade'
						});
					}
				}
				return { terminal: false };
			}

			const quotes = this.#eligibleQuotes(order, portfolio.dataMode, event.sourceTime);
			if (!quotes) return { terminal: false };
			const fill = calculateQuoteFill({
				order,
				quotes,
				executionModel: SIMULATION_EXECUTION_MODEL,
				quoteContext: {
					attemptAt: event.receivedAt,
					expectedMode: portfolio.dataMode,
					expectedDelayMilliseconds: delayMilliseconds,
					maxTransportAgeMilliseconds: MAX_QUOTE_AGE_MILLISECONDS,
					maxSourceAgeMilliseconds: MAX_QUOTE_AGE_MILLISECONDS,
					futureToleranceMilliseconds: 1_000,
					maxSourceSkewMilliseconds: MAX_QUOTE_AGE_MILLISECONDS,
					maxReceiptSkewMilliseconds: MAX_QUOTE_AGE_MILLISECONDS
				},
				feeModel: SIMULATION_FEE_MODEL
			});
			if (!fill) return { terminal: false };
			const netCashChange = fill.legs.reduce((change, leg) => {
				const grossAmount = fillGrossAmount(leg);
				return change
					.plus(leg.leg.side === 'buy' ? grossAmount.negated() : grossAmount)
					.minus(leg.fee);
			}, new Decimal(0));
			const orderCashReservation = await unitOfWork.getActiveOrderCashReservationForUpdate(
				order.id
			);
			if (
				!hasAvailableCashForLiveFill({
					cashBalance: portfolio.cashBalance,
					reservedCash: portfolio.reservedCash,
					orderCashReservation,
					netCashChange
				})
			) {
				return { terminal: false };
			}

			const positions = await unitOfWork.getPositionsForUpdate(
				order.portfolioId,
				order.legs.map((leg) => leg.symbol)
			);
			const fillId = crypto.randomUUID();
			const applied = applyFillToLedger({
				account: {
					portfolioId: order.portfolioId,
					cashBalance: portfolio.cashBalance,
					positions
				},
				fill,
				fillId,
				entryId: () => crypto.randomUUID()
			});
			const previousStatus = order.status;
			const previousRevision = order.revision;
			const remainingQuantityBeforeFill = order.quantity.minus(order.filledQuantity);
			order = applyStrategyFill(order, fill.strategyQuantity, fill.receivedAt);
			await unitOfWork.insertFill({ id: fillId, fill });
			await unitOfWork.insertLedgerEntries(applied.entries);
			await unitOfWork.upsertPositions(order.portfolioId, applied.positionChanges);
			if (!(await unitOfWork.updateOrder(order, previousRevision))) {
				throw new Error('Order changed during live execution');
			}
			await unitOfWork.appendOrderEvent({
				orderId: order.id,
				fromStatus: previousStatus,
				toStatus: order.status,
				at: fill.receivedAt,
				reason: 'Filled by the live quote execution model'
			});
			await unitOfWork.consumeOrderReservations({
				orderId: order.id,
				fillQuantity: fill.strategyQuantity,
				remainingQuantityBeforeFill,
				consumedAt: fill.receivedAt
			});
			return { terminal: order.status === 'filled' };
		});
	}

	#eligibleQuotes(
		order: AcceptedOrder,
		mode: MarketDataMode,
		eventSourceTime: Date
	): Map<string, NormalizedQuote> | undefined {
		const quotes = new Map<string, NormalizedQuote>();
		for (const leg of order.legs) {
			const quote = this.#quotes.get(quoteKey(mode, leg.instrument.assetClass, leg.symbol));
			if (
				!quote ||
				!isQuoteEligibleForEvent({
					quote,
					expectedMode: mode,
					eventSourceTime,
					triggeredAt: order.triggeredAt
				})
			) {
				return undefined;
			}
			quotes.set(leg.symbol, quote);
		}
		return quotes;
	}

	#delayMilliseconds(
		legs: readonly (LiveOrderTopicLeg | AcceptedOrder['legs'][number])[],
		dataMode: MarketDataMode
	): number {
		const capabilities = getMarketEnvironment().capabilities;
		const delays = new Set(
			legs.map((leg) => {
				const assetClass = 'instrument' in leg ? leg.instrument.assetClass : leg.assetClass;
				const capability = capabilities[assetClass];
				if (capability.mode !== dataMode) {
					throw new Error(
						`${assetClass} ${dataMode} data does not match the configured Massive plan`
					);
				}
				return capability.delayMinutes * 60 * 1_000;
			})
		);
		if (delays.size !== 1) throw new Error('Order legs do not share one logical market clock');
		const [delay] = delays;
		if (delay === undefined) throw new Error('Order has no executable market-data legs');
		return delay;
	}

	#orderAllowsEvent(
		order: AcceptedOrder,
		event: NormalizedQuote | NormalizedTrade,
		delayMilliseconds: number,
		holidays: readonly MassiveMarketHoliday[]
	): boolean {
		const allStockLegs = order.legs.every((leg) => leg.instrument.assetClass === 'stocks');
		const allowed = (at: Date) =>
			orderAllowsSession({
				session: usEquitySessionAt(at, holidays),
				extendedHours: order.extendedHours,
				orderType: order.type,
				allStockLegs
			});
		return (
			allowed(event.sourceTime) && allowed(logicalMarketTime(event.receivedAt, delayMilliseconds))
		);
	}

	async #expireOrder(tracked: TrackedOrder, at: Date): Promise<void> {
		try {
			const holidays = this.#holidays;
			if (!holidays) return;
			const delayMilliseconds = this.#delayMilliseconds(tracked.legs, tracked.dataMode);
			const result = await retrySerializable(() =>
				drizzleTradingRepository.transaction(tracked.portfolioId, async (unitOfWork) => {
					const portfolio = await unitOfWork.getPortfolioForUpdate(
						tracked.portfolioId,
						tracked.ownerUserId
					);
					if (!portfolio || portfolio.status !== 'active') return true;
					const order = await unitOfWork.getOrderForUpdate(tracked.orderId);
					if (
						!order ||
						!ACTIVE_ORDER_STATUSES.includes(order.status as (typeof ACTIVE_ORDER_STATUSES)[number])
					) {
						return true;
					}
					if (
						!isDayOrderExpired({
							...order,
							delayMilliseconds,
							holidays,
							at
						})
					) {
						return false;
					}
					await this.#persistExpiry(unitOfWork, order, delayMilliseconds, holidays);
					return true;
				})
			);
			if (result) this.#removeTrackedOrder(tracked.orderId);
		} catch (error) {
			this.#reportError(`expire order ${tracked.orderId}`, error);
		}
	}

	async #persistExpiry(
		unitOfWork: Parameters<Parameters<typeof drizzleTradingRepository.transaction>[1]>[0],
		order: AcceptedOrder,
		delayMilliseconds: number,
		holidays: readonly MassiveMarketHoliday[]
	): Promise<void> {
		const expiresAt = dayOrderExpiration({
			acceptedAt: order.acceptedAt,
			delayMilliseconds,
			extendedHours: order.extendedHours,
			holidays
		});
		const previousStatus = order.status;
		const previousRevision = order.revision;
		const expired = transitionOrder(order, 'expired', { at: expiresAt });
		if (!(await unitOfWork.updateOrder(expired, previousRevision))) {
			throw new Error('Order changed during deterministic DAY expiry');
		}
		await unitOfWork.appendOrderEvent({
			orderId: order.id,
			fromStatus: previousStatus,
			toStatus: 'expired',
			at: expiresAt,
			reason: 'DAY order reached its deterministic US equity session boundary'
		});
		await unitOfWork.releaseOrderReservations(order.id, expiresAt);
	}

	#removeTrackedOrder(orderId: string): void {
		if (!this.#orders.delete(orderId)) return;
		this.#rebuildSymbolIndex();
		this.#syncSubscriptions();
		this.#pruneQuoteCache();
	}

	#reportError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (this.#lastReportedError.get(context) === message) return;
		this.#lastReportedError.set(context, message);
		console.error(`[live-order-execution] ${context}: ${message}`, error);
	}
}

const coordinatorSymbol = Symbol.for('trading-simulator.live-order-execution');
const coordinatorGlobal = globalThis as typeof globalThis & {
	[coordinatorSymbol]?: LiveOrderExecutionCoordinator;
};

export const liveOrderExecutionCoordinator =
	coordinatorGlobal[coordinatorSymbol] ?? new LiveOrderExecutionCoordinator();
coordinatorGlobal[coordinatorSymbol] = liveOrderExecutionCoordinator;

/** Starts the process-local matcher without awaiting database or provider availability. */
export function ensureLiveOrderExecutionStarted(): void {
	liveOrderExecutionCoordinator.start();
}

/** Requests an immediate debounced database/subscription refresh after an order commit. */
export function notifyOrdersChanged(): void {
	liveOrderExecutionCoordinator.notifyOrdersChanged();
}
