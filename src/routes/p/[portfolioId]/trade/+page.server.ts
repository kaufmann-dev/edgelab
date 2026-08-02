import Decimal from 'decimal.js';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import {
	MassiveHttpError,
	type MarketSnapshot,
	type OptionSnapshot
} from '$lib/server/market-data';
import {
	getPortfolioBalances,
	getPortfolioPolicy,
	listPortfolioJournal,
	requirePortfolioReadAccess
} from '$lib/server/portfolio-read';
import type { PageServerLoad } from './$types';

const symbolSchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z][A-Z0-9.]{0,14}$/);
const expirationSchema = z.string().date();

function priceForSnapshot(snapshot: MarketSnapshot): Decimal | null {
	if (snapshot.lastTrade) return snapshot.lastTrade.price;
	if (snapshot.quote?.bidPrice.greaterThan(0) && snapshot.quote.askPrice.greaterThan(0)) {
		return snapshot.quote.bidPrice.plus(snapshot.quote.askPrice).dividedBy(2);
	}
	return snapshot.lastMinute?.close ?? null;
}

function stockQuote(snapshot: MarketSnapshot) {
	const last = priceForSnapshot(snapshot);
	if (!last) return null;
	return {
		symbol: snapshot.symbol,
		name: snapshot.name,
		last: last.toNumber(),
		bid: snapshot.quote?.bidPrice.toNumber(),
		ask: snapshot.quote?.askPrice.toNumber(),
		asOf: snapshot.asOf.toISOString()
	};
}

function optionContract(snapshot: OptionSnapshot) {
	return {
		id: snapshot.instrument.symbol,
		symbol: snapshot.instrument.symbol,
		type: snapshot.instrument.optionType,
		strike: snapshot.instrument.strikePrice.toNumber(),
		bid: snapshot.quote?.bidPrice.toNumber(),
		ask: snapshot.quote?.askPrice.toNumber(),
		last: snapshot.lastTrade?.price.toNumber(),
		delta: snapshot.greeks?.delta?.toNumber(),
		impliedVolatilityPercent: snapshot.impliedVolatility?.times(100).toNumber(),
		volume: snapshot.day?.volume.toNumber(),
		openInterest: snapshot.openInterest?.toNumber(),
		asOf: snapshot.asOf.toISOString()
	};
}

function optionRows(snapshots: OptionSnapshot[]) {
	const underlying = snapshots.find((snapshot) => snapshot.underlyingPrice)?.underlyingPrice;
	const rows = new Map<number, ReturnType<typeof optionContract>[]>();
	for (const snapshot of snapshots) {
		const strike = snapshot.instrument.strikePrice.toNumber();
		const contracts = rows.get(strike) ?? [];
		contracts.push(optionContract(snapshot));
		rows.set(strike, contracts);
	}
	const underlyingPrice = underlying?.toNumber();
	const atTheMoneyDistance =
		underlyingPrice === undefined
			? null
			: Math.min(...[...rows.keys()].map((strike) => Math.abs(strike - underlyingPrice)));

	return [...rows.entries()]
		.sort(([left], [right]) => left - right)
		.map(([strike, contracts]) => ({
			id: String(strike),
			strike,
			isAtTheMoney:
				underlyingPrice !== undefined &&
				atTheMoneyDistance !== null &&
				Math.abs(strike - underlyingPrice) === atTheMoneyDistance,
			call: contracts.find((contract) => contract.type === 'call'),
			put: contracts.find((contract) => contract.type === 'put')
		}));
}

function providerError(cause: unknown): string {
	if (cause instanceof MassiveHttpError && (cause.status === 401 || cause.status === 403)) {
		return 'Massive rejected the configured credentials or plan access.';
	}
	if (cause instanceof MassiveHttpError && cause.status === 429) {
		return 'The Massive request limit was reached. Try again shortly.';
	}
	return 'Market data is temporarily unavailable.';
}

export const load: PageServerLoad = async ({ locals, params, url, setHeaders }) => {
	if (!locals.user) error(401, 'Authentication required.');
	const portfolio = await requirePortfolioReadAccess(locals.user.id, params.portfolioId);
	if (!portfolio) error(404, 'Portfolio not found.');
	setHeaders({ 'cache-control': 'private, no-store' });

	const [policy, balances, journal] = await Promise.all([
		getPortfolioPolicy(portfolio.id),
		getPortfolioBalances(portfolio.id),
		listPortfolioJournal(portfolio.id)
	]);
	const rawSymbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
	const parsedSymbol = rawSymbol ? symbolSchema.safeParse(rawSymbol) : null;
	const assetView = url.searchParams.get('asset') === 'options' ? 'options' : 'stock';
	const rawExpiration = url.searchParams.get('expiration');
	const expiration = rawExpiration ? expirationSchema.safeParse(rawExpiration) : null;

	let quote = null;
	let marketFeed = null;
	let marketError: string | null = null;
	let options = { rows: [], expiration: null, expirations: [], error: null } as {
		rows: ReturnType<typeof optionRows>;
		expiration: string | null;
		expirations: string[];
		error: string | null;
	};

	if (parsedSymbol?.success) {
		try {
			const environment = getMarketEnvironment();
			if (!environment.capabilities.stocks.snapshots) {
				marketError = 'Stock snapshots are not included in the configured Massive plan.';
			} else {
				const snapshots = await getMarketDataProvider().getUnifiedSnapshots([parsedSymbol.data]);
				const snapshot = snapshots.items.find(
					(item) => item.assetClass === 'stocks' && item.symbol === parsedSymbol.data
				);
				if (snapshot) {
					quote = stockQuote(snapshot);
					marketFeed = {
						state: snapshot.mode === 'realtime' ? ('live' as const) : ('delayed' as const),
						modeLabel: environment.capabilities.stocks.label,
						streaming:
							environment.capabilities.stocks.websocket &&
							environment.capabilities.stocks.quotes &&
							environment.capabilities.stocks.trades,
						asOf: snapshot.asOf.toISOString()
					};
				} else {
					marketError = 'Massive returned no stock snapshot for this symbol.';
				}
			}

			if (assetView === 'options') {
				if (!environment.capabilities.options.snapshots) {
					options.error = 'Option chains are not included in the configured Massive plan.';
				} else if (expiration && !expiration.success) {
					options.error = 'Expiration must use YYYY-MM-DD.';
				} else {
					const chain = await getMarketDataProvider().getOptionChain(parsedSymbol.data, {
						expirationDate: expiration?.data,
						limit: 250
					});
					const expirations = [
						...new Set(chain.items.map((item) => item.instrument.expirationDate))
					].sort();
					const selectedExpiration = expiration?.data ?? expirations[0] ?? null;
					const selected = chain.items.filter(
						(item) => item.instrument.expirationDate === selectedExpiration
					);
					options = {
						rows: optionRows(selected),
						expiration: selectedExpiration,
						expirations,
						error: null
					};
				}
			}
		} catch (cause) {
			if (assetView === 'options') options.error = providerError(cause);
			else marketError = providerError(cause);
		}
	}

	return {
		requestedSymbol: rawSymbol,
		symbolValid: parsedSymbol?.success ?? rawSymbol.length === 0,
		assetView,
		quote,
		marketFeed,
		marketError,
		options,
		policy,
		balances,
		tradePlans: journal
			.filter((entry) => entry.phase === 'pre_trade')
			.map((entry) => ({ id: entry.id, symbol: entry.symbol, notes: entry.notes }))
	};
};
