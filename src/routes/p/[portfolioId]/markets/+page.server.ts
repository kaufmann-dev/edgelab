import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getMarketDataProvider, getMarketEnvironment } from '#lib/server/market.js';
import { MassiveHttpError, type Instrument } from '#lib/server/market-data/index.js';
import { serializeInstrument } from '#lib/server/market-view.js';
import { requirePortfolioReadAccess } from '#lib/server/portfolio-read.js';
import {
	addStockToOwnedDefaultWatchlist,
	loadOwnedDefaultWatchlist,
	removeOwnedWatchlistItem,
	WatchlistMarketDataError
} from '#lib/server/watchlists.js';
import type { Actions, PageServerLoad } from './$types';

const MAX_QUERY_LENGTH = 80;
const RESULT_LIMIT = 20;
const portfolioIdSchema = z.uuid();
const watchlistItemIdSchema = z.uuid();
const stockSymbolSchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z][A-Z0-9.]{0,14}$/);

function serializeStockSearchResult(instrument: Instrument) {
	const result = serializeInstrument(instrument);
	if (result.assetClass !== 'stocks') {
		throw new Error('Massive stock search returned a non-stock instrument');
	}
	return result;
}

function marketSearchError(cause: unknown): string {
	if (!(cause instanceof MassiveHttpError)) {
		return 'Massive instrument search is temporarily unavailable.';
	}

	if (cause.status === 401 || cause.status === 403) {
		return 'Massive rejected the configured credentials or stock-plan access.';
	}
	if (cause.status === 429) {
		return 'The Massive request limit was reached. Try this search again shortly.';
	}
	return `Massive instrument search is temporarily unavailable (provider status ${cause.status}).`;
}

export const load = (async ({ locals, parent, setHeaders, url }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	if (!locals.user) error(401, 'Authentication required.');
	const { portfolio } = await parent();

	const query = (url.searchParams.get('q') ?? '').trim();
	let feed = null;
	let feedError: string | null = null;

	try {
		feed = getMarketEnvironment().capabilities.stocks;
	} catch {
		feedError = 'Massive market data is not configured for this environment.';
	}

	const watchlist = await loadOwnedDefaultWatchlist(locals.user.id, portfolio.id);
	if (!watchlist) error(404, 'Portfolio not found.');

	if (!query) {
		return {
			query,
			items: [],
			searchStatus: 'idle' as const,
			searchError: null,
			retrievedAt: null,
			feed,
			feedError,
			watchlist
		};
	}

	if (query.length > MAX_QUERY_LENGTH) {
		return {
			query,
			items: [],
			searchStatus: 'error' as const,
			searchError: `Search terms must be ${MAX_QUERY_LENGTH} characters or fewer.`,
			retrievedAt: null,
			feed,
			feedError,
			watchlist
		};
	}

	if (!feed) {
		return {
			query,
			items: [],
			searchStatus: 'error' as const,
			searchError: feedError,
			retrievedAt: null,
			feed,
			feedError,
			watchlist
		};
	}

	try {
		const page = await getMarketDataProvider().searchStocks(query, RESULT_LIMIT);
		return {
			query,
			items: page.items.map(serializeStockSearchResult),
			searchStatus: 'success' as const,
			searchError: null,
			retrievedAt: new Date().toISOString(),
			feed,
			feedError,
			watchlist
		};
	} catch (cause) {
		return {
			query,
			items: [],
			searchStatus: 'error' as const,
			searchError: marketSearchError(cause),
			retrievedAt: null,
			feed,
			feedError,
			watchlist
		};
	}
}) satisfies PageServerLoad;

async function requireOwnedPortfolio(locals: App.Locals, rawPortfolioId: string) {
	if (!locals.user) return null;
	const portfolioId = portfolioIdSchema.safeParse(rawPortfolioId);
	if (!portfolioId.success) return null;
	return requirePortfolioReadAccess(locals.user.id, portfolioId.data);
}

export const actions: Actions = {
	addWatchlistItem: async ({ locals, params, request }) => {
		if (!locals.user) return fail(401, { watchlistError: 'Authentication required.' });
		locals.markSessionActive();

		const portfolio = await requireOwnedPortfolio(locals, params.portfolioId);
		if (!portfolio) return fail(404, { watchlistError: 'Portfolio not found.' });

		const formData = await request.formData();
		const symbol = stockSymbolSchema.safeParse(formData.get('symbol'));
		if (!symbol.success) {
			return fail(400, {
				watchlistError: 'Enter a valid US stock symbol using up to 15 letters, numbers, or dots.'
			});
		}

		try {
			const result = await addStockToOwnedDefaultWatchlist({
				ownerUserId: locals.user.id,
				portfolioId: portfolio.id,
				symbol: symbol.data
			});

			if (result.status === 'portfolio_not_found') {
				return fail(404, { watchlistError: 'Portfolio not found.' });
			}
			if (result.status === 'stock_not_found') {
				return fail(404, {
					watchlistError: `${result.symbol} is not an exact active US stock in Massive.`
				});
			}

			return {
				watchlistSuccess:
					result.status === 'already_saved'
						? `${result.symbol} is already saved.`
						: `${result.symbol} was added to the watchlist.`,
				addedSymbol: result.symbol,
				alreadySaved: result.status === 'already_saved'
			};
		} catch (cause) {
			if (cause instanceof WatchlistMarketDataError) {
				return fail(502, { watchlistError: marketSearchError(cause.providerCause) });
			}
			throw cause;
		}
	},
	removeWatchlistItem: async ({ locals, params, request }) => {
		if (!locals.user) return fail(401, { watchlistError: 'Authentication required.' });
		locals.markSessionActive();

		const portfolio = await requireOwnedPortfolio(locals, params.portfolioId);
		if (!portfolio) return fail(404, { watchlistError: 'Portfolio not found.' });

		const formData = await request.formData();
		const itemId = watchlistItemIdSchema.safeParse(formData.get('itemId'));
		if (!itemId.success) {
			return fail(400, { watchlistError: 'Invalid watchlist item identifier.' });
		}

		const result = await removeOwnedWatchlistItem({
			ownerUserId: locals.user.id,
			portfolioId: portfolio.id,
			itemId: itemId.data
		});
		if (result === 'not_found') {
			return fail(404, { watchlistError: 'Watchlist item not found.' });
		}
		return {
			watchlistSuccess: 'The symbol was removed from the watchlist.',
			removedItemId: itemId.data
		};
	}
};
