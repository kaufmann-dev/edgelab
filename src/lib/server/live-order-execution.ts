import Decimal from 'decimal.js';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
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
	type MassiveCapabilitySet,
	type MassiveMarketHoliday,
	type MarketDataMode,
	type NormalizedBar,
	type NormalizedMarketEvent,
	supportsOptionsExecution,
	supportsStockSimulation
} from '$lib/server/market-data';
import { getMarketEnvironment } from '$lib/server/market';
import {
	dayOrderExpiration,
	getMassiveMarketHolidays,
	orderAllowsSession,
	usEquityMarketDate,
	usEquitySessionAt
} from '$lib/server/market-session';
import { marketStreamHub } from '$lib/server/market-stream';
import {
	SIMULATION_EXECUTION_MODEL,
	SIMULATION_FEE_MODEL,
	applyFillToLedger,
	applyStrategyFill,
	calculateBarFill,
	drizzleTradingRepository,
	fillGrossAmount,
	orderTypeSchema,
	timeInForceSchema,
	transitionOrder,
	validateExecutableBar,
	type AcceptedOrder,
	type ExecutableBarContext,
	type OrderType,
	type StrategyFill,
	type TimeInForce
} from '$lib/server/trading';

const REFRESH_INTERVAL_MILLISECONDS = 15_000;
const MAX_BAR_AGE_MILLISECONDS = 60_000;
const BAR_ARRIVAL_GRACE_MILLISECONDS = 5_000;
const SERIALIZATION_RETRY_DELAYS = [0, 25, 100] as const;
const ACTIVE_ORDER_STATUSES = ['open', 'partially_filled'] as const;
const STOCK_AGGREGATE_ORDER_TYPES = new Set<OrderType>(['market', 'limit', 'stop', 'stop_limit']);

export interface LiveOrderTopicLeg {
	symbol: string;
	assetClass: AssetClass;
	ratioQuantity: Decimal;
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
	executionModelVersion: string;
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
	arrivalGraceMilliseconds?: number;
}): boolean {
	return (
		input.timeInForce === 'day' &&
		input.at.getTime() >=
			dayOrderExpiration({
				acceptedAt: input.acceptedAt,
				delayMilliseconds: input.delayMilliseconds,
				extendedHours: input.extendedHours,
				holidays: input.holidays
			}).getTime() +
				(input.arrivalGraceMilliseconds ?? 0)
	);
}

export function supportsLiveAggregateOrder(
	order: Pick<LiveOrderTopicInput, 'orderType' | 'timeInForce' | 'legs'>
): boolean {
	if (order.timeInForce === 'ioc' || order.legs.length !== 1) return false;
	const leg = order.legs[0];
	if (!leg?.ratioQuantity.equals(1)) return false;
	return (
		(leg.assetClass === 'stocks' && STOCK_AGGREGATE_ORDER_TYPES.has(order.orderType)) ||
		(leg.assetClass === 'options' && order.orderType === 'limit' && order.timeInForce === 'day')
	);
}

export function liveOrderDelayMilliseconds(
	order: Pick<LiveOrderTopicInput, 'dataMode' | 'legs'>,
	capabilities: MassiveCapabilitySet
): number | undefined {
	if (order.legs.length === 0) return undefined;
	const delays = new Set<number>();
	for (const leg of order.legs) {
		const capability = capabilities[leg.assetClass];
		const supported =
			leg.assetClass === 'stocks'
				? supportsStockSimulation(capability)
				: supportsOptionsExecution(capabilities);
		if (
			!supported ||
			capability.executionMode !== order.dataMode ||
			capability.delayMinutes === null ||
			(order.dataMode === 'realtime' ? capability.delayMinutes !== 0 : capability.delayMinutes <= 0)
		) {
			return undefined;
		}
		delays.add(capability.delayMinutes * 60 * 1_000);
	}
	if (delays.size !== 1) return undefined;
	return delays.values().next().value;
}

function isLiveOrderCompatible(
	order: LiveOrderTopicInput,
	capabilities: MassiveCapabilitySet
): boolean {
	return (
		supportsLiveAggregateOrder(order) &&
		liveOrderDelayMilliseconds(order, capabilities) !== undefined
	);
}

export function shouldEvaluateAggregateBar(input: {
	bar: NormalizedBar;
	barContext: ExecutableBarContext;
	eligibleAt: Date;
	lastEvaluatedBarEndAt?: Date;
}): boolean {
	if (input.lastEvaluatedBarEndAt && input.bar.endTime <= input.lastEvaluatedBarEndAt) {
		return false;
	}
	return validateExecutableBar(input.bar, input.barContext, input.eligibleAt).executable;
}

export function hasOptionLegAtOrPastExpiration(
	legs: readonly Pick<AcceptedOrder['legs'][number], 'instrument'>[],
	marketAt: Date
): boolean {
	const marketDate = usEquityMarketDate(marketAt);
	return legs.some(
		(leg) => leg.instrument.assetClass === 'options' && leg.instrument.expirationDate <= marketDate
	);
}

export function planLiveOrderTopics(orders: readonly LiveOrderTopicInput[]): LiveOrderTopicPlan {
	const topics: Record<MarketDataMode, Record<AssetClass, Set<string>>> = {
		realtime: { stocks: new Set<string>(), options: new Set<string>() },
		delayed: { stocks: new Set<string>(), options: new Set<string>() }
	};
	for (const order of orders) {
		if (!supportsLiveAggregateOrder(order)) continue;
		const leg = order.legs[0];
		if (!leg) continue;
		topics[order.dataMode][leg.assetClass].add(`A.${leg.symbol}`);
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

export class LiveOrderExecutionCoordinator {
	readonly #orders = new Map<string, TrackedOrder>();
	readonly #orderIdsBySymbol = new Map<string, Set<string>>();
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
		const capabilities = getMarketEnvironment().capabilities;
		const discovered = await this.#loadOpenOrders();
		this.#lastReportedError.delete('refresh');
		this.#orders.clear();
		for (const order of discovered) this.#orders.set(order.orderId, order);
		for (const order of [...this.#orders.values()].sort(compareTrackedOrders)) {
			if (
				order.executionModelVersion !== SIMULATION_EXECUTION_MODEL.version ||
				!isLiveOrderCompatible(order, capabilities)
			) {
				await this.#cancelUnsupportedOrder(order, now);
				continue;
			}
			if (order.timeInForce === 'day') await this.#expireOrder(order, now);
		}
		this.#rebuildSymbolIndex();
		this.#syncSubscriptions();
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
					executionModelVersion: tradingOrders.executionModelVersion,
					orderType: tradingOrders.orderType,
					timeInForce: tradingOrders.timeInForce,
					legNumber: tradingOrderLegs.legNumber,
					ratioQuantity: tradingOrderLegs.ratioQuantity,
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
					assetClass: assetClassSchema.parse(row.assetClass),
					ratioQuantity: new Decimal(row.ratioQuantity)
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
					executionModelVersion: row.executionModelVersion,
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
		const capabilities = getMarketEnvironment().capabilities;
		for (const order of this.#orders.values()) {
			if (
				order.executionModelVersion !== SIMULATION_EXECUTION_MODEL.version ||
				!isLiveOrderCompatible(order, capabilities)
			) {
				continue;
			}
			for (const leg of order.legs) {
				const key = eventKey(leg.assetClass, leg.symbol);
				const ids = this.#orderIdsBySymbol.get(key) ?? new Set<string>();
				ids.add(order.orderId);
				this.#orderIdsBySymbol.set(key, ids);
			}
		}
	}

	#syncSubscriptions(): void {
		const capabilities = getMarketEnvironment().capabilities;
		const plan = planLiveOrderTopics(
			[...this.#orders.values()].filter(
				(order) =>
					order.executionModelVersion === SIMULATION_EXECUTION_MODEL.version &&
					isLiveOrderCompatible(order, capabilities)
			)
		);
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

	async #processEvent(event: NormalizedMarketEvent): Promise<void> {
		if (event.kind !== 'bar' || event.interval !== 'second') return;
		const ids = this.#orderIdsBySymbol.get(eventKey(event.assetClass, event.symbol));
		if (!ids) return;
		const orders = [...ids]
			.map((id) => this.#orders.get(id))
			.filter((order): order is TrackedOrder => order !== undefined)
			.sort(compareTrackedOrders);
		const capabilities = getMarketEnvironment().capabilities;
		for (const tracked of orders) {
			if (
				tracked.executionModelVersion !== SIMULATION_EXECUTION_MODEL.version ||
				!isLiveOrderCompatible(tracked, capabilities)
			) {
				await this.#cancelUnsupportedOrder(tracked, event.receivedAt);
				continue;
			}
			try {
				const result = await retrySerializable(() => this.#processOrder(tracked, event));
				if (result.terminal) this.#removeTrackedOrder(tracked.orderId);
			} catch (error) {
				if (isDuplicateSourceFill(error)) continue;
				this.#reportError(`order ${tracked.orderId}`, error);
			}
		}
	}

	async #processOrder(tracked: TrackedOrder, event: NormalizedBar): Promise<OrderProcessingResult> {
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
			const topicOrder: LiveOrderTopicInput = {
				orderType: order.type,
				timeInForce: order.timeInForce,
				dataMode: portfolio.dataMode,
				legs: order.legs.map((leg) => ({
					symbol: leg.symbol,
					assetClass: leg.instrument.assetClass,
					ratioQuantity: leg.ratioQuantity
				}))
			};
			const capabilities = getMarketEnvironment().capabilities;
			const delayMilliseconds = liveOrderDelayMilliseconds(topicOrder, capabilities);
			if (
				order.executionModelVersion !== SIMULATION_EXECUTION_MODEL.version ||
				!supportsLiveAggregateOrder(topicOrder) ||
				delayMilliseconds === undefined
			) {
				const previousStatus = order.status;
				const previousRevision = order.revision;
				const canceled = transitionOrder(order, 'canceled', { at: event.receivedAt });
				if (!(await unitOfWork.updateOrder(canceled, previousRevision))) {
					throw new Error('Order changed during compatibility cancellation');
				}
				await unitOfWork.appendOrderEvent({
					orderId: order.id,
					fromStatus: previousStatus,
					toStatus: 'canceled',
					at: event.receivedAt,
					reason: 'Canceled because current Massive access cannot safely execute the order'
				});
				await unitOfWork.releaseOrderReservations(order.id, event.receivedAt);
				return { terminal: true };
			}
			if (portfolio.dataMode !== event.mode) return { terminal: false };
			if (hasOptionLegAtOrPastExpiration(order.legs, event.startTime)) {
				const previousStatus = order.status;
				const previousRevision = order.revision;
				const canceled = transitionOrder(order, 'canceled', { at: event.receivedAt });
				if (!(await unitOfWork.updateOrder(canceled, previousRevision))) {
					throw new Error('Order changed during option-expiration cancellation');
				}
				await unitOfWork.appendOrderEvent({
					orderId: order.id,
					fromStatus: previousStatus,
					toStatus: 'canceled',
					at: event.receivedAt,
					reason: 'Canceled because option contracts cannot fill on or after expiration day'
				});
				await unitOfWork.releaseOrderReservations(order.id, event.receivedAt);
				return { terminal: true };
			}

			if (
				isDayOrderExpired({
					...order,
					delayMilliseconds,
					arrivalGraceMilliseconds: this.#arrivalGraceMilliseconds(order.legs),
					holidays,
					at: event.receivedAt
				})
			) {
				await this.#persistExpiry(unitOfWork, order, delayMilliseconds, holidays);
				return { terminal: true };
			}
			if (!this.#orderAllowsEvent(order, event, holidays)) {
				return { terminal: false };
			}

			const barContext = {
				attemptAt: event.receivedAt,
				expectedMode: portfolio.dataMode,
				expectedDelayMilliseconds: delayMilliseconds,
				maxTransportAgeMilliseconds: MAX_BAR_AGE_MILLISECONDS,
				maxSourceAgeMilliseconds: MAX_BAR_AGE_MILLISECONDS,
				futureToleranceMilliseconds: 0
			};
			if (
				!shouldEvaluateAggregateBar({
					bar: event,
					barContext,
					eligibleAt: order.eligibleAt,
					lastEvaluatedBarEndAt: order.lastEvaluatedBarEndAt
				})
			) {
				return { terminal: false };
			}
			const evaluation = calculateBarFill({
				order,
				bar: event,
				executionModel: SIMULATION_EXECUTION_MODEL,
				barContext,
				feeModel: SIMULATION_FEE_MODEL
			});
			const newlyTriggered = evaluation.triggered && !order.triggeredAt;
			const cursorRevision = order.revision;
			order = {
				...order,
				triggeredAt: newlyTriggered ? event.sourceTime : order.triggeredAt,
				lastEvaluatedBarEndAt: event.endTime,
				revision: cursorRevision + 1
			};
			if (!(await unitOfWork.updateOrder(order, cursorRevision))) {
				throw new Error('Order changed while its aggregate cursor was being updated');
			}
			if (newlyTriggered) {
				await unitOfWork.appendOrderEvent({
					orderId: order.id,
					fromStatus: order.status,
					toStatus: order.status,
					at: event.sourceTime,
					reason: 'Triggered by a matching first-seen aggregate bar'
				});
			}
			const fill: StrategyFill | undefined = evaluation.fill;
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
				const previousRevision = order.revision;
				const canceled = transitionOrder(order, 'canceled', {
					at: event.receivedAt,
					reason: 'Aggregate execution exceeded available cash'
				});
				if (!(await unitOfWork.updateOrder(canceled, previousRevision))) {
					throw new Error('Order changed during aggregate funding cancellation');
				}
				await unitOfWork.appendOrderEvent({
					orderId: order.id,
					fromStatus: order.status,
					toStatus: 'canceled',
					at: event.receivedAt,
					reason: 'Canceled because the aggregate fill exceeded available cash'
				});
				await unitOfWork.releaseOrderReservations(order.id, event.receivedAt);
				return { terminal: true };
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
				reason: 'Filled by the first-seen aggregate execution model'
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

	#delayMilliseconds(
		legs: readonly (LiveOrderTopicLeg | AcceptedOrder['legs'][number])[],
		dataMode: MarketDataMode
	): number {
		const capabilities = getMarketEnvironment().capabilities;
		const delay = liveOrderDelayMilliseconds(
			{
				dataMode,
				legs: legs.map((leg) => ({
					symbol: leg.symbol,
					assetClass: 'instrument' in leg ? leg.instrument.assetClass : leg.assetClass,
					ratioQuantity: leg.ratioQuantity
				}))
			},
			capabilities
		);
		if (delay === undefined) {
			throw new Error('Order market-data access is incompatible with the configured Massive plan');
		}
		return delay;
	}

	#arrivalGraceMilliseconds(
		legs: readonly (LiveOrderTopicLeg | AcceptedOrder['legs'][number])[]
	): number {
		return legs.length === 1 ? BAR_ARRIVAL_GRACE_MILLISECONDS : 0;
	}

	#orderAllowsEvent(
		order: AcceptedOrder,
		event: NormalizedBar,
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
		return allowed(event.startTime);
	}

	async #cancelUnsupportedOrder(tracked: TrackedOrder, at: Date): Promise<void> {
		try {
			const terminal = await retrySerializable(() =>
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
					const previousStatus = order.status;
					const previousRevision = order.revision;
					const canceled = transitionOrder(order, 'canceled', { at });
					if (!(await unitOfWork.updateOrder(canceled, previousRevision))) {
						throw new Error('Order changed during aggregate compatibility cancellation');
					}
					await unitOfWork.appendOrderEvent({
						orderId: order.id,
						fromStatus: previousStatus,
						toStatus: 'canceled',
						at,
						reason:
							'Canceled because current Massive access or the aggregate execution model is incompatible with the order'
					});
					await unitOfWork.releaseOrderReservations(order.id, at);
					return true;
				})
			);
			if (terminal) this.#removeTrackedOrder(tracked.orderId);
		} catch (error) {
			this.#reportError(`cancel unsupported order ${tracked.orderId}`, error);
		}
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
							arrivalGraceMilliseconds: this.#arrivalGraceMilliseconds(order.legs),
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
