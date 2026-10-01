import Decimal from 'decimal.js';
import type {
	EquityCurvePoint,
	MarketFeedState,
	MetricItem,
	OrderRow,
	PositionRow
} from '#lib/components/trading/types.js';
import { completedMinuteEnd, loadLatestCompletedMinuteBar } from '#lib/server/market-bars.js';
import { getMarketDataProvider, getMarketEnvironment } from '#lib/server/market.js';
import {
	MassiveHttpError,
	type AssetCapabilities,
	type AssetClass,
	type MassiveCapabilitySet,
	type MarketDataMode,
	type MarketDataRestProvider,
	type MarketSnapshot,
	type NormalizedBar
} from '#lib/server/market-data/index.js';
import type {
	OrderRecord,
	PortfolioValuation,
	PositionRecord
} from '#lib/server/portfolio-read.js';

const AGGREGATE_REQUEST_CONCURRENCY = 8;

interface PositionViewInput {
	positions: PositionRecord[];
	cashBalance: string;
	reservedCash: string;
	realizedPnl: string;
	benchmarkSymbol?: string;
	valuationTime?: Date;
}

export interface PositionViewResult {
	positions: PositionRow[];
	metrics: MetricItem[];
	marketFeed: {
		state: MarketFeedState;
		modeLabel: string;
		asOf: string;
	} | null;
	marketError: string | null;
	valuation: PortfolioValuation | null;
	benchmarkPrice: Decimal | null;
}

interface MarkObservation {
	price: Decimal;
	mode: MarketDataMode;
	asOf: Date;
	source: 'snapshot_minute' | 'quote' | 'trade' | 'completed_minute';
}

interface MarketSymbol {
	assetClass: AssetClass;
	symbol: string;
}

function marketSymbolKey(assetClass: AssetClass, symbol: string): string {
	return `${assetClass}:${symbol}`;
}

function minuteMark(
	snapshot: MarketSnapshot,
	capability: AssetCapabilities,
	valuationTime: Date
): MarkObservation | null {
	const bar = snapshot.lastMinute;
	if (
		!capability.minuteBars ||
		capability.delayMinutes === null ||
		!bar ||
		bar.assetClass !== snapshot.assetClass ||
		bar.symbol !== snapshot.symbol ||
		bar.mode !== capability.executionMode ||
		bar.interval !== 'minute' ||
		bar.sourceTime.getTime() !== bar.endTime.getTime() ||
		bar.endTime > completedMinuteEnd(valuationTime, capability.delayMinutes) ||
		!bar.close.greaterThan(0)
	) {
		return null;
	}

	return {
		price: bar.close,
		mode: bar.mode,
		asOf: bar.endTime,
		source: 'snapshot_minute'
	};
}

function quoteMark(
	snapshot: MarketSnapshot,
	capability: AssetCapabilities
): MarkObservation | null {
	if (
		capability.quotes &&
		snapshot.quote &&
		snapshot.quote.assetClass === snapshot.assetClass &&
		snapshot.quote.symbol === snapshot.symbol &&
		snapshot.quote.mode === capability.executionMode &&
		snapshot.quote.bidPrice.greaterThan(0) &&
		snapshot.quote.askPrice.greaterThan(0) &&
		snapshot.quote.bidPrice.lessThanOrEqualTo(snapshot.quote.askPrice)
	) {
		return {
			price: snapshot.quote.bidPrice.plus(snapshot.quote.askPrice).dividedBy(2),
			mode: snapshot.quote.mode,
			asOf: snapshot.quote.sourceTime,
			source: 'quote'
		};
	}
	return null;
}

function tradeMark(
	snapshot: MarketSnapshot,
	capability: AssetCapabilities
): MarkObservation | null {
	const trade = snapshot.lastTrade;
	if (
		!capability.trades ||
		!trade ||
		trade.assetClass !== snapshot.assetClass ||
		trade.symbol !== snapshot.symbol ||
		trade.mode !== capability.executionMode ||
		!trade.price.greaterThan(0)
	) {
		return null;
	}

	return {
		price: trade.price,
		mode: trade.mode,
		asOf: trade.sourceTime,
		source: 'trade'
	};
}

function markFromSnapshot(
	snapshot: MarketSnapshot,
	capability: AssetCapabilities,
	valuationTime: Date
): MarkObservation | null {
	const minute = minuteMark(snapshot, capability, valuationTime);
	if (snapshot.assetClass === 'stocks' && minute) return minute;
	return quoteMark(snapshot, capability) ?? tradeMark(snapshot, capability) ?? minute;
}

function markFromCompletedMinute(bar: NormalizedBar): MarkObservation {
	return {
		price: bar.close,
		mode: bar.mode,
		asOf: bar.endTime,
		source: 'completed_minute'
	};
}

function metricTone(value: Decimal): MetricItem['tone'] {
	return value.greaterThan(0) ? 'positive' : value.lessThan(0) ? 'negative' : 'default';
}

function currency(value: Decimal): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 2
	}).format(value.toNumber());
}

function modeLabel(modes: Set<string>): string {
	if (modes.size === 0) return 'Unavailable';
	if (modes.size === 1) return modes.has('realtime') ? 'REAL-TIME' : '15 MIN DELAYED';
	return 'MIXED FRESHNESS';
}

function isMarketDataAccessFailure(cause: unknown): cause is MassiveHttpError {
	return cause instanceof MassiveHttpError && (cause.status === 401 || cause.status === 403);
}

async function loadSnapshotBatches(
	provider: MarketDataRestProvider,
	symbols: readonly string[]
): Promise<MarketSnapshot[]> {
	const snapshots: MarketSnapshot[] = [];
	for (let index = 0; index < symbols.length; index += 250) {
		snapshots.push(
			...(await provider.getUnifiedSnapshots(symbols.slice(index, index + 250))).items
		);
	}
	return snapshots;
}

export async function buildPositionView(input: PositionViewInput): Promise<PositionViewResult> {
	const cashBalance = new Decimal(input.cashBalance);
	const reservedCash = new Decimal(input.reservedCash);
	const benchmarkSymbol = input.benchmarkSymbol?.trim().toUpperCase() || null;
	const valuationTime = input.valuationTime ?? new Date();
	let snapshots: MarketSnapshot[] = [];
	let markRequestFailed = false;
	let marketError: string | null = null;
	const marksBySymbol = new Map<string, MarkObservation>();

	if (input.positions.length > 0 || benchmarkSymbol) {
		try {
			const environment = getMarketEnvironment();
			const capabilities: MassiveCapabilitySet = environment.capabilities;
			const requiredAssetClasses = new Set(input.positions.map((position) => position.assetClass));
			const unavailable = [...requiredAssetClasses].filter(
				(assetClass) => !capabilities[assetClass].snapshots
			);
			if (unavailable.length > 0) {
				marketError = `${unavailable.join(' and ')} snapshots are not included in the configured Massive plan.`;
			}

			const positionMarketSymbols = [
				...new Map(
					input.positions
						.filter((position) => capabilities[position.assetClass].snapshots)
						.map((position) => [
							marketSymbolKey(position.assetClass, position.symbol),
							{ assetClass: position.assetClass, symbol: position.symbol } satisfies MarketSymbol
						])
				).values()
			];
			const positionSymbols = [...new Set(positionMarketSymbols.map(({ symbol }) => symbol))];
			const benchmarkRequestSymbol = capabilities.stocks.snapshots ? benchmarkSymbol : null;
			const requestedMarketSymbols = [
				...positionMarketSymbols,
				...(benchmarkRequestSymbol
					? ([{ assetClass: 'stocks', symbol: benchmarkRequestSymbol }] satisfies MarketSymbol[])
					: [])
			];
			const combinedSymbols = [
				...new Set([
					...positionSymbols,
					...(benchmarkRequestSymbol ? [benchmarkRequestSymbol] : [])
				])
			];

			if (combinedSymbols.length > 0) {
				const provider = getMarketDataProvider();
				const benchmarkWasAdditional =
					benchmarkRequestSymbol !== null && !positionSymbols.includes(benchmarkRequestSymbol);
				if (combinedSymbols.length <= 250) {
					try {
						snapshots = (await provider.getUnifiedSnapshots(combinedSymbols)).items;
					} catch (cause) {
						if (isMarketDataAccessFailure(cause)) throw cause;
						if (positionSymbols.length > 0 && benchmarkWasAdditional) {
							try {
								snapshots = await loadSnapshotBatches(provider, positionSymbols);
							} catch (retryCause) {
								if (isMarketDataAccessFailure(retryCause)) throw retryCause;
								markRequestFailed = true;
							}
						} else if (positionSymbols.length > 0) {
							markRequestFailed = true;
						}
					}
				} else {
					if (positionSymbols.length > 0) {
						try {
							snapshots = await loadSnapshotBatches(provider, positionSymbols);
						} catch (cause) {
							if (isMarketDataAccessFailure(cause)) throw cause;
							markRequestFailed = true;
						}
					}
					if (benchmarkWasAdditional && benchmarkRequestSymbol) {
						try {
							snapshots.push(
								...(await provider.getUnifiedSnapshots([benchmarkRequestSymbol])).items
							);
						} catch (cause) {
							if (isMarketDataAccessFailure(cause)) throw cause;
							// Benchmark availability never changes portfolio valuation completeness.
						}
					}
				}

				const snapshotsBySymbol = new Map(
					snapshots.map((snapshot) => [
						marketSymbolKey(snapshot.assetClass, snapshot.symbol),
						snapshot
					])
				);
				for (const requested of requestedMarketSymbols) {
					const snapshot = snapshotsBySymbol.get(
						marketSymbolKey(requested.assetClass, requested.symbol)
					);
					const mark = snapshot
						? markFromSnapshot(snapshot, capabilities[requested.assetClass], valuationTime)
						: null;
					if (mark)
						marksBySymbol.set(marketSymbolKey(requested.assetClass, requested.symbol), mark);
				}

				const aggregateRequests = [
					...new Map(
						requestedMarketSymbols
							.filter((requested) => {
								const capability = capabilities[requested.assetClass];
								return (
									!marksBySymbol.has(marketSymbolKey(requested.assetClass, requested.symbol)) &&
									capability?.minuteBars &&
									capability.executionMode !== null &&
									capability.delayMinutes !== null
								);
							})
							.map((requested) => [
								marketSymbolKey(requested.assetClass, requested.symbol),
								requested
							])
					).values()
				];
				for (
					let start = 0;
					start < aggregateRequests.length;
					start += AGGREGATE_REQUEST_CONCURRENCY
				) {
					const batch = aggregateRequests.slice(start, start + AGGREGATE_REQUEST_CONCURRENCY);
					const aggregateResults = await Promise.allSettled(
						batch.map(async (requested) => {
							const capability = capabilities[requested.assetClass];
							if (!capability.executionMode || capability.delayMinutes === null) return undefined;
							const bar = await loadLatestCompletedMinuteBar({
								provider,
								assetClass: requested.assetClass,
								symbol: requested.symbol,
								mode: capability.executionMode,
								delayMinutes: capability.delayMinutes,
								at: valuationTime
							});
							return bar ? { requested, bar } : undefined;
						})
					);
					for (let index = 0; index < aggregateResults.length; index += 1) {
						const result = aggregateResults[index];
						if (result.status === 'fulfilled') {
							if (result.value) {
								marksBySymbol.set(
									marketSymbolKey(result.value.requested.assetClass, result.value.requested.symbol),
									markFromCompletedMinute(result.value.bar)
								);
							}
						} else {
							if (isMarketDataAccessFailure(result.reason)) throw result.reason;
							const requested = batch[index];
							if (
								requested &&
								positionMarketSymbols.some(
									(position) =>
										position.assetClass === requested.assetClass &&
										position.symbol === requested.symbol
								)
							) {
								markRequestFailed = true;
							}
						}
					}
				}
			}
		} catch (cause) {
			if (isMarketDataAccessFailure(cause)) {
				marketError =
					'Massive denied market-data access for the configured credentials or market-data plan.';
			} else if (input.positions.length > 0) {
				markRequestFailed = true;
			}
		}
	}

	const calculations = input.positions.map((position) => {
		const quantity = new Decimal(position.quantity);
		const averageCost = new Decimal(position.averageCost);
		const multiplier = new Decimal(position.contractMultiplier ?? 1);
		const markObservation = marksBySymbol.get(
			marketSymbolKey(position.assetClass, position.symbol)
		);
		const mark = markObservation?.price ?? null;
		const marketValue = mark ? mark.times(quantity).times(multiplier) : null;
		const unrealizedPnl = mark ? mark.minus(averageCost).times(quantity).times(multiplier) : null;
		const costBasis = averageCost.times(quantity.abs()).times(multiplier);
		return {
			position,
			quantity,
			averageCost,
			markObservation,
			mark,
			marketValue,
			unrealizedPnl,
			costBasis
		};
	});
	const benchmarkMark = benchmarkSymbol
		? marksBySymbol.get(marketSymbolKey('stocks', benchmarkSymbol))
		: undefined;
	const benchmarkPrice = benchmarkMark?.price ?? null;

	const signedMarketValue = calculations.reduce(
		(total, calculation) => total.plus(calculation.marketValue ?? 0),
		new Decimal(0)
	);
	const equity = cashBalance.plus(signedMarketValue);
	const grossExposure = calculations.reduce(
		(total, calculation) => total.plus(calculation.marketValue?.abs() ?? 0),
		new Decimal(0)
	);
	const realizedPnl = new Decimal(input.realizedPnl);
	const everyPositionMarked = calculations.every((calculation) => calculation.mark !== null);
	const unrealizedPnl = calculations.reduce(
		(total, calculation) => total.plus(calculation.unrealizedPnl ?? 0),
		new Decimal(0)
	);

	const rows: PositionRow[] = calculations.map((calculation) => {
		const {
			position,
			quantity,
			averageCost,
			mark,
			marketValue,
			unrealizedPnl: positionPnl
		} = calculation;
		const expiration = position.expirationDate ?? undefined;
		const daysToExpiration = expiration
			? Math.ceil((Date.parse(`${expiration}T00:00:00Z`) - Date.now()) / 86_400_000)
			: undefined;
		return {
			id: position.id,
			symbol: position.symbol,
			name: position.name,
			assetType: position.assetClass === 'stocks' ? 'stock' : 'option',
			side: quantity.isNegative() ? 'short' : 'long',
			quantity: quantity.abs().toNumber(),
			averageCost: averageCost.toNumber(),
			mark: mark?.toNumber() ?? null,
			marketValue: marketValue?.abs().toNumber() ?? null,
			dayPnl: null,
			unrealizedPnl: positionPnl?.toNumber() ?? null,
			totalReturnPercent:
				positionPnl && calculation.costBasis.greaterThan(0)
					? positionPnl.div(calculation.costBasis).times(100).toNumber()
					: null,
			portfolioWeightPercent:
				everyPositionMarked && marketValue && equity.greaterThan(0)
					? marketValue.abs().div(equity).times(100).toNumber()
					: null,
			expiration,
			daysToExpiration
		};
	});

	const markObservations = [...marksBySymbol.values()];
	const modes = new Set(markObservations.map((mark) => mark.mode));
	const latestAsOf = markObservations.reduce<Date | null>((latest, mark) => {
		return !latest || mark.asOf > latest ? mark.asOf : latest;
	}, null);
	const valuationAsOf = calculations.reduce<Date | null>((latest, calculation) => {
		const asOf = calculation.markObservation?.asOf;
		if (!asOf) return latest;
		return !latest || asOf > latest ? asOf : latest;
	}, null);
	const marketFeed =
		latestAsOf === null
			? null
			: {
					state: (modes.has('delayed') ? 'delayed' : 'live') as MarketFeedState,
					modeLabel: modeLabel(modes),
					asOf: latestAsOf.toISOString()
				};
	const valuation = everyPositionMarked
		? {
				cashBalance,
				netMarketValue: signedMarketValue,
				grossExposure,
				equity,
				realizedPnl,
				unrealizedPnl,
				asOf: valuationAsOf ?? valuationTime
			}
		: null;
	if (input.positions.length > 0 && !everyPositionMarked && marketError === null) {
		marketError = markRequestFailed
			? 'Market marks are temporarily unavailable. Cost basis remains visible.'
			: 'Massive returned no usable mark for one or more open positions.';
	}

	return {
		positions: rows,
		metrics: [
			{
				id: 'equity',
				label: 'Portfolio equity',
				value: everyPositionMarked ? currency(equity) : '—'
			},
			{ id: 'cash', label: 'Cash', value: currency(cashBalance) },
			{
				id: 'buying-power',
				label: 'Available cash',
				value: currency(Decimal.max(cashBalance.minus(reservedCash), 0))
			},
			{
				id: 'market-value',
				label: 'Net market value',
				value: calculations.length === 0 || everyPositionMarked ? currency(signedMarketValue) : '—'
			},
			{
				id: 'unrealized',
				label: 'Unrealized P&L',
				value: calculations.length === 0 || everyPositionMarked ? currency(unrealizedPnl) : '—',
				tone: everyPositionMarked ? metricTone(unrealizedPnl) : 'default'
			},
			{
				id: 'realized',
				label: 'Realized P&L',
				value: currency(realizedPnl),
				tone: metricTone(realizedPnl)
			}
		],
		marketFeed,
		marketError,
		valuation,
		benchmarkPrice
	};
}

const statusMap: Record<OrderRecord['status'], OrderRow['status']> = {
	pending_new: 'accepted',
	open: 'working',
	partially_filled: 'partially-filled',
	filled: 'filled',
	canceled: 'cancelled',
	expired: 'expired',
	rejected: 'rejected'
};

export function buildOrderRows(orders: OrderRecord[]): OrderRow[] {
	return orders.map((order) => {
		const firstLeg = order.legs[0];
		return {
			id: order.id,
			submittedAt: (order.acceptedAt ?? order.createdAt).toISOString(),
			symbol: order.legs.map((leg) => leg.symbol).join(' / ') || 'Unknown',
			strategy: order.legs.length > 1 ? `${order.legs.length}-leg strategy` : undefined,
			side: firstLeg?.side ?? 'buy',
			positionEffect: firstLeg?.positionEffect ?? 'open',
			quantity: Number(order.quantity),
			filledQuantity: Number(order.filledQuantity),
			type: order.orderType.replaceAll('_', '-') as OrderRow['type'],
			limitPrice: order.limitPrice === null ? undefined : Number(order.limitPrice),
			stopPrice: order.stopPrice === null ? undefined : Number(order.stopPrice),
			timeInForce: order.timeInForce,
			status: statusMap[order.status],
			averageFillPrice:
				order.averageFillPrice === null ? undefined : Number(order.averageFillPrice),
			statusDetail: order.rejectionReason ?? undefined,
			canEdit: ['open', 'partially_filled'].includes(order.status) && order.orderType !== 'market',
			canCancel: ['pending_new', 'open', 'partially_filled'].includes(order.status)
		};
	});
}

export function buildEquityCurve(
	rows: Array<{ id: string; asOf: Date; equity: string; benchmarkPrice: string | null }>,
	startingCash: string
): EquityCurvePoint[] {
	const firstBenchmark = rows.find((row) => row.benchmarkPrice !== null)?.benchmarkPrice;
	return rows.map((row) => ({
		id: row.id,
		timestamp: row.asOf.toISOString(),
		portfolioValue: Number(row.equity),
		benchmarkValue:
			row.benchmarkPrice && firstBenchmark
				? new Decimal(startingCash).times(row.benchmarkPrice).div(firstBenchmark).toNumber()
				: undefined
	}));
}
