import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { loadLatestCompletedMinuteBar } from '$lib/server/market-bars';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import {
	MassiveHttpError,
	supportsOptionsExecution,
	type MarketSnapshot,
	type NormalizedBar,
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

function stockQuote(snapshot: MarketSnapshot, completedMinute: NormalizedBar, showBidAsk: boolean) {
	return {
		symbol: snapshot.symbol,
		name: snapshot.name,
		last: completedMinute.close.toNumber(),
		...(showBidAsk
			? {
					bid: snapshot.quote?.bidPrice.toNumber(),
					ask: snapshot.quote?.askPrice.toNumber()
				}
			: {}),
		asOf: completedMinute.endTime.toISOString()
	};
}

function optionContract(snapshot: OptionSnapshot, showBidAsk: boolean) {
	return {
		id: snapshot.instrument.symbol,
		symbol: snapshot.instrument.symbol,
		type: snapshot.instrument.optionType,
		strike: snapshot.instrument.strikePrice.toNumber(),
		standardDeliverable:
			snapshot.instrument.multiplier.equals(100) &&
			snapshot.instrument.additionalUnderlyings.length === 0,
		...(showBidAsk
			? {
					bid: snapshot.quote?.bidPrice.toNumber(),
					ask: snapshot.quote?.askPrice.toNumber()
				}
			: {}),
		sessionClose: snapshot.day?.close.toNumber(),
		delta: snapshot.greeks?.delta?.toNumber(),
		impliedVolatilityPercent: snapshot.impliedVolatility?.times(100).toNumber(),
		volume: snapshot.day?.volume.toNumber(),
		openInterest: snapshot.openInterest?.toNumber(),
		asOf: snapshot.asOf.toISOString()
	};
}

function optionRows(snapshots: OptionSnapshot[], showBidAsk: boolean) {
	const underlying = snapshots.find((snapshot) => snapshot.underlyingPrice)?.underlyingPrice;
	const rows = new Map<number, ReturnType<typeof optionContract>[]>();
	for (const snapshot of snapshots) {
		const strike = snapshot.instrument.strikePrice.toNumber();
		const contracts = rows.get(strike) ?? [];
		contracts.push(optionContract(snapshot, showBidAsk));
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
	const requestedAssetView = url.searchParams.get('asset') === 'options' ? 'options' : 'stock';
	const rawExpiration = url.searchParams.get('expiration');
	const expiration = rawExpiration ? expirationSchema.safeParse(rawExpiration) : null;
	const environment = getMarketEnvironment();
	const stockExecutionMode = environment.capabilities.stocks.executionMode;
	const stockDelayMinutes = environment.capabilities.stocks.delayMinutes;
	if (!stockExecutionMode || stockDelayMinutes === null) {
		error(503, 'The configured stock plan does not provide an executable market-data clock.');
	}

	let quote = null;
	let marketFeed = null;
	let marketError: string | null = null;
	const optionsTradingEnabled =
		stockExecutionMode === portfolio.dataMode && supportsOptionsExecution(environment.capabilities);
	const optionsDataEnabled = environment.capabilities.options.snapshots;
	const optionsTradingReason = optionsTradingEnabled
		? ''
		: 'Option simulation requires matching Stocks and Options plan clocks with snapshots, WebSockets, and minute and second aggregates.';
	const optionsMarketData = {
		priceRecency:
			environment.capabilities.options.recency === 'realtime'
				? 'Real-time prices'
				: '15-minute-delayed prices',
		greeksRecency: 'Real-time Greeks and implied volatility',
		openInterestRecency: 'Daily open interest',
		showBidAsk: environment.capabilities.options.quotes,
		executionDescription:
			'Fills wait for future trade-derived one-second aggregates. An illiquid contract may not emit a bar and may remain unfilled.'
	};
	let options = { rows: [], expiration: null, expirations: [], error: null } as {
		rows: ReturnType<typeof optionRows>;
		expiration: string | null;
		expirations: string[];
		error: string | null;
	};

	if (parsedSymbol?.success) {
		try {
			if (!environment.capabilities.stocks.snapshots) {
				marketError = 'Stock snapshots are not included in the configured Massive plan.';
			} else {
				const provider = getMarketDataProvider();
				const [snapshots, completedMinute] = await Promise.all([
					provider.getUnifiedSnapshots([parsedSymbol.data]),
					loadLatestCompletedMinuteBar({
						provider,
						assetClass: 'stocks',
						symbol: parsedSymbol.data,
						mode: stockExecutionMode,
						delayMinutes: stockDelayMinutes
					})
				]);
				const snapshot = snapshots.items.find(
					(item) => item.assetClass === 'stocks' && item.symbol === parsedSymbol.data
				);
				if (snapshot && completedMinute) {
					quote = stockQuote(snapshot, completedMinute, environment.capabilities.stocks.quotes);
					marketFeed = {
						state: snapshot.mode === 'realtime' ? ('live' as const) : ('delayed' as const),
						modeLabel: environment.capabilities.stocks.label,
						streaming:
							environment.capabilities.stocks.websocket &&
							environment.capabilities.stocks.secondBars,
						events: ['A'],
						priceSource: 'aggregate' as const,
						asOf: quote.asOf
					};
				} else if (snapshot) {
					marketError = 'Massive returned no recent completed minute aggregate for this symbol.';
				} else {
					marketError = 'Massive returned no stock snapshot for this symbol.';
				}
			}

			if (requestedAssetView === 'options' && optionsDataEnabled) {
				if (expiration && !expiration.success) {
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
						rows: optionRows(selected, optionsMarketData.showBidAsk),
						expiration: selectedExpiration,
						expirations,
						error: null
					};
				}
			}
		} catch (cause) {
			if (requestedAssetView === 'options' && optionsDataEnabled) {
				options.error = providerError(cause);
			} else marketError = providerError(cause);
		}
	}
	const assetView = requestedAssetView === 'options' && optionsDataEnabled ? 'options' : 'stock';

	return {
		requestedSymbol: rawSymbol,
		symbolValid: parsedSymbol?.success ?? rawSymbol.length === 0,
		assetView,
		optionsViewRequested: requestedAssetView === 'options',
		optionsDataEnabled,
		optionsTradingEnabled,
		optionsTradingReason,
		optionsMarketData,
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
