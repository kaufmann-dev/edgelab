import type { Instrument, MarketSnapshot, StockInstrument } from '$lib/server/market-data';
import { serializeSnapshot } from '$lib/server/market-view';

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
	snapshots: readonly MarketSnapshot[]
): SavedWatchlistRow[] {
	const snapshotsBySymbol = new Map(
		snapshots
			.filter((snapshot) => snapshot.assetClass === 'stocks')
			.map((snapshot) => [snapshot.symbol.toUpperCase(), snapshot] as const)
	);

	return items.map((item) => {
		const snapshot = snapshotsBySymbol.get(item.symbol.toUpperCase());
		if (!snapshot) {
			return {
				...item,
				snapshot: {
					status: 'unavailable' as const,
					reason: 'Massive returned no current snapshot for this symbol.'
				}
			};
		}

		return {
			...item,
			snapshot: { status: 'available' as const, data: serializeSnapshot(snapshot) }
		};
	});
}
