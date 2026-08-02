import type {
	Instrument,
	MarketSnapshot,
	NormalizedBar,
	NormalizedQuote,
	NormalizedTrade,
	OptionSnapshot
} from '$lib/server/market-data';

function serializeQuote(quote: NormalizedQuote | undefined) {
	if (!quote) return undefined;
	return {
		kind: quote.kind,
		symbol: quote.symbol,
		bidPrice: quote.bidPrice.toString(),
		askPrice: quote.askPrice.toString(),
		bidSize: quote.bidSize.toString(),
		askSize: quote.askSize.toString(),
		sourceTime: quote.sourceTime.toISOString(),
		receivedAt: quote.receivedAt.toISOString()
	};
}

function serializeTrade(trade: NormalizedTrade | undefined) {
	if (!trade) return undefined;
	return {
		kind: trade.kind,
		symbol: trade.symbol,
		price: trade.price.toString(),
		size: trade.size.toString(),
		sourceTime: trade.sourceTime.toISOString(),
		receivedAt: trade.receivedAt.toISOString()
	};
}

export function serializeBar(bar: NormalizedBar) {
	return {
		kind: bar.kind,
		symbol: bar.symbol,
		interval: bar.interval,
		startTime: bar.startTime.toISOString(),
		endTime: bar.endTime.toISOString(),
		open: bar.open.toString(),
		high: bar.high.toString(),
		low: bar.low.toString(),
		close: bar.close.toString(),
		volume: bar.volume.toString(),
		vwap: bar.vwap?.toString(),
		transactions: bar.transactions,
		mode: bar.mode,
		sourceTime: bar.sourceTime.toISOString(),
		receivedAt: bar.receivedAt.toISOString()
	};
}

export function serializeInstrument(instrument: Instrument) {
	if (instrument.assetClass === 'stocks') {
		return {
			assetClass: instrument.assetClass,
			symbol: instrument.symbol,
			name: instrument.name,
			currency: instrument.currency,
			active: instrument.active,
			primaryExchange: instrument.primaryExchange,
			tickerType: instrument.tickerType,
			roundLot: instrument.roundLot.toString()
		};
	}
	return {
		assetClass: instrument.assetClass,
		symbol: instrument.symbol,
		name: instrument.name,
		currency: instrument.currency,
		active: instrument.active,
		primaryExchange: instrument.primaryExchange,
		underlyingSymbol: instrument.underlyingSymbol,
		optionType: instrument.optionType,
		exerciseStyle: instrument.exerciseStyle,
		expirationDate: instrument.expirationDate,
		strikePrice: instrument.strikePrice.toString(),
		multiplier: instrument.multiplier.toString(),
		additionalUnderlyings: instrument.additionalUnderlyings.map((underlying) => ({
			...underlying,
			amount: underlying.amount.toString()
		}))
	};
}

export function serializeSnapshot(snapshot: MarketSnapshot) {
	return {
		assetClass: snapshot.assetClass,
		symbol: snapshot.symbol,
		name: snapshot.name,
		marketStatus: snapshot.marketStatus,
		mode: snapshot.mode,
		quote: serializeQuote(snapshot.quote),
		lastTrade: serializeTrade(snapshot.lastTrade),
		lastMinute: snapshot.lastMinute ? serializeBar(snapshot.lastMinute) : undefined,
		asOf: snapshot.asOf.toISOString()
	};
}

export function serializeOptionSnapshot(snapshot: OptionSnapshot) {
	return {
		instrument: serializeInstrument(snapshot.instrument),
		mode: snapshot.mode,
		quote: serializeQuote(snapshot.quote),
		lastTrade: serializeTrade(snapshot.lastTrade),
		day: snapshot.day ? serializeBar(snapshot.day) : undefined,
		greeks: snapshot.greeks
			? {
					delta: snapshot.greeks.delta?.toString(),
					gamma: snapshot.greeks.gamma?.toString(),
					theta: snapshot.greeks.theta?.toString(),
					vega: snapshot.greeks.vega?.toString()
				}
			: undefined,
		impliedVolatility: snapshot.impliedVolatility?.toString(),
		openInterest: snapshot.openInterest?.toString(),
		underlyingPrice: snapshot.underlyingPrice?.toString(),
		breakEvenPrice: snapshot.breakEvenPrice?.toString(),
		asOf: snapshot.asOf.toISOString()
	};
}
