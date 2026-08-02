import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	tradingInstruments,
	tradingPortfolios,
	tradingWatchlistItems,
	tradingWatchlists
} from '$lib/server/db/schema/trading';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import type { MarketDataRestProvider } from '$lib/server/market-data';
import type { SnapshotFieldAccess } from '$lib/server/market-view';
import { instrumentInsertValues } from '$lib/server/trading/drizzle-repository';
import {
	hydrateWatchlistSnapshots,
	type WatchlistMarketClock
} from '$lib/server/watchlist-market-data';
import {
	resolveExactActiveStock,
	unavailableWatchlistRows,
	type SavedWatchlistRow
} from './watchlists.logic';

export {
	mergeWatchlistSnapshots,
	resolveExactActiveStock,
	type SavedWatchlistItem,
	type SavedWatchlistRow
} from './watchlists.logic';

const DEFAULT_WATCHLIST_NAME = 'Watchlist';

type ApplicationDatabase = typeof db;
type TransactionClient = Parameters<Parameters<ApplicationDatabase['transaction']>[0]>[0];

export interface SavedWatchlist {
	id: string;
	name: string;
	items: SavedWatchlistRow[];
}

export type AddWatchlistItemResult =
	| { status: 'added'; symbol: string }
	| { status: 'already_saved'; symbol: string }
	| { status: 'portfolio_not_found' }
	| { status: 'stock_not_found'; symbol: string };

export type RemoveWatchlistItemResult = 'removed' | 'not_found';

export class WatchlistMarketDataError extends Error {
	constructor(readonly providerCause: unknown) {
		super('Massive could not resolve the requested watchlist symbol', { cause: providerCause });
		this.name = 'WatchlistMarketDataError';
	}
}

async function ensureDefaultWatchlist(
	transaction: TransactionClient,
	ownerUserId: string,
	portfolioId: string
): Promise<{ id: string; name: string } | null> {
	const [portfolio] = await transaction
		.select({ id: tradingPortfolios.id })
		.from(tradingPortfolios)
		.where(
			and(
				eq(tradingPortfolios.id, portfolioId),
				eq(tradingPortfolios.ownerUserId, ownerUserId),
				eq(tradingPortfolios.status, 'active')
			)
		)
		.limit(1);
	if (!portfolio) return null;

	await transaction
		.insert(tradingWatchlists)
		.values({ portfolioId, name: DEFAULT_WATCHLIST_NAME })
		.onConflictDoNothing({
			target: [tradingWatchlists.portfolioId, tradingWatchlists.name]
		});

	const [watchlist] = await transaction
		.select({ id: tradingWatchlists.id, name: tradingWatchlists.name })
		.from(tradingWatchlists)
		.where(
			and(
				eq(tradingWatchlists.portfolioId, portfolioId),
				eq(tradingWatchlists.name, DEFAULT_WATCHLIST_NAME)
			)
		)
		.limit(1);

	return watchlist ?? null;
}

export async function loadOwnedDefaultWatchlist(
	ownerUserId: string,
	portfolioId: string,
	provider?: MarketDataRestProvider
): Promise<SavedWatchlist | null> {
	const watchlist = await db.transaction((transaction) =>
		ensureDefaultWatchlist(transaction, ownerUserId, portfolioId)
	);
	if (!watchlist) return null;

	const rows = await db
		.select({
			id: tradingWatchlistItems.id,
			symbol: tradingInstruments.symbol,
			name: tradingInstruments.name,
			primaryExchange: tradingInstruments.primaryExchange,
			addedAt: tradingWatchlistItems.addedAt
		})
		.from(tradingWatchlistItems)
		.innerJoin(
			tradingWatchlists,
			and(
				eq(tradingWatchlistItems.watchlistId, tradingWatchlists.id),
				eq(tradingWatchlists.id, watchlist.id),
				eq(tradingWatchlists.portfolioId, portfolioId)
			)
		)
		.innerJoin(tradingInstruments, eq(tradingWatchlistItems.instrumentId, tradingInstruments.id))
		.orderBy(asc(tradingInstruments.symbol), asc(tradingWatchlistItems.id));

	const items = rows.map((row) => ({
		...row,
		addedAt: row.addedAt.toISOString()
	}));
	if (items.length === 0) return { ...watchlist, items: [] };

	let snapshotProvider = provider;
	let snapshotFieldAccess: SnapshotFieldAccess;
	let marketClock: WatchlistMarketClock;
	try {
		const capability = getMarketEnvironment().capabilities.stocks;
		if (!capability.snapshots) {
			return {
				...watchlist,
				items: unavailableWatchlistRows(
					items,
					'Snapshots are unavailable on the configured Massive stock plan.'
				)
			};
		}
		if (
			!capability.minuteBars ||
			capability.executionMode === null ||
			capability.delayMinutes === null
		) {
			return {
				...watchlist,
				items: unavailableWatchlistRows(
					items,
					'Completed minute aggregates are unavailable on the configured Massive stock plan.'
				)
			};
		}
		snapshotFieldAccess = { quotes: capability.quotes, trades: capability.trades };
		marketClock = {
			mode: capability.executionMode,
			delayMinutes: capability.delayMinutes
		};
		snapshotProvider ??= getMarketDataProvider();
	} catch {
		return {
			...watchlist,
			items: unavailableWatchlistRows(
				items,
				'Massive market data is not configured for this environment.'
			)
		};
	}

	return {
		...watchlist,
		items: await hydrateWatchlistSnapshots({
			items,
			provider: snapshotProvider,
			access: snapshotFieldAccess,
			clock: marketClock
		})
	};
}

export async function addStockToOwnedDefaultWatchlist(input: {
	ownerUserId: string;
	portfolioId: string;
	symbol: string;
	provider?: MarketDataRestProvider;
}): Promise<AddWatchlistItemResult> {
	const symbol = input.symbol.trim().toUpperCase();
	let search: Awaited<ReturnType<MarketDataRestProvider['searchStocks']>>;
	try {
		const provider = input.provider ?? getMarketDataProvider();
		search = await provider.searchStocks(symbol, 20);
	} catch (cause) {
		throw new WatchlistMarketDataError(cause);
	}
	const instrument = resolveExactActiveStock(search.items, symbol);
	if (!instrument) return { status: 'stock_not_found', symbol };

	return db.transaction(async (transaction) => {
		const watchlist = await ensureDefaultWatchlist(
			transaction,
			input.ownerUserId,
			input.portfolioId
		);
		if (!watchlist) return { status: 'portfolio_not_found' } as const;

		const values = instrumentInsertValues(instrument);
		const [persistedInstrument] = await transaction
			.insert(tradingInstruments)
			.values(values)
			.onConflictDoUpdate({
				target: tradingInstruments.symbol,
				set: {
					assetClass: values.assetClass,
					name: values.name,
					currency: values.currency,
					active: values.active,
					primaryExchange: values.primaryExchange,
					tickerType: values.tickerType,
					roundLot: values.roundLot,
					underlyingSymbol: values.underlyingSymbol,
					optionType: values.optionType,
					exerciseStyle: values.exerciseStyle,
					expirationDate: values.expirationDate,
					strikePrice: values.strikePrice,
					contractMultiplier: values.contractMultiplier,
					additionalUnderlyings: values.additionalUnderlyings,
					updatedAt: values.updatedAt
				}
			})
			.returning({ id: tradingInstruments.id });
		if (!persistedInstrument) throw new Error(`Could not persist ${instrument.symbol}`);

		const [insertedItem] = await transaction
			.insert(tradingWatchlistItems)
			.values({ watchlistId: watchlist.id, instrumentId: persistedInstrument.id })
			.onConflictDoNothing({
				target: [tradingWatchlistItems.watchlistId, tradingWatchlistItems.instrumentId]
			})
			.returning({ id: tradingWatchlistItems.id });

		return {
			status: insertedItem ? ('added' as const) : ('already_saved' as const),
			symbol: instrument.symbol
		};
	});
}

export async function removeOwnedWatchlistItem(input: {
	ownerUserId: string;
	portfolioId: string;
	itemId: string;
}): Promise<RemoveWatchlistItemResult> {
	return db.transaction(async (transaction) => {
		const watchlist = await ensureDefaultWatchlist(
			transaction,
			input.ownerUserId,
			input.portfolioId
		);
		if (!watchlist) return 'not_found';

		const [deleted] = await transaction
			.delete(tradingWatchlistItems)
			.where(
				and(
					eq(tradingWatchlistItems.id, input.itemId),
					eq(tradingWatchlistItems.watchlistId, watchlist.id)
				)
			)
			.returning({ id: tradingWatchlistItems.id });
		return deleted ? 'removed' : 'not_found';
	});
}
