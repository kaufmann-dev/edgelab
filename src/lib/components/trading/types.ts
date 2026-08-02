import type { Component } from 'svelte';

export type TradingIcon = Component;

export type ValueDirection = 'up' | 'down' | 'flat' | 'neutral';
export type ValueTone = 'default' | 'positive' | 'negative' | 'warning' | 'info';

export type PortfolioAppRoute =
	| '/p/[portfolioId]/overview'
	| '/p/[portfolioId]/markets'
	| '/p/[portfolioId]/trade'
	| '/p/[portfolioId]/positions'
	| '/p/[portfolioId]/orders'
	| '/p/[portfolioId]/activity'
	| '/p/[portfolioId]/analytics'
	| '/p/[portfolioId]/journal';

export type GlobalAppRoute = '/' | '/portfolios' | '/learn' | '/settings';

interface AppNavItemBase {
	id: string;
	label: string;
	icon?: TradingIcon;
	badge?: string;
}

export type AppNavItem = AppNavItemBase &
	(
		| {
				route: PortfolioAppRoute;
				params: { portfolioId: string };
		  }
		| {
				route: GlobalAppRoute;
				params?: never;
		  }
	);

export type MarketFeedState =
	'connecting' | 'live' | 'delayed' | 'stale' | 'reconnecting' | 'offline';

export interface MetricItem {
	id: string;
	label: string;
	value: string;
	change?: string;
	direction?: ValueDirection;
	tone?: ValueTone;
	description?: string;
}

export interface EquityCurvePoint {
	id: string;
	timestamp: string;
	portfolioValue: number;
	benchmarkValue?: number;
}

export type AssetType = 'stock' | 'option';
export type PositionSide = 'long' | 'short';

export interface PositionRow {
	id: string;
	symbol: string;
	name?: string;
	strategy?: string;
	assetType: AssetType;
	side: PositionSide;
	quantity: number;
	averageCost: number;
	mark: number | null;
	marketValue: number | null;
	dayPnl: number | null;
	unrealizedPnl: number | null;
	totalReturnPercent: number | null;
	portfolioWeightPercent: number | null;
	expiration?: string;
	daysToExpiration?: number;
}

export type PositionSortKey =
	| 'symbol'
	| 'quantity'
	| 'averageCost'
	| 'mark'
	| 'marketValue'
	| 'dayPnl'
	| 'unrealizedPnl'
	| 'totalReturnPercent'
	| 'portfolioWeightPercent';

export type SortDirection = 'ascending' | 'descending';

export interface SortState<Key extends string> {
	key: Key;
	direction: SortDirection;
}

export type OrderSide = 'buy' | 'sell' | 'sell-short' | 'buy-to-cover';
export type PositionEffect = 'open' | 'close' | 'increase' | 'reduce';
export type StockOrderType = 'market' | 'limit' | 'stop' | 'stop-limit' | 'trailing-stop';
export type TimeInForce = 'day' | 'gtc' | 'ioc';
export type TradingSession = 'regular' | 'extended';
export type OrderStatus =
	'accepted' | 'working' | 'partially-filled' | 'filled' | 'cancelled' | 'expired' | 'rejected';

export interface OrderRow {
	id: string;
	submittedAt: string;
	symbol: string;
	strategy?: string;
	side: OrderSide;
	positionEffect: PositionEffect;
	quantity: number;
	filledQuantity: number;
	type: StockOrderType | 'net-debit' | 'net-credit';
	limitPrice?: number;
	stopPrice?: number;
	timeInForce: TimeInForce;
	status: OrderStatus;
	averageFillPrice?: number;
	statusDetail?: string;
	canEdit?: boolean;
	canCancel?: boolean;
}

export type OrderSortKey = 'submittedAt' | 'symbol' | 'quantity' | 'status' | 'averageFillPrice';

export interface StockQuote {
	symbol: string;
	name?: string;
	last: number;
	bid?: number;
	ask?: number;
	change?: number;
	changePercent?: number;
	asOf: string;
}

export interface StockOrderDraft {
	side: OrderSide;
	orderType: StockOrderType;
	quantityMode: 'shares' | 'notional';
	quantity: string;
	limitPrice: string;
	stopPrice: string;
	trailValue: string;
	trailUnit: 'amount' | 'percent';
	timeInForce: TimeInForce;
	session: TradingSession;
	bracketEnabled: boolean;
	takeProfitPrice: string;
	stopLossPrice: string;
}

export type StockOrderDraftPatch = Partial<StockOrderDraft>;

export interface OrderPreviewItem {
	id: string;
	label: string;
	value: string;
	tone?: ValueTone;
}

export type RiskCheckStatus = 'pass' | 'warning' | 'blocked';

export interface RiskCheck {
	id: string;
	label: string;
	status: RiskCheckStatus;
	detail: string;
	currentValue?: string;
	limitValue?: string;
}

export type OptionType = 'call' | 'put';

export interface OptionContractQuote {
	id: string;
	symbol: string;
	type: OptionType;
	strike: number;
	standardDeliverable: boolean;
	bid?: number;
	ask?: number;
	sessionClose?: number;
	delta?: number;
	impliedVolatilityPercent?: number;
	volume?: number;
	openInterest?: number;
	asOf?: string;
}

export interface OptionChainRow {
	id: string;
	strike: number;
	isAtTheMoney?: boolean;
	call?: OptionContractQuote;
	put?: OptionContractQuote;
}

export interface DataError {
	message: string;
	onRetry?: () => void;
}
