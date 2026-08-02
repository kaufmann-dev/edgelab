import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tradingJournalEntries } from '$lib/server/db/schema/trading';
import { loadLatestCompletedMinuteBar } from '$lib/server/market-bars';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import {
	supportsOptionsExecution,
	supportsStockSimulation,
	type Instrument,
	type NormalizedBar,
	type NormalizedQuote
} from '$lib/server/market-data';
import {
	getMassiveMarketHolidays,
	logicalMarketTime,
	orderAllowsSession,
	usEquitySessionAt
} from '$lib/server/market-session';
import { notifyOrdersChanged } from '$lib/server/live-order-execution';
import {
	getPortfolioPolicy,
	listPortfolioEquity,
	requirePortfolioReadAccess
} from '$lib/server/portfolio-read';
import {
	acceptedOrderMatchesDraft,
	applyFillToLedger,
	applyStrategyFill,
	calculateQuoteFill,
	createAcceptedOrder,
	drizzleTradingRepository,
	orderDraftSchema,
	previewOrder,
	transitionOrder,
	type AcceptedOrder,
	type ExecutableQuoteContext,
	type OrderDraft,
	type OrderPreview,
	type PortfolioAccountState,
	type RiskViolation,
	type TradingUnitOfWork,
	SIMULATION_EXECUTION_MODEL,
	SIMULATION_FEE_MODEL
} from '$lib/server/trading';

const MAX_EXECUTABLE_QUOTE_AGE_MILLISECONDS = 60_000;
const EXECUTABLE_QUOTE_FUTURE_TOLERANCE_MILLISECONDS = 1_000;

export interface ApplicationViolation {
	code: string;
	message: string;
	symbol?: string;
	severity: 'warning' | 'blocked';
}

export interface ApplicationOrderPreview {
	accepted: boolean;
	core: OrderPreview;
	violations: ApplicationViolation[];
}

export interface PlaceOrderResult {
	order: AcceptedOrder;
	preview: ApplicationOrderPreview | null;
	idempotent: boolean;
}

export class OrderApplicationError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly preview?: ApplicationOrderPreview
	) {
		super(message);
		this.name = 'OrderApplicationError';
	}
}

function symbolsForPositions(instruments: ReadonlyMap<string, Instrument>): string[] {
	return [
		...new Set(
			[...instruments.values()].flatMap((instrument) =>
				instrument.assetClass === 'options'
					? [instrument.symbol, instrument.underlyingSymbol]
					: [instrument.symbol]
			)
		)
	];
}

function assertedAssetClass(symbol: string): 'stocks' | 'options' {
	return symbol.startsWith('O:') ? 'options' : 'stocks';
}

function assertExecutableMarketAccess(draft: OrderDraft, dataMode: 'realtime' | 'delayed'): void {
	const capabilities = getMarketEnvironment().capabilities;
	const assetClasses = new Set(draft.legs.map((leg) => assertedAssetClass(leg.symbol)));
	for (const assetClass of assetClasses) {
		const capability = capabilities[assetClass];
		if (capability.executionMode !== dataMode) {
			throw new OrderApplicationError(
				`${assetClass === 'stocks' ? 'Stock' : 'Option'} market data does not match this portfolio's ${dataMode} clock.`,
				422
			);
		}
		const executable =
			assetClass === 'stocks'
				? supportsStockSimulation(capability)
				: supportsOptionsExecution(capabilities);
		if (!executable) {
			throw new OrderApplicationError(
				assetClass === 'stocks'
					? 'Stock simulation requires Massive snapshots, WebSockets, and second aggregates. Stocks Starter or better provides these capabilities.'
					: 'Option trading is disabled because the configured option plan does not provide the quote and trade feeds required by the execution model.',
				422
			);
		}
	}
	if (assetClasses.has('stocks') && draft.timeInForce === 'ioc') {
		throw new OrderApplicationError(
			'Immediate-or-cancel is unavailable for aggregate-priced stock orders. Use DAY or GTC.',
			422
		);
	}
	if (assetClasses.has('stocks') && draft.type === 'trailing_stop') {
		throw new OrderApplicationError(
			'Trailing-stop orders are unavailable for aggregate-priced stocks. Use a stop or stop-limit order.',
			422
		);
	}
}

async function resolveInstruments(draft: OrderDraft): Promise<Map<string, Instrument>> {
	const provider = getMarketDataProvider();
	const instruments = new Map<string, Instrument>();
	for (const leg of draft.legs) {
		let instrument: Instrument | undefined;
		if (leg.symbol.startsWith('O:')) {
			instrument = await provider.getOptionContract(leg.symbol);
		} else {
			const results = await provider.searchStocks(leg.symbol, 20);
			instrument = results.items.find(
				(candidate) => candidate.assetClass === 'stocks' && candidate.symbol === leg.symbol
			);
		}
		if (!instrument) {
			throw new OrderApplicationError(`Instrument ${leg.symbol} was not found.`, 404);
		}
		instruments.set(leg.symbol, instrument);
	}
	return instruments;
}

async function loadMarketMarks(input: {
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	at: Date;
}): Promise<{
	quotes: Map<string, NormalizedQuote>;
	bars: Map<string, NormalizedBar>;
}> {
	const provider = getMarketDataProvider();
	const environment = getMarketEnvironment();
	const singleLegPriceOrder =
		input.draft.legs.length === 1 && ['limit', 'stop_limit'].includes(input.draft.type);
	const referenceInstruments = singleLegPriceOrder ? [] : [...input.instruments.values()];
	const optionSymbols = referenceInstruments
		.filter((instrument) => instrument.assetClass === 'options')
		.map((instrument) => instrument.symbol);
	const stockInstruments = referenceInstruments.filter(
		(instrument) => instrument.assetClass === 'stocks'
	);
	const stockBarsPromise = (async () => {
		if (stockInstruments.length === 0) return [];
		const executionMode = environment.capabilities.stocks.executionMode;
		const delayMinutes = environment.capabilities.stocks.delayMinutes;
		if (!executionMode || delayMinutes === null) {
			throw new OrderApplicationError(
				'Stock aggregate pricing has no executable market-data clock.',
				503
			);
		}
		return Promise.all(
			stockInstruments.map(async (instrument) => ({
				symbol: instrument.symbol,
				bar: await loadLatestCompletedMinuteBar({
					provider,
					assetClass: 'stocks',
					symbol: instrument.symbol,
					mode: executionMode,
					delayMinutes,
					at: input.at
				})
			}))
		);
	})();
	const [optionSnapshots, stockBars] = await Promise.all([
		optionSymbols.length > 0
			? provider.getUnifiedSnapshots(optionSymbols)
			: Promise.resolve({ items: [] }),
		stockBarsPromise
	]);
	return {
		quotes: new Map(
			optionSnapshots.items.flatMap((snapshot) =>
				snapshot.quote ? [[snapshot.symbol, snapshot.quote]] : []
			)
		),
		bars: new Map(stockBars.flatMap(({ symbol, bar }) => (bar ? [[symbol, bar]] : [])))
	};
}

function quoteContextForOrder(input: {
	instruments: ReadonlyMap<string, Instrument>;
	expectedMode: 'realtime' | 'delayed';
	attemptAt: Date;
}): ExecutableQuoteContext {
	const capabilities = getMarketEnvironment().capabilities;
	const delays = new Set<number>();
	for (const instrument of input.instruments.values()) {
		const capability = capabilities[instrument.assetClass];
		if (capability.executionMode !== input.expectedMode) {
			throw new OrderApplicationError(
				`${instrument.assetClass} ${input.expectedMode} data is unavailable with the configured Massive plan.`,
				503
			);
		}
		if (capability.delayMinutes === null) {
			throw new OrderApplicationError(
				`${instrument.assetClass} has no executable market-data delay.`,
				503
			);
		}
		delays.add(capability.delayMinutes * 60 * 1_000);
	}
	if (delays.size !== 1) {
		throw new OrderApplicationError('Order legs do not share one logical market clock.', 422);
	}
	const [expectedDelayMilliseconds] = delays;
	if (expectedDelayMilliseconds === undefined) {
		throw new OrderApplicationError('Order has no executable market-data legs.', 422);
	}
	return {
		attemptAt: input.attemptAt,
		expectedMode: input.expectedMode,
		expectedDelayMilliseconds,
		maxTransportAgeMilliseconds: MAX_EXECUTABLE_QUOTE_AGE_MILLISECONDS,
		maxSourceAgeMilliseconds: MAX_EXECUTABLE_QUOTE_AGE_MILLISECONDS,
		futureToleranceMilliseconds: EXECUTABLE_QUOTE_FUTURE_TOLERANCE_MILLISECONDS,
		maxSourceSkewMilliseconds: MAX_EXECUTABLE_QUOTE_AGE_MILLISECONDS,
		maxReceiptSkewMilliseconds: MAX_EXECUTABLE_QUOTE_AGE_MILLISECONDS
	};
}

function orderCanExecuteInCurrentSession(input: {
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	quotes: ReadonlyMap<string, NormalizedQuote>;
	quoteContext: ExecutableQuoteContext;
	holidays: Awaited<ReturnType<typeof getMassiveMarketHolidays>>;
}): boolean {
	const allStockLegs = [...input.instruments.values()].every(
		(instrument) => instrument.assetClass === 'stocks'
	);
	const allowed = (at: Date) =>
		orderAllowsSession({
			session: usEquitySessionAt(at, input.holidays),
			extendedHours: input.draft.extendedHours,
			orderType: input.draft.type,
			allStockLegs
		});
	return (
		allowed(
			logicalMarketTime(input.quoteContext.attemptAt, input.quoteContext.expectedDelayMilliseconds)
		) &&
		input.draft.legs.every((leg) => {
			const quote = input.quotes.get(leg.symbol);
			return quote ? allowed(quote.sourceTime) : false;
		})
	);
}

async function validTradePlan(portfolioId: string, tradePlanId: string | undefined) {
	if (!tradePlanId) return false;
	const [plan] = await db
		.select({ id: tradingJournalEntries.id })
		.from(tradingJournalEntries)
		.where(
			and(
				eq(tradingJournalEntries.id, tradePlanId),
				eq(tradingJournalEntries.portfolioId, portfolioId),
				eq(tradingJournalEntries.phase, 'pre_trade')
			)
		)
		.limit(1);
	return Boolean(plan);
}

function coreViolationSeverity(
	violation: RiskViolation,
	riskBehavior: string
): ApplicationViolation['severity'] {
	return riskBehavior === 'warn' && violation.code === 'order_notional_limit'
		? 'warning'
		: 'blocked';
}

function policyViolation(
	code: string,
	message: string,
	riskBehavior: string,
	symbol?: string,
	forceBlock = false
): ApplicationViolation {
	return {
		code,
		message,
		symbol,
		severity: forceBlock || riskBehavior === 'block' ? 'blocked' : 'warning'
	};
}

async function addPolicyViolations(input: {
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	portfolio: Awaited<ReturnType<TradingUnitOfWork['getPortfolioForUpdate']>> & {};
	preview: OrderPreview;
	policy: NonNullable<Awaited<ReturnType<typeof getPortfolioPolicy>>>;
}): Promise<ApplicationViolation[]> {
	const { draft, instruments, portfolio, preview, policy } = input;
	const violations: ApplicationViolation[] = [];
	const behavior = policy.riskBehavior;

	if (draft.extendedHours && !policy.allowExtendedHours) {
		violations.push(
			policyViolation(
				'extended_hours_disabled',
				'Extended-hours trading is disabled for this portfolio.',
				behavior,
				undefined,
				true
			)
		);
	}
	const optionLegs = draft.legs.filter(
		(leg) => instruments.get(leg.symbol)?.assetClass === 'options'
	);
	if (draft.extendedHours && optionLegs.length > 0) {
		violations.push(
			policyViolation(
				'options_extended_hours_unsupported',
				'Options orders are limited to the regular US equity session.',
				behavior,
				undefined,
				true
			)
		);
	}
	if (
		optionLegs.some((leg) => leg.side === 'buy' && leg.positionEffect === 'open') &&
		!policy.allowLongOptions
	) {
		violations.push(
			policyViolation(
				'long_options_disabled',
				'Long options are disabled for this portfolio.',
				behavior,
				undefined,
				true
			)
		);
	}
	const openingShortOptions = optionLegs.filter(
		(leg) => leg.side === 'sell' && leg.positionEffect === 'open'
	);
	if (openingShortOptions.length > 0) {
		const spread = draft.legs.length > 1;
		if (spread && !policy.allowDefinedRiskSpreads) {
			violations.push(
				policyViolation(
					'defined_risk_spreads_disabled',
					'Defined-risk option spreads are disabled for this portfolio.',
					behavior,
					undefined,
					true
				)
			);
		}
		if (!spread && !policy.allowCoveredOptions) {
			violations.push(
				policyViolation(
					'covered_options_disabled',
					'Covered and cash-secured option writing is disabled for this portfolio.',
					behavior,
					undefined,
					true
				)
			);
		}
	}
	if (policy.requireTradePlan && !(await validTradePlan(draft.portfolioId, draft.tradePlanId))) {
		violations.push(
			policyViolation(
				'trade_plan_required',
				'Select a pre-trade journal entry before placing this order.',
				behavior,
				undefined,
				true
			)
		);
	} else if (draft.tradePlanId && !(await validTradePlan(draft.portfolioId, draft.tradePlanId))) {
		violations.push(
			policyViolation(
				'invalid_trade_plan',
				'The selected trade plan does not belong to this portfolio.',
				behavior,
				undefined,
				true
			)
		);
	}
	if (policy.maxOptionPremium) {
		const optionPremium = preview.legs
			.filter((leg) => leg.leg.instrument.assetClass === 'options' && leg.leg.side === 'buy')
			.reduce((total, leg) => total.plus(leg.grossAmount), new Decimal(0));
		if (optionPremium.greaterThan(policy.maxOptionPremium)) {
			violations.push(
				policyViolation(
					'option_premium_limit',
					'The order exceeds the portfolio option-premium limit.',
					behavior
				)
			);
		}
	}

	const equityAtCost = Decimal.max(portfolio.cashBalance, portfolio.startingCash);
	if (
		policy.maxPositionPercent &&
		preview.legs.some((leg) =>
			leg.grossAmount
				.div(equityAtCost)
				.times(100)
				.greaterThan(policy.maxPositionPercent as string)
		)
	) {
		violations.push(
			policyViolation(
				'position_size_limit',
				'The order exceeds the portfolio position-size limit.',
				behavior
			)
		);
	}
	if (
		policy.maxGrossExposurePercent &&
		preview.orderNotional.div(equityAtCost).times(100).greaterThan(policy.maxGrossExposurePercent)
	) {
		violations.push(
			policyViolation(
				'gross_exposure_limit',
				'The order exceeds the portfolio gross-exposure limit.',
				behavior
			)
		);
	}

	const equityHistory = await listPortfolioEquity(portfolio.id);
	const latest = equityHistory.at(-1);
	if (latest && policy.maxDailyLoss) {
		const day = latest.asOf.toISOString().slice(0, 10);
		const opening = equityHistory.find((row) => row.asOf.toISOString().startsWith(day));
		if (opening && new Decimal(opening.equity).minus(latest.equity).gt(policy.maxDailyLoss)) {
			violations.push(
				policyViolation(
					'daily_loss_limit',
					'The portfolio daily-loss limit has been reached.',
					behavior
				)
			);
		}
	}
	if (latest && policy.maxDrawdownPercent && equityHistory.length > 0) {
		const peak = Decimal.max(...equityHistory.map((row) => row.equity));
		const drawdown = peak.minus(latest.equity).div(peak).times(100);
		if (drawdown.greaterThan(policy.maxDrawdownPercent)) {
			violations.push(
				policyViolation(
					'drawdown_limit',
					'The portfolio drawdown limit has been reached.',
					behavior
				)
			);
		}
	}

	return violations;
}

async function evaluateInsideTransaction(input: {
	uow: TradingUnitOfWork;
	ownerUserId: string;
	draft: OrderDraft;
	instruments: ReadonlyMap<string, Instrument>;
	quotes: ReadonlyMap<string, NormalizedQuote>;
	bars: ReadonlyMap<string, NormalizedBar>;
	quoteAttemptAt: Date;
	lockedPortfolio?: NonNullable<Awaited<ReturnType<TradingUnitOfWork['getPortfolioForUpdate']>>>;
}): Promise<{
	portfolio: NonNullable<Awaited<ReturnType<TradingUnitOfWork['getPortfolioForUpdate']>>>;
	account: PortfolioAccountState;
	preview: ApplicationOrderPreview;
	quoteContext: ExecutableQuoteContext;
}> {
	const { uow, ownerUserId, draft, instruments, quotes, bars } = input;
	const portfolio =
		input.lockedPortfolio ?? (await uow.getPortfolioForUpdate(draft.portfolioId, ownerUserId));
	if (!portfolio || portfolio.status !== 'active') {
		throw new OrderApplicationError('Portfolio not found.', 404);
	}
	const policy = await getPortfolioPolicy(portfolio.id);
	if (!policy) throw new OrderApplicationError('Portfolio risk policy is missing.', 500);
	const positionSymbols = symbolsForPositions(instruments);
	const [positions, riskState] = await Promise.all([
		uow.getPositionsForUpdate(portfolio.id, positionSymbols),
		uow.getRiskStateForUpdate(portfolio.id, ownerUserId, positionSymbols)
	]);
	if (!riskState) throw new OrderApplicationError('Portfolio not found.', 404);

	const account: PortfolioAccountState = {
		portfolioId: portfolio.id,
		cashBalance: portfolio.cashBalance,
		reservedCash: portfolio.reservedCash,
		positions,
		reservedPositionQuantities: riskState.reservedPositionQuantities,
		openOrderCount: riskState.openOrderCount,
		riskPolicy: {
			allowShortStock: policy.allowShortEquity,
			allowNakedOptions: false,
			maxOrderNotional:
				policy.maxOrderNotional === null ? undefined : new Decimal(policy.maxOrderNotional),
			maxOpenOrders: 100,
			maxOptionContractsPerOrder: 100,
			quoteMaxAgeMilliseconds: 60_000
		}
	};
	const quoteContext = quoteContextForOrder({
		instruments,
		expectedMode: portfolio.dataMode,
		attemptAt: input.quoteAttemptAt
	});
	const core = previewOrder({
		draft,
		instruments,
		quotes,
		bars,
		account,
		executionModel: SIMULATION_EXECUTION_MODEL,
		quoteContext,
		feeModel: SIMULATION_FEE_MODEL
	});
	const violations: ApplicationViolation[] = core.violations.map((violation) => ({
		...violation,
		severity: coreViolationSeverity(violation, policy.riskBehavior)
	}));
	violations.push(
		...(await addPolicyViolations({ draft, instruments, portfolio, preview: core, policy }))
	);
	const marketModes = new Set([
		...quotes.values().map((quote) => quote.mode),
		...bars.values().map((bar) => bar.mode)
	]);
	if (marketModes.size > 0 && [...marketModes].some((mode) => mode !== portfolio.dataMode)) {
		violations.push({
			code: 'data_mode_mismatch',
			message: `This portfolio requires ${portfolio.dataMode} data, but the provider returned ${[...marketModes].join('/')}.`,
			severity: 'blocked'
		});
	}
	const preview = {
		accepted: violations.every((violation) => violation.severity !== 'blocked'),
		core,
		violations
	};
	return { portfolio, account, preview, quoteContext };
}

export async function previewSimulationOrder(input: {
	ownerUserId: string;
	draft: unknown;
}): Promise<ApplicationOrderPreview> {
	const draft = orderDraftSchema.parse(input.draft);
	const portfolio = await requirePortfolioReadAccess(input.ownerUserId, draft.portfolioId);
	if (!portfolio) {
		throw new OrderApplicationError('Portfolio not found.', 404);
	}
	assertExecutableMarketAccess(draft, portfolio.dataMode);
	const instruments = await resolveInstruments(draft);
	const marketRequestAt = new Date();
	const { quotes, bars } = await loadMarketMarks({ draft, instruments, at: marketRequestAt });
	const quoteAttemptAt = new Date();
	return drizzleTradingRepository.transaction(draft.portfolioId, async (uow) => {
		const result = await evaluateInsideTransaction({
			uow,
			ownerUserId: input.ownerUserId,
			draft,
			instruments,
			quotes,
			bars,
			quoteAttemptAt
		});
		return result.preview;
	});
}

export async function placeSimulationOrder(input: {
	ownerUserId: string;
	draft: unknown;
}): Promise<PlaceOrderResult> {
	const draft = orderDraftSchema.parse(input.draft);
	const beforeMarketData = await drizzleTradingRepository.transaction(
		draft.portfolioId,
		async (uow) => {
			const portfolio = await uow.getPortfolioForUpdate(draft.portfolioId, input.ownerUserId);
			if (!portfolio || portfolio.status !== 'active') {
				throw new OrderApplicationError('Portfolio not found.', 404);
			}
			return {
				portfolio,
				existing: await uow.findOrderByClientId(draft.portfolioId, draft.clientOrderId)
			};
		}
	);
	if (beforeMarketData.existing) {
		if (!acceptedOrderMatchesDraft(beforeMarketData.existing, draft)) {
			throw new OrderApplicationError(
				'Client order ID is already used for a different order.',
				409
			);
		}
		return { order: beforeMarketData.existing, preview: null, idempotent: true };
	}
	assertExecutableMarketAccess(draft, beforeMarketData.portfolio.dataMode);
	const acceptedAt = new Date();
	const instruments = await resolveInstruments(draft);
	const marketRequestAt = new Date();
	const { quotes, bars } = await loadMarketMarks({ draft, instruments, at: marketRequestAt });
	const quoteAttemptAt = new Date();
	const quoteExecutable = [...instruments.values()].every(
		(instrument) => instrument.assetClass === 'options'
	);
	const holidays = quoteExecutable
		? await getMassiveMarketHolidays(quoteAttemptAt).catch((error: unknown) => {
				throw new OrderApplicationError(
					`The market calendar is unavailable: ${error instanceof Error ? error.message : 'unknown provider error'}`,
					503
				);
			})
		: [];

	const result = await drizzleTradingRepository.transaction(draft.portfolioId, async (uow) => {
		const lockedPortfolio = await uow.getPortfolioForUpdate(draft.portfolioId, input.ownerUserId);
		if (!lockedPortfolio || lockedPortfolio.status !== 'active') {
			throw new OrderApplicationError('Portfolio not found.', 404);
		}
		const existing = await uow.findOrderByClientId(draft.portfolioId, draft.clientOrderId);
		if (existing) {
			if (!acceptedOrderMatchesDraft(existing, draft)) {
				throw new OrderApplicationError(
					'Client order ID is already used for a different order.',
					409
				);
			}
			return { order: existing, preview: null, idempotent: true };
		}
		const evaluated = await evaluateInsideTransaction({
			uow,
			ownerUserId: input.ownerUserId,
			draft,
			instruments,
			quotes,
			bars,
			quoteAttemptAt,
			lockedPortfolio
		});
		if (!evaluated.preview.accepted) {
			throw new OrderApplicationError(
				'Order failed portfolio risk checks.',
				422,
				evaluated.preview
			);
		}

		let order = createAcceptedOrder({
			id: crypto.randomUUID(),
			draft,
			instruments,
			acceptedAt,
			latencyMilliseconds: SIMULATION_EXECUTION_MODEL.latencyMilliseconds,
			executionModelVersion: SIMULATION_EXECUTION_MODEL.version
		});
		await uow.insertOrder(order);
		await uow.appendOrderEvent({
			orderId: order.id,
			toStatus: 'open',
			at: acceptedAt,
			reason: 'Accepted after portfolio risk validation'
		});
		await uow.insertOrderReservations({
			orderId: order.id,
			portfolioId: order.portfolioId,
			cashAmount: evaluated.preview.core.cashRequired,
			shareQuantities: evaluated.preview.core.shareCollateral
		});

		const fill =
			quoteExecutable &&
			orderCanExecuteInCurrentSession({
				draft,
				instruments,
				quotes,
				quoteContext: evaluated.quoteContext,
				holidays
			})
				? calculateQuoteFill({
						order,
						quotes,
						executionModel: SIMULATION_EXECUTION_MODEL,
						quoteContext: evaluated.quoteContext,
						feeModel: SIMULATION_FEE_MODEL
					})
				: undefined;
		if (fill) {
			const remainingQuantityBeforeFill = order.quantity.minus(order.filledQuantity);
			const fillId = crypto.randomUUID();
			const applied = applyFillToLedger({
				account: {
					portfolioId: order.portfolioId,
					cashBalance: evaluated.account.cashBalance,
					positions: evaluated.account.positions
				},
				fill,
				fillId,
				entryId: () => crypto.randomUUID()
			});
			const priorStatus = order.status;
			const priorRevision = order.revision;
			order = applyStrategyFill(order, fill.strategyQuantity, fill.receivedAt);
			await uow.insertFill({ id: fillId, fill });
			await uow.insertLedgerEntries(applied.entries);
			await uow.upsertPositions(order.portfolioId, applied.positionChanges);
			if (!(await uow.updateOrder(order, priorRevision))) {
				throw new OrderApplicationError('Order changed during execution.', 409);
			}
			await uow.appendOrderEvent({
				orderId: order.id,
				fromStatus: priorStatus,
				toStatus: order.status,
				at: fill.receivedAt,
				reason: 'Filled by the quote execution model'
			});
			await uow.consumeOrderReservations({
				orderId: order.id,
				fillQuantity: fill.strategyQuantity,
				remainingQuantityBeforeFill,
				consumedAt: fill.receivedAt
			});
		}

		if (order.timeInForce === 'ioc' && ['open', 'partially_filled'].includes(order.status)) {
			const canceledAt = new Date();
			const priorStatus = order.status;
			const priorRevision = order.revision;
			order = transitionOrder(order, 'canceled', { at: canceledAt });
			if (!(await uow.updateOrder(order, priorRevision))) {
				throw new OrderApplicationError('Order changed during IOC cancellation.', 409);
			}
			await uow.appendOrderEvent({
				orderId: order.id,
				fromStatus: priorStatus,
				toStatus: order.status,
				at: canceledAt,
				reason: 'Immediate-or-cancel remainder canceled after the first execution attempt'
			});
			await uow.releaseOrderReservations(order.id);
		}

		return { order, preview: evaluated.preview, idempotent: false };
	});
	if (!result.idempotent && ['open', 'partially_filled'].includes(result.order.status)) {
		notifyOrdersChanged();
	}
	return result;
}

export function serializeApplicationPreview(preview: ApplicationOrderPreview) {
	return {
		accepted: preview.accepted,
		estimatedNetCashChange: preview.core.estimatedNetCashChange.toString(),
		cashRequired: preview.core.cashRequired.toString(),
		optionCollateral: preview.core.optionCollateral.toString(),
		orderNotional: preview.core.orderNotional.toString(),
		fees: preview.core.fees.toString(),
		legs: preview.core.legs.map((leg) => ({
			symbol: leg.leg.symbol,
			quantity: leg.quantity.toString(),
			referencePrice: leg.referencePrice.toString(),
			grossAmount: leg.grossAmount.toString(),
			fee: leg.fee.toString()
		})),
		violations: preview.violations
	};
}

export function serializePlacedOrder(result: PlaceOrderResult) {
	return {
		id: result.order.id,
		clientOrderId: result.order.clientOrderId,
		status: result.order.status,
		filledQuantity: result.order.filledQuantity.toString(),
		quantity: result.order.quantity.toString(),
		acceptedAt: result.order.acceptedAt.toISOString(),
		terminalAt: result.order.terminalAt?.toISOString(),
		idempotent: result.idempotent,
		preview: result.preview ? serializeApplicationPreview(result.preview) : null
	};
}
