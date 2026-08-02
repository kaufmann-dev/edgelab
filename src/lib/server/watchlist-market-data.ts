import { completedSnapshotMinuteBar, loadLatestCompletedMinuteBar } from '$lib/server/market-bars';
import {
	MassiveHttpError,
	type MarketDataMode,
	type MarketDataRestProvider,
	type MarketSnapshot,
	type NormalizedBar
} from '$lib/server/market-data';
import type { SnapshotFieldAccess } from '$lib/server/market-view';
import {
	mergeWatchlistSnapshots,
	type SavedWatchlistItem,
	type SavedWatchlistRow,
	unavailableWatchlistRows
} from '$lib/server/watchlists.logic';

const SNAPSHOT_BATCH_SIZE = 250;
const AGGREGATE_REQUEST_CONCURRENCY = 8;

export interface WatchlistMarketClock {
	mode: MarketDataMode;
	delayMinutes: number;
}

type WatchlistMarketDataProvider = Pick<MarketDataRestProvider, 'getUnifiedSnapshots' | 'getBars'>;

function snapshotFailureMessage(cause: unknown): string {
	if (cause instanceof MassiveHttpError && (cause.status === 401 || cause.status === 403)) {
		return 'Massive denied market-data access for the configured credentials or stock plan.';
	}
	if (cause instanceof MassiveHttpError && cause.status === 429) {
		return 'Massive snapshot request limit reached; saved symbol remains available.';
	}
	return 'Massive snapshots are temporarily unavailable; saved symbol remains available.';
}

function isMarketDataAccessFailure(cause: unknown): cause is MassiveHttpError {
	return cause instanceof MassiveHttpError && (cause.status === 401 || cause.status === 403);
}

function needsCompletedMinuteMark(snapshot: MarketSnapshot, access: SnapshotFieldAccess): boolean {
	return (
		snapshot.assetClass === 'stocks' &&
		!snapshot.lastMinute &&
		!(access.trades && snapshot.lastTrade)
	);
}

function sanitizeSnapshotMinute(
	snapshot: MarketSnapshot,
	clock: WatchlistMarketClock,
	at: Date
): MarketSnapshot {
	if (
		!completedSnapshotMinuteBar({
			snapshot,
			assetClass: 'stocks',
			symbol: snapshot.symbol,
			mode: clock.mode,
			delayMinutes: clock.delayMinutes,
			at
		})
	) {
		return { ...snapshot, lastMinute: undefined };
	}
	return snapshot;
}

async function loadCompletedMinuteMarks(input: {
	items: readonly SavedWatchlistItem[];
	snapshots: readonly MarketSnapshot[];
	provider: Pick<MarketDataRestProvider, 'getBars'>;
	access: SnapshotFieldAccess;
	clock: WatchlistMarketClock;
	at: Date;
}): Promise<NormalizedBar[]> {
	const snapshotsBySymbol = new Map(
		input.snapshots
			.filter((snapshot) => snapshot.assetClass === 'stocks')
			.map((snapshot) => [snapshot.symbol.toUpperCase(), snapshot] as const)
	);
	const candidates = input.items.filter((item) => {
		const snapshot = snapshotsBySymbol.get(item.symbol.toUpperCase());
		return !snapshot || needsCompletedMinuteMark(snapshot, input.access);
	});
	const completedMinutes: NormalizedBar[] = [];

	for (let start = 0; start < candidates.length; start += AGGREGATE_REQUEST_CONCURRENCY) {
		const batch = candidates.slice(start, start + AGGREGATE_REQUEST_CONCURRENCY);
		const results = await Promise.all(
			batch.map(async (item) => {
				try {
					return await loadLatestCompletedMinuteBar({
						provider: input.provider,
						assetClass: 'stocks',
						symbol: item.symbol,
						mode: input.clock.mode,
						delayMinutes: input.clock.delayMinutes,
						at: input.at
					});
				} catch (cause) {
					if (isMarketDataAccessFailure(cause)) throw cause;
					return undefined;
				}
			})
		);
		completedMinutes.push(...results.filter((bar): bar is NormalizedBar => bar !== undefined));
	}

	return completedMinutes;
}

export async function hydrateWatchlistSnapshots(input: {
	items: readonly SavedWatchlistItem[];
	provider: WatchlistMarketDataProvider;
	access: SnapshotFieldAccess;
	clock: WatchlistMarketClock;
	at?: Date;
}): Promise<SavedWatchlistRow[]> {
	const hydrated: SavedWatchlistRow[] = [];
	const at = input.at ?? new Date();

	for (let start = 0; start < input.items.length; start += SNAPSHOT_BATCH_SIZE) {
		const batch = input.items.slice(start, start + SNAPSHOT_BATCH_SIZE);
		try {
			const page = await input.provider.getUnifiedSnapshots(batch.map((item) => item.symbol));
			const snapshots = page.items.map((snapshot) =>
				snapshot.assetClass === 'stocks'
					? sanitizeSnapshotMinute(snapshot, input.clock, at)
					: snapshot
			);
			const completedMinutes = await loadCompletedMinuteMarks({
				items: batch,
				snapshots,
				provider: input.provider,
				access: input.access,
				clock: input.clock,
				at
			});
			hydrated.push(...mergeWatchlistSnapshots(batch, snapshots, input.access, completedMinutes));
		} catch (cause) {
			const failureReason = snapshotFailureMessage(cause);
			if (isMarketDataAccessFailure(cause)) {
				hydrated.push(...unavailableWatchlistRows(batch, failureReason));
				continue;
			}
			let completedMinutes: NormalizedBar[];
			try {
				completedMinutes = await loadCompletedMinuteMarks({
					items: batch,
					snapshots: [],
					provider: input.provider,
					access: input.access,
					clock: input.clock,
					at
				});
			} catch (aggregateCause) {
				if (isMarketDataAccessFailure(aggregateCause)) {
					hydrated.push(...unavailableWatchlistRows(batch, snapshotFailureMessage(aggregateCause)));
					continue;
				}
				throw aggregateCause;
			}
			hydrated.push(
				...mergeWatchlistSnapshots(batch, [], input.access, completedMinutes, failureReason)
			);
		}
	}

	return hydrated;
}
