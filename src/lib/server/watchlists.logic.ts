import type {
	Instrument,
	MarketSnapshot,
	NormalizedBar,
	StockInstrument
} from '$lib/server/market-data';
import { serializeSnapshot, type SnapshotFieldAccess } from '$lib/server/market-view';

export interface SavedWatchlistItem {
	id: string;
	symbol: string;
	name: string;
	primaryExchange: string | null;
	addedAt: string;
}

export type SavedWatchlistRow = SavedWatchlistItem &
	(
		| {
				snapshot: {
					status: 'available';
					data: ReturnType<typeof serializeSnapshot>;
				};
		  }
		| {
				snapshot: {
					status: 'unavailable';
					reason: string;
				};
		  }
	);

export function resolveExactActiveStock(
	instruments: readonly Instrument[],
	symbol: string
): StockInstrument | null {
	const normalizedSymbol = symbol.trim().toUpperCase();
	return (
		instruments.find(
			(instrument): instrument is StockInstrument =>
				instrument.assetClass === 'stocks' &&
				instrument.active &&
				instrument.symbol.toUpperCase() === normalizedSymbol
		) ?? null
	);
}

export function unavailableWatchlistRows(
	items: readonly SavedWatchlistItem[],
	reason: string
): SavedWatchlistRow[] {
	return items.map((item) => ({
		...item,
		snapshot: { status: 'unavailable' as const, reason }
	}));
}

export function mergeWatchlistSnapshots(
	items: readonly SavedWatchlistItem[],
	snapshots: readonly MarketSnapshot[],
	access: SnapshotFieldAccess,
	completedMinuteBars: readonly NormalizedBar[] = [],
	missingSnapshotReason = 'Massive returned no current snapshot for this symbol.'
): SavedWatchlistRow[] {
	const snapshotsBySymbol = new Map(
		snapshots
			.filter((snapshot) => snapshot.assetClass === 'stocks')
			.map((snapshot) => [snapshot.symbol.toUpperCase(), snapshot] as const)
	);
	const completedMinutesBySymbol = new Map(
		completedMinuteBars
			.filter(
				(bar) =>
					bar.assetClass === 'stocks' &&
					bar.interval === 'minute' &&
					bar.sourceTime.getTime() === bar.endTime.getTime()
			)
			.map((bar) => [bar.symbol.toUpperCase(), bar] as const)
	);

	return items.map((item) => {
		const symbol = item.symbol.toUpperCase();
		const snapshot = snapshotsBySymbol.get(symbol);
		const completedMinute = completedMinutesBySymbol.get(symbol);
		if (!snapshot && !completedMinute) {
			return {
				...item,
				snapshot: {
					status: 'unavailable' as const,
					reason: missingSnapshotReason
				}
			};
		}
		const hydratedSnapshot: MarketSnapshot = snapshot
			? !snapshot.lastMinute && completedMinute?.mode === snapshot.mode
				? { ...snapshot, lastMinute: completedMinute }
				: snapshot
			: {
					assetClass: 'stocks',
					symbol: item.symbol,
					name: item.name,
					mode: completedMinute!.mode,
					lastMinute: completedMinute,
					asOf: completedMinute!.receivedAt
				};

		return {
			...item,
			snapshot: {
				status: 'available' as const,
				data: serializeSnapshot(hydratedSnapshot, access)
			}
		};
	});
}
