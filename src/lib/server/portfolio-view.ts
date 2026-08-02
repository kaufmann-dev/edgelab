import Decimal from 'decimal.js';
import type {
	EquityCurvePoint,
	MarketFeedState,
	MetricItem,
	OrderRow,
	PositionRow
} from '$lib/components/trading/types';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import type { MarketDataRestProvider, MarketSnapshot } from '$lib/server/market-data';
import type { OrderRecord, PortfolioValuation, PositionRecord } from '$lib/server/portfolio-read';

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

function markFromSnapshot(snapshot: MarketSnapshot): Decimal | null {
	if (snapshot.assetClass === 'stocks' && snapshot.lastMinute?.close.greaterThan(0)) {
		return snapshot.lastMinute.close;
	}
	if (
		snapshot.quote &&
		snapshot.quote.bidPrice.greaterThan(0) &&
		snapshot.quote.askPrice.greaterThan(0) &&
		snapshot.quote.bidPrice.lessThanOrEqualTo(snapshot.quote.askPrice)
	) {
		return snapshot.quote.bidPrice.plus(snapshot.quote.askPrice).dividedBy(2);
	}
	const fallback = snapshot.lastTrade?.price ?? snapshot.lastMinute?.close;
	return fallback?.greaterThan(0) ? fallback : null;
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
	let snapshots: MarketSnapshot[] = [];
	let marketError: string | null = null;

	if (input.positions.length > 0 || benchmarkSymbol) {
		try {
			const environment = getMarketEnvironment();
			const requiredAssetClasses = new Set(input.positions.map((position) => position.assetClass));
			const unavailable = [...requiredAssetClasses].filter(
				(assetClass) => !environment.capabilities[assetClass].snapshots
			);
			if (unavailable.length > 0) {
				marketError = `${unavailable.join(' and ')} snapshots are not included in the configured Massive plan.`;
			}

			const positionSymbols = [
				...new Set(
					input.positions
						.filter((position) => environment.capabilities[position.assetClass].snapshots)
						.map((position) => position.symbol)
				)
			];
			const benchmarkRequestSymbol = environment.capabilities.stocks.snapshots
				? benchmarkSymbol
				: null;
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
					} catch {
						if (positionSymbols.length > 0 && benchmarkWasAdditional) {
							try {
								snapshots = await loadSnapshotBatches(provider, positionSymbols);
							} catch {
								marketError =
									'Market marks are temporarily unavailable. Cost basis remains visible.';
							}
						} else if (positionSymbols.length > 0) {
							marketError = 'Market marks are temporarily unavailable. Cost basis remains visible.';
						}
					}
				} else {
					if (positionSymbols.length > 0) {
						try {
							snapshots = await loadSnapshotBatches(provider, positionSymbols);
						} catch {
							marketError = 'Market marks are temporarily unavailable. Cost basis remains visible.';
						}
					}
					if (benchmarkWasAdditional && benchmarkRequestSymbol) {
						try {
							snapshots.push(
								...(await provider.getUnifiedSnapshots([benchmarkRequestSymbol])).items
							);
						} catch {
							// Benchmark availability never changes portfolio valuation completeness.
						}
					}
				}
			}
		} catch {
			if (input.positions.length > 0) {
				marketError = 'Market marks are temporarily unavailable. Cost basis remains visible.';
			}
		}
	}

	const snapshotBySymbol = new Map(
		snapshots.map((snapshot) => [`${snapshot.assetClass}:${snapshot.symbol}`, snapshot])
	);
	const calculations = input.positions.map((position) => {
		const quantity = new Decimal(position.quantity);
		const averageCost = new Decimal(position.averageCost);
		const multiplier = new Decimal(position.contractMultiplier ?? 1);
		const snapshot = snapshotBySymbol.get(`${position.assetClass}:${position.symbol}`);
		const mark = snapshot ? markFromSnapshot(snapshot) : null;
		const marketValue = mark ? mark.times(quantity).times(multiplier) : null;
		const unrealizedPnl = mark ? mark.minus(averageCost).times(quantity).times(multiplier) : null;
		const costBasis = averageCost.times(quantity.abs()).times(multiplier);
		return {
			position,
			quantity,
			averageCost,
			snapshot,
			mark,
			marketValue,
			unrealizedPnl,
			costBasis
		};
	});
	const benchmarkSnapshot = benchmarkSymbol
		? snapshotBySymbol.get(`stocks:${benchmarkSymbol}`)
		: undefined;
	const benchmarkPrice = benchmarkSnapshot ? markFromSnapshot(benchmarkSnapshot) : null;

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

	const modes = new Set(snapshots.map((snapshot) => snapshot.mode));
	const latestAsOf = snapshots.reduce<Date | null>((latest, snapshot) => {
		const sourceTime =
			snapshot.assetClass === 'stocks'
				? (snapshot.lastMinute?.sourceTime ??
					snapshot.lastTrade?.sourceTime ??
					snapshot.quote?.sourceTime ??
					snapshot.asOf)
				: (snapshot.quote?.sourceTime ??
					snapshot.lastTrade?.sourceTime ??
					snapshot.lastMinute?.sourceTime ??
					snapshot.asOf);
		return !latest || sourceTime > latest ? sourceTime : latest;
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
				asOf: latestAsOf ?? input.valuationTime ?? new Date()
			}
		: null;
	if (input.positions.length > 0 && !everyPositionMarked && marketError === null) {
		marketError = 'Massive returned no usable mark for one or more open positions.';
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
