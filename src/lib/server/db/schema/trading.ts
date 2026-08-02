import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { users } from './auth';

const moneyColumn = (name: string) => numeric(name, { precision: 24, scale: 8 });
const quantityColumn = (name: string) => numeric(name, { precision: 28, scale: 8 });

export const tradingPortfolios = pgTable(
	'trading_portfolios',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		baseCurrency: text('base_currency').notNull().default('USD'),
		startingCash: moneyColumn('starting_cash').notNull(),
		dataMode: text('data_mode').notNull(),
		executionModelVersion: text('execution_model_version').notNull(),
		riskModelVersion: text('risk_model_version').notNull(),
		status: text('status').notNull().default('active'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp('archived_at', { withTimezone: true })
	},
	(table) => [
		index('trading_portfolios_owner_status_idx').on(table.ownerUserId, table.status),
		check(
			'trading_portfolios_name_length_check',
			sql`length(btrim(${table.name})) between 1 and 48`
		),
		check('trading_portfolios_currency_check', sql`${table.baseCurrency} = 'USD'`),
		check(
			'trading_portfolios_starting_cash_check',
			sql`${table.startingCash} between 1000 and 100000000`
		),
		check('trading_portfolios_data_mode_check', sql`${table.dataMode} in ('realtime', 'delayed')`),
		check('trading_portfolios_status_check', sql`${table.status} in ('active', 'archived')`),
		check(
			'trading_portfolios_archive_check',
			sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`
		)
	]
);

export const tradingPortfolioPolicies = pgTable(
	'trading_portfolio_policies',
	{
		portfolioId: uuid('portfolio_id')
			.primaryKey()
			.references(() => tradingPortfolios.id, { onDelete: 'cascade' }),
		benchmarkSymbol: text('benchmark_symbol').notNull().default('SPY'),
		accountType: text('account_type').notNull().default('cash'),
		allowShortEquity: boolean('allow_short_equity').notNull().default(false),
		allowLongOptions: boolean('allow_long_options').notNull().default(false),
		allowExtendedHours: boolean('allow_extended_hours').notNull().default(false),
		requireTradePlan: boolean('require_trade_plan').notNull().default(false),
		maxOrderNotional: moneyColumn('max_order_notional'),
		maxPositionPercent: numeric('max_position_percent', { precision: 9, scale: 6 }),
		maxGrossExposurePercent: numeric('max_gross_exposure_percent', {
			precision: 9,
			scale: 6
		}),
		maxDailyLoss: moneyColumn('max_daily_loss'),
		maxDrawdownPercent: numeric('max_drawdown_percent', { precision: 9, scale: 6 }),
		maxOptionPremium: moneyColumn('max_option_premium'),
		riskBehavior: text('risk_behavior').notNull().default('block'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check(
			'trading_portfolio_policies_benchmark_check',
			sql`${table.benchmarkSymbol} ~ '^[A-Z][A-Z0-9.]{0,9}$'`
		),
		check(
			'trading_portfolio_policies_account_type_check',
			sql`${table.accountType} in ('cash', 'margin')`
		),
		check(
			'trading_portfolio_policies_permissions_check',
			sql`not (${table.accountType} = 'cash' and ${table.allowShortEquity})`
		),
		check(
			'trading_portfolio_policies_order_notional_check',
			sql`${table.maxOrderNotional} is null or ${table.maxOrderNotional} > 0`
		),
		check(
			'trading_portfolio_policies_position_percent_check',
			sql`${table.maxPositionPercent} is null or ${table.maxPositionPercent} > 0 and ${table.maxPositionPercent} <= 100`
		),
		check(
			'trading_portfolio_policies_gross_percent_check',
			sql`${table.maxGrossExposurePercent} is null or ${table.maxGrossExposurePercent} > 0 and ${table.maxGrossExposurePercent} <= 100`
		),
		check(
			'trading_portfolio_policies_daily_loss_check',
			sql`${table.maxDailyLoss} is null or ${table.maxDailyLoss} > 0`
		),
		check(
			'trading_portfolio_policies_drawdown_percent_check',
			sql`${table.maxDrawdownPercent} is null or ${table.maxDrawdownPercent} > 0 and ${table.maxDrawdownPercent} <= 100`
		),
		check(
			'trading_portfolio_policies_option_premium_check',
			sql`${table.maxOptionPremium} is null or ${table.maxOptionPremium} > 0`
		),
		check(
			'trading_portfolio_policies_risk_behavior_check',
			sql`${table.riskBehavior} in ('warn', 'block')`
		)
	]
);

export const tradingInstruments = pgTable(
	'trading_instruments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		symbol: text('symbol').notNull(),
		assetClass: text('asset_class').notNull(),
		name: text('name').notNull(),
		currency: text('currency').notNull().default('USD'),
		active: boolean('active').notNull().default(true),
		primaryExchange: text('primary_exchange'),
		tickerType: text('ticker_type'),
		roundLot: quantityColumn('round_lot'),
		underlyingSymbol: text('underlying_symbol'),
		optionType: text('option_type'),
		exerciseStyle: text('exercise_style'),
		expirationDate: date('expiration_date'),
		strikePrice: moneyColumn('strike_price'),
		contractMultiplier: quantityColumn('contract_multiplier'),
		additionalUnderlyings: jsonb('additional_underlyings')
			.$type<Array<{ type: string; underlying: string; amount: string }>>()
			.notNull()
			.default([]),
		sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_instruments_symbol_uidx').on(table.symbol),
		index('trading_instruments_underlying_expiry_idx').on(
			table.underlyingSymbol,
			table.expirationDate
		),
		check(
			'trading_instruments_asset_class_check',
			sql`${table.assetClass} in ('stocks', 'options')`
		),
		check('trading_instruments_currency_check', sql`${table.currency} = 'USD'`),
		check('trading_instruments_symbol_length_check', sql`length(${table.symbol}) between 1 and 64`),
		check(
			'trading_instruments_shape_check',
			sql`(
				${table.assetClass} = 'stocks'
				and ${table.roundLot} > 0
				and ${table.underlyingSymbol} is null
				and ${table.optionType} is null
				and ${table.expirationDate} is null
				and ${table.strikePrice} is null
				and ${table.contractMultiplier} is null
			) or (
				${table.assetClass} = 'options'
				and ${table.underlyingSymbol} is not null
				and ${table.optionType} in ('call', 'put')
				and ${table.exerciseStyle} in ('american', 'bermudan', 'european')
				and ${table.expirationDate} is not null
				and ${table.strikePrice} >= 0
				and ${table.contractMultiplier} > 0
			)`
		)
	]
);

export const tradingWatchlists = pgTable(
	'trading_watchlists',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'cascade' }),
		name: text('name').notNull().default('Watchlist'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_watchlists_portfolio_name_uidx').on(table.portfolioId, table.name),
		check(
			'trading_watchlists_name_length_check',
			sql`length(btrim(${table.name})) between 1 and 48`
		)
	]
);

export const tradingWatchlistItems = pgTable(
	'trading_watchlist_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		watchlistId: uuid('watchlist_id')
			.notNull()
			.references(() => tradingWatchlists.id, { onDelete: 'cascade' }),
		instrumentId: uuid('instrument_id')
			.notNull()
			.references(() => tradingInstruments.id, { onDelete: 'cascade' }),
		addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_watchlist_items_watchlist_instrument_uidx').on(
			table.watchlistId,
			table.instrumentId
		),
		index('trading_watchlist_items_instrument_idx').on(table.instrumentId)
	]
);

export const tradingJournalEntries = pgTable(
	'trading_journal_entries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'cascade' }),
		instrumentId: uuid('instrument_id').references(() => tradingInstruments.id, {
			onDelete: 'set null'
		}),
		symbol: text('symbol'),
		phase: text('phase').notNull(),
		thesis: text('thesis'),
		invalidation: text('invalidation'),
		notes: text('notes').notNull(),
		tags: text('tags')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		confidence: integer('confidence'),
		followedPlan: boolean('followed_plan'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('trading_journal_entries_portfolio_created_idx').on(table.portfolioId, table.createdAt),
		index('trading_journal_entries_instrument_idx').on(table.instrumentId),
		check(
			'trading_journal_entries_phase_check',
			sql`${table.phase} in ('pre_trade', 'post_trade', 'general')`
		),
		check(
			'trading_journal_entries_symbol_length_check',
			sql`${table.symbol} is null or length(btrim(${table.symbol})) between 1 and 20`
		),
		check(
			'trading_journal_entries_thesis_length_check',
			sql`${table.thesis} is null or length(${table.thesis}) <= 4000`
		),
		check(
			'trading_journal_entries_invalidation_length_check',
			sql`${table.invalidation} is null or length(${table.invalidation}) <= 1000`
		),
		check(
			'trading_journal_entries_notes_length_check',
			sql`length(btrim(${table.notes})) between 1 and 10000`
		),
		check('trading_journal_entries_tags_check', sql`cardinality(${table.tags}) <= 12`),
		check(
			'trading_journal_entries_confidence_check',
			sql`${table.confidence} is null or ${table.confidence} between 1 and 5`
		)
	]
);

export const tradingOrders = pgTable(
	'trading_orders',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'restrict' }),
		tradePlanId: uuid('trade_plan_id').references(() => tradingJournalEntries.id, {
			onDelete: 'restrict'
		}),
		clientOrderId: text('client_order_id').notNull(),
		orderType: text('order_type').notNull(),
		timeInForce: text('time_in_force').notNull(),
		netPriceEffect: text('net_price_effect').notNull().default('debit'),
		status: text('status').notNull(),
		quantity: quantityColumn('quantity').notNull(),
		filledQuantity: quantityColumn('filled_quantity').notNull().default('0'),
		limitPrice: moneyColumn('limit_price'),
		stopPrice: moneyColumn('stop_price'),
		trailingPercent: numeric('trailing_percent', { precision: 10, scale: 6 }),
		trailingWatermark: moneyColumn('trailing_watermark'),
		trailingStopPrice: moneyColumn('trailing_stop_price'),
		extendedHours: boolean('extended_hours').notNull().default(false),
		executionModelVersion: text('execution_model_version').notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		eligibleAt: timestamp('eligible_at', { withTimezone: true }),
		triggeredAt: timestamp('triggered_at', { withTimezone: true }),
		lastEvaluatedBarEndAt: timestamp('last_evaluated_bar_end_at', { withTimezone: true }),
		terminalAt: timestamp('terminal_at', { withTimezone: true }),
		rejectionReason: text('rejection_reason'),
		revision: integer('revision').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_orders_portfolio_client_order_uidx').on(
			table.portfolioId,
			table.clientOrderId
		),
		index('trading_orders_portfolio_status_created_idx').on(
			table.portfolioId,
			table.status,
			table.createdAt
		),
		index('trading_orders_trade_plan_idx').on(table.tradePlanId),
		check(
			'trading_orders_type_check',
			sql`${table.orderType} in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop')`
		),
		check('trading_orders_tif_check', sql`${table.timeInForce} in ('day', 'gtc', 'ioc')`),
		check('trading_orders_net_effect_check', sql`${table.netPriceEffect} in ('debit', 'credit')`),
		check(
			'trading_orders_status_check',
			sql`${table.status} in ('pending_new', 'open', 'partially_filled', 'filled', 'canceled', 'expired', 'rejected')`
		),
		check(
			'trading_orders_quantity_check',
			sql`${table.quantity} > 0 and ${table.filledQuantity} >= 0 and ${table.filledQuantity} <= ${table.quantity}`
		),
		check(
			'trading_orders_price_shape_check',
			sql`(
				${table.orderType} = 'market'
				and ${table.limitPrice} is null
				and ${table.stopPrice} is null
				and ${table.trailingPercent} is null
			) or (
				${table.orderType} = 'limit' and ${table.limitPrice} > 0
			) or (
				${table.orderType} = 'stop' and ${table.stopPrice} > 0
			) or (
				${table.orderType} = 'stop_limit' and ${table.stopPrice} > 0 and ${table.limitPrice} > 0
			) or (
				${table.orderType} = 'trailing_stop' and ${table.trailingPercent} > 0 and ${table.trailingPercent} <= 100
			)`
		),
		check(
			'trading_orders_terminal_check',
			sql`(${table.status} in ('filled', 'canceled', 'expired', 'rejected')) = (${table.terminalAt} is not null)`
		),
		check(
			'trading_orders_trailing_state_check',
			sql`(${table.trailingWatermark} is null and ${table.trailingStopPrice} is null) or (${table.orderType} = 'trailing_stop' and ${table.trailingWatermark} > 0 and ${table.trailingStopPrice} > 0)`
		),
		check('trading_orders_revision_check', sql`${table.revision} > 0`)
	]
);

export const tradingOrderLegs = pgTable(
	'trading_order_legs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => tradingOrders.id, { onDelete: 'cascade' }),
		instrumentId: uuid('instrument_id')
			.notNull()
			.references(() => tradingInstruments.id, { onDelete: 'restrict' }),
		legNumber: integer('leg_number').notNull(),
		side: text('side').notNull(),
		positionEffect: text('position_effect').notNull(),
		ratioQuantity: quantityColumn('ratio_quantity').notNull(),
		filledQuantity: quantityColumn('filled_quantity').notNull().default('0')
	},
	(table) => [
		uniqueIndex('trading_order_legs_order_number_uidx').on(table.orderId, table.legNumber),
		uniqueIndex('trading_order_legs_order_instrument_uidx').on(table.orderId, table.instrumentId),
		index('trading_order_legs_instrument_idx').on(table.instrumentId),
		check('trading_order_legs_number_check', sql`${table.legNumber} = 1`),
		check('trading_order_legs_side_check', sql`${table.side} in ('buy', 'sell')`),
		check(
			'trading_order_legs_position_effect_check',
			sql`${table.positionEffect} in ('open', 'close')`
		),
		check(
			'trading_order_legs_quantity_check',
			sql`${table.ratioQuantity} = 1 and ${table.filledQuantity} >= 0`
		)
	]
);

export const tradingOrderEvents = pgTable(
	'trading_order_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => tradingOrders.id, { onDelete: 'cascade' }),
		fromStatus: text('from_status'),
		toStatus: text('to_status').notNull(),
		reason: text('reason'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('trading_order_events_order_occurred_idx').on(table.orderId, table.occurredAt),
		check(
			'trading_order_events_to_status_check',
			sql`${table.toStatus} in ('pending_new', 'open', 'partially_filled', 'filled', 'canceled', 'expired', 'rejected')`
		)
	]
);

export const tradingFills = pgTable(
	'trading_fills',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => tradingOrders.id, { onDelete: 'restrict' }),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'restrict' }),
		strategyQuantity: quantityColumn('strategy_quantity').notNull(),
		marketDataMode: text('market_data_mode').notNull(),
		sourceEventKind: text('source_event_kind').notNull(),
		sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }).notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
		sourceSequence: text('source_sequence'),
		executionModelVersion: text('execution_model_version').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		unique('trading_fills_order_source_uidx')
			.on(table.orderId, table.sourceEventKind, table.sourceTimestamp, table.sourceSequence)
			.nullsNotDistinct(),
		index('trading_fills_order_created_idx').on(table.orderId, table.createdAt),
		index('trading_fills_portfolio_created_idx').on(table.portfolioId, table.createdAt),
		check('trading_fills_quantity_check', sql`${table.strategyQuantity} > 0`),
		check('trading_fills_mode_check', sql`${table.marketDataMode} in ('realtime', 'delayed')`),
		check('trading_fills_event_kind_check', sql`${table.sourceEventKind} = 'bar'`)
	]
);

export const tradingFillLegs = pgTable(
	'trading_fill_legs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		fillId: uuid('fill_id')
			.notNull()
			.references(() => tradingFills.id, { onDelete: 'cascade' }),
		orderLegId: uuid('order_leg_id')
			.notNull()
			.references(() => tradingOrderLegs.id, { onDelete: 'restrict' }),
		instrumentId: uuid('instrument_id')
			.notNull()
			.references(() => tradingInstruments.id, { onDelete: 'restrict' }),
		quantity: quantityColumn('quantity').notNull(),
		price: moneyColumn('price').notNull(),
		multiplier: quantityColumn('multiplier').notNull(),
		grossAmount: moneyColumn('gross_amount').notNull(),
		fees: moneyColumn('fees').notNull().default('0'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_fill_legs_fill_order_leg_uidx').on(table.fillId, table.orderLegId),
		index('trading_fill_legs_order_leg_idx').on(table.orderLegId),
		index('trading_fill_legs_instrument_created_idx').on(table.instrumentId, table.createdAt),
		check(
			'trading_fill_legs_amount_check',
			sql`${table.quantity} > 0 and ${table.price} > 0 and ${table.multiplier} > 0 and ${table.grossAmount} > 0 and ${table.fees} >= 0`
		)
	]
);

export const tradingCashLedger = pgTable(
	'trading_cash_ledger',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'restrict' }),
		fillId: uuid('fill_id').references(() => tradingFills.id, { onDelete: 'restrict' }),
		entryType: text('entry_type').notNull(),
		amount: moneyColumn('amount').notNull(),
		currency: text('currency').notNull().default('USD'),
		description: text('description').notNull(),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('trading_cash_ledger_portfolio_occurred_idx').on(table.portfolioId, table.occurredAt),
		index('trading_cash_ledger_fill_idx').on(table.fillId),
		check(
			'trading_cash_ledger_type_check',
			sql`${table.entryType} in ('initial_capital', 'trade', 'fee', 'dividend', 'adjustment')`
		),
		check('trading_cash_ledger_amount_check', sql`${table.amount} <> 0`),
		check('trading_cash_ledger_currency_check', sql`${table.currency} = 'USD'`)
	]
);

export const tradingPositions = pgTable(
	'trading_positions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'restrict' }),
		instrumentId: uuid('instrument_id')
			.notNull()
			.references(() => tradingInstruments.id, { onDelete: 'restrict' }),
		quantity: quantityColumn('quantity').notNull().default('0'),
		averageCost: moneyColumn('average_cost').notNull().default('0'),
		realizedPnl: moneyColumn('realized_pnl').notNull().default('0'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_positions_portfolio_instrument_uidx').on(
			table.portfolioId,
			table.instrumentId
		),
		index('trading_positions_instrument_idx').on(table.instrumentId),
		check('trading_positions_average_cost_check', sql`${table.averageCost} >= 0`)
	]
);

export const tradingEquitySnapshots = pgTable(
	'trading_equity_snapshots',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'cascade' }),
		asOf: timestamp('as_of', { withTimezone: true }).notNull(),
		cashBalance: moneyColumn('cash_balance').notNull(),
		netMarketValue: moneyColumn('net_market_value').notNull(),
		grossExposure: moneyColumn('gross_exposure').notNull(),
		equity: moneyColumn('equity').notNull(),
		realizedPnl: moneyColumn('realized_pnl').notNull().default('0'),
		unrealizedPnl: moneyColumn('unrealized_pnl').notNull().default('0'),
		benchmarkPrice: moneyColumn('benchmark_price'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('trading_equity_snapshots_portfolio_as_of_uidx').on(table.portfolioId, table.asOf),
		index('trading_equity_snapshots_as_of_idx').on(table.asOf),
		check(
			'trading_equity_snapshots_balance_check',
			sql`${table.cashBalance} >= 0 and ${table.grossExposure} >= 0`
		),
		check(
			'trading_equity_snapshots_exposure_check',
			sql`abs(${table.netMarketValue}) <= ${table.grossExposure}`
		),
		check(
			'trading_equity_snapshots_equity_check',
			sql`${table.equity} = ${table.cashBalance} + ${table.netMarketValue}`
		),
		check(
			'trading_equity_snapshots_benchmark_check',
			sql`${table.benchmarkPrice} is null or ${table.benchmarkPrice} > 0`
		)
	]
);

export const tradingReservations = pgTable(
	'trading_reservations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => tradingOrders.id, { onDelete: 'cascade' }),
		portfolioId: uuid('portfolio_id')
			.notNull()
			.references(() => tradingPortfolios.id, { onDelete: 'restrict' }),
		instrumentId: uuid('instrument_id').references(() => tradingInstruments.id, {
			onDelete: 'restrict'
		}),
		reservationType: text('reservation_type').notNull(),
		amount: quantityColumn('amount').notNull(),
		status: text('status').notNull().default('active'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		releasedAt: timestamp('released_at', { withTimezone: true })
	},
	(table) => [
		index('trading_reservations_order_status_idx').on(table.orderId, table.status),
		index('trading_reservations_portfolio_status_idx').on(table.portfolioId, table.status),
		index('trading_reservations_instrument_idx').on(table.instrumentId),
		check(
			'trading_reservations_type_check',
			sql`${table.reservationType} in ('cash', 'shares', 'buying_power')`
		),
		check('trading_reservations_amount_check', sql`${table.amount} > 0`),
		check(
			'trading_reservations_status_check',
			sql`${table.status} in ('active', 'released', 'consumed')`
		),
		check(
			'trading_reservations_release_check',
			sql`(${table.status} = 'active' and ${table.releasedAt} is null) or (${table.status} <> 'active' and ${table.releasedAt} is not null)`
		)
	]
);
