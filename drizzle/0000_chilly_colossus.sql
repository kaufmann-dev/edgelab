CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"id_token_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_sessions_idle_not_after_absolute_check" CHECK ("auth_sessions"."idle_expires_at" <= "auth_sessions"."absolute_expires_at"),
	CONSTRAINT "auth_sessions_activity_order_check" CHECK ("auth_sessions"."created_at" <= "auth_sessions"."last_active_at")
);
--> statement-breakpoint
CREATE TABLE "oidc_login_requests" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier_ciphertext" text NOT NULL,
	"return_to" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oidc_login_requests_expiry_order_check" CHECK ("oidc_login_requests"."created_at" < "oidc_login_requests"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_cash_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"fill_id" uuid,
	"entry_type" text NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_cash_ledger_type_check" CHECK ("trading_cash_ledger"."entry_type" in ('initial_capital', 'trade', 'fee', 'dividend', 'adjustment')),
	CONSTRAINT "trading_cash_ledger_amount_check" CHECK ("trading_cash_ledger"."amount" <> 0),
	CONSTRAINT "trading_cash_ledger_currency_check" CHECK ("trading_cash_ledger"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "trading_equity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"cash_balance" numeric(24, 8) NOT NULL,
	"net_market_value" numeric(24, 8) NOT NULL,
	"gross_exposure" numeric(24, 8) NOT NULL,
	"equity" numeric(24, 8) NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"benchmark_price" numeric(24, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_equity_snapshots_balance_check" CHECK ("trading_equity_snapshots"."cash_balance" >= 0 and "trading_equity_snapshots"."gross_exposure" >= 0),
	CONSTRAINT "trading_equity_snapshots_exposure_check" CHECK (abs("trading_equity_snapshots"."net_market_value") <= "trading_equity_snapshots"."gross_exposure"),
	CONSTRAINT "trading_equity_snapshots_equity_check" CHECK ("trading_equity_snapshots"."equity" = "trading_equity_snapshots"."cash_balance" + "trading_equity_snapshots"."net_market_value"),
	CONSTRAINT "trading_equity_snapshots_benchmark_check" CHECK ("trading_equity_snapshots"."benchmark_price" is null or "trading_equity_snapshots"."benchmark_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "trading_fill_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fill_id" uuid NOT NULL,
	"order_leg_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(28, 8) NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"multiplier" numeric(28, 8) NOT NULL,
	"gross_amount" numeric(24, 8) NOT NULL,
	"fees" numeric(24, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_fill_legs_amount_check" CHECK ("trading_fill_legs"."quantity" > 0 and "trading_fill_legs"."price" > 0 and "trading_fill_legs"."multiplier" > 0 and "trading_fill_legs"."gross_amount" > 0 and "trading_fill_legs"."fees" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trading_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"strategy_quantity" numeric(28, 8) NOT NULL,
	"market_data_mode" text NOT NULL,
	"source_event_kind" text NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"source_sequence" text,
	"execution_model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_fills_order_source_uidx" UNIQUE NULLS NOT DISTINCT("order_id","source_event_kind","source_timestamp","source_sequence"),
	CONSTRAINT "trading_fills_quantity_check" CHECK ("trading_fills"."strategy_quantity" > 0),
	CONSTRAINT "trading_fills_mode_check" CHECK ("trading_fills"."market_data_mode" in ('realtime', 'delayed')),
	CONSTRAINT "trading_fills_event_kind_check" CHECK ("trading_fills"."source_event_kind" in ('quote', 'trade', 'bar'))
);
--> statement-breakpoint
CREATE TABLE "trading_instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"asset_class" text NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"primary_exchange" text,
	"ticker_type" text,
	"round_lot" numeric(28, 8),
	"underlying_symbol" text,
	"option_type" text,
	"exercise_style" text,
	"expiration_date" date,
	"strike_price" numeric(24, 8),
	"contract_multiplier" numeric(28, 8),
	"additional_underlyings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_instruments_asset_class_check" CHECK ("trading_instruments"."asset_class" in ('stocks', 'options')),
	CONSTRAINT "trading_instruments_currency_check" CHECK ("trading_instruments"."currency" = 'USD'),
	CONSTRAINT "trading_instruments_symbol_length_check" CHECK (length("trading_instruments"."symbol") between 1 and 64),
	CONSTRAINT "trading_instruments_shape_check" CHECK ((
				"trading_instruments"."asset_class" = 'stocks'
				and "trading_instruments"."round_lot" > 0
				and "trading_instruments"."underlying_symbol" is null
				and "trading_instruments"."option_type" is null
				and "trading_instruments"."expiration_date" is null
				and "trading_instruments"."strike_price" is null
				and "trading_instruments"."contract_multiplier" is null
			) or (
				"trading_instruments"."asset_class" = 'options'
				and "trading_instruments"."underlying_symbol" is not null
				and "trading_instruments"."option_type" in ('call', 'put')
				and "trading_instruments"."exercise_style" in ('american', 'bermudan', 'european')
				and "trading_instruments"."expiration_date" is not null
				and "trading_instruments"."strike_price" >= 0
				and "trading_instruments"."contract_multiplier" > 0
			))
);
--> statement-breakpoint
CREATE TABLE "trading_journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid,
	"symbol" text,
	"phase" text NOT NULL,
	"thesis" text,
	"invalidation" text,
	"notes" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence" integer,
	"followed_plan" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_journal_entries_phase_check" CHECK ("trading_journal_entries"."phase" in ('pre_trade', 'post_trade', 'general')),
	CONSTRAINT "trading_journal_entries_symbol_length_check" CHECK ("trading_journal_entries"."symbol" is null or length(btrim("trading_journal_entries"."symbol")) between 1 and 20),
	CONSTRAINT "trading_journal_entries_thesis_length_check" CHECK ("trading_journal_entries"."thesis" is null or length("trading_journal_entries"."thesis") <= 4000),
	CONSTRAINT "trading_journal_entries_invalidation_length_check" CHECK ("trading_journal_entries"."invalidation" is null or length("trading_journal_entries"."invalidation") <= 1000),
	CONSTRAINT "trading_journal_entries_notes_length_check" CHECK (length(btrim("trading_journal_entries"."notes")) between 1 and 10000),
	CONSTRAINT "trading_journal_entries_tags_check" CHECK (cardinality("trading_journal_entries"."tags") <= 12),
	CONSTRAINT "trading_journal_entries_confidence_check" CHECK ("trading_journal_entries"."confidence" is null or "trading_journal_entries"."confidence" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "trading_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_order_events_to_status_check" CHECK ("trading_order_events"."to_status" in ('pending_new', 'open', 'partially_filled', 'filled', 'canceled', 'expired', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "trading_order_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"leg_number" integer NOT NULL,
	"side" text NOT NULL,
	"position_effect" text NOT NULL,
	"ratio_quantity" numeric(28, 8) NOT NULL,
	"filled_quantity" numeric(28, 8) DEFAULT '0' NOT NULL,
	CONSTRAINT "trading_order_legs_number_check" CHECK ("trading_order_legs"."leg_number" between 1 and 4),
	CONSTRAINT "trading_order_legs_side_check" CHECK ("trading_order_legs"."side" in ('buy', 'sell')),
	CONSTRAINT "trading_order_legs_position_effect_check" CHECK ("trading_order_legs"."position_effect" in ('open', 'close')),
	CONSTRAINT "trading_order_legs_quantity_check" CHECK ("trading_order_legs"."ratio_quantity" > 0 and "trading_order_legs"."filled_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trading_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"trade_plan_id" uuid,
	"client_order_id" text NOT NULL,
	"order_type" text NOT NULL,
	"time_in_force" text NOT NULL,
	"net_price_effect" text DEFAULT 'debit' NOT NULL,
	"status" text NOT NULL,
	"quantity" numeric(28, 8) NOT NULL,
	"filled_quantity" numeric(28, 8) DEFAULT '0' NOT NULL,
	"limit_price" numeric(24, 8),
	"stop_price" numeric(24, 8),
	"trailing_percent" numeric(10, 6),
	"trailing_watermark" numeric(24, 8),
	"trailing_stop_price" numeric(24, 8),
	"extended_hours" boolean DEFAULT false NOT NULL,
	"execution_model_version" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"eligible_at" timestamp with time zone,
	"triggered_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"rejection_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_orders_type_check" CHECK ("trading_orders"."order_type" in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop')),
	CONSTRAINT "trading_orders_tif_check" CHECK ("trading_orders"."time_in_force" in ('day', 'gtc', 'ioc')),
	CONSTRAINT "trading_orders_net_effect_check" CHECK ("trading_orders"."net_price_effect" in ('debit', 'credit')),
	CONSTRAINT "trading_orders_status_check" CHECK ("trading_orders"."status" in ('pending_new', 'open', 'partially_filled', 'filled', 'canceled', 'expired', 'rejected')),
	CONSTRAINT "trading_orders_quantity_check" CHECK ("trading_orders"."quantity" > 0 and "trading_orders"."filled_quantity" >= 0 and "trading_orders"."filled_quantity" <= "trading_orders"."quantity"),
	CONSTRAINT "trading_orders_price_shape_check" CHECK ((
				"trading_orders"."order_type" = 'market'
				and "trading_orders"."limit_price" is null
				and "trading_orders"."stop_price" is null
				and "trading_orders"."trailing_percent" is null
			) or (
				"trading_orders"."order_type" = 'limit' and "trading_orders"."limit_price" > 0
			) or (
				"trading_orders"."order_type" = 'stop' and "trading_orders"."stop_price" > 0
			) or (
				"trading_orders"."order_type" = 'stop_limit' and "trading_orders"."stop_price" > 0 and "trading_orders"."limit_price" > 0
			) or (
				"trading_orders"."order_type" = 'trailing_stop' and "trading_orders"."trailing_percent" > 0 and "trading_orders"."trailing_percent" <= 100
			)),
	CONSTRAINT "trading_orders_terminal_check" CHECK (("trading_orders"."status" in ('filled', 'canceled', 'expired', 'rejected')) = ("trading_orders"."terminal_at" is not null)),
	CONSTRAINT "trading_orders_trailing_state_check" CHECK (("trading_orders"."trailing_watermark" is null and "trading_orders"."trailing_stop_price" is null) or ("trading_orders"."order_type" = 'trailing_stop' and "trading_orders"."trailing_watermark" > 0 and "trading_orders"."trailing_stop_price" > 0)),
	CONSTRAINT "trading_orders_revision_check" CHECK ("trading_orders"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "trading_portfolio_policies" (
	"portfolio_id" uuid PRIMARY KEY NOT NULL,
	"benchmark_symbol" text DEFAULT 'SPY' NOT NULL,
	"account_type" text DEFAULT 'cash' NOT NULL,
	"allow_short_equity" boolean DEFAULT false NOT NULL,
	"allow_long_options" boolean DEFAULT true NOT NULL,
	"allow_covered_options" boolean DEFAULT false NOT NULL,
	"allow_defined_risk_spreads" boolean DEFAULT false NOT NULL,
	"allow_extended_hours" boolean DEFAULT false NOT NULL,
	"require_trade_plan" boolean DEFAULT false NOT NULL,
	"max_order_notional" numeric(24, 8),
	"max_position_percent" numeric(9, 6),
	"max_gross_exposure_percent" numeric(9, 6),
	"max_daily_loss" numeric(24, 8),
	"max_drawdown_percent" numeric(9, 6),
	"max_option_premium" numeric(24, 8),
	"risk_behavior" text DEFAULT 'block' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_portfolio_policies_benchmark_check" CHECK ("trading_portfolio_policies"."benchmark_symbol" ~ '^[A-Z][A-Z0-9.]{0,9}$'),
	CONSTRAINT "trading_portfolio_policies_account_type_check" CHECK ("trading_portfolio_policies"."account_type" in ('cash', 'margin')),
	CONSTRAINT "trading_portfolio_policies_permissions_check" CHECK (not ("trading_portfolio_policies"."account_type" = 'cash' and "trading_portfolio_policies"."allow_short_equity")
				and not ("trading_portfolio_policies"."allow_defined_risk_spreads" and not "trading_portfolio_policies"."allow_long_options")),
	CONSTRAINT "trading_portfolio_policies_order_notional_check" CHECK ("trading_portfolio_policies"."max_order_notional" is null or "trading_portfolio_policies"."max_order_notional" > 0),
	CONSTRAINT "trading_portfolio_policies_position_percent_check" CHECK ("trading_portfolio_policies"."max_position_percent" is null or "trading_portfolio_policies"."max_position_percent" > 0 and "trading_portfolio_policies"."max_position_percent" <= 100),
	CONSTRAINT "trading_portfolio_policies_gross_percent_check" CHECK ("trading_portfolio_policies"."max_gross_exposure_percent" is null or "trading_portfolio_policies"."max_gross_exposure_percent" > 0 and "trading_portfolio_policies"."max_gross_exposure_percent" <= 100),
	CONSTRAINT "trading_portfolio_policies_daily_loss_check" CHECK ("trading_portfolio_policies"."max_daily_loss" is null or "trading_portfolio_policies"."max_daily_loss" > 0),
	CONSTRAINT "trading_portfolio_policies_drawdown_percent_check" CHECK ("trading_portfolio_policies"."max_drawdown_percent" is null or "trading_portfolio_policies"."max_drawdown_percent" > 0 and "trading_portfolio_policies"."max_drawdown_percent" <= 100),
	CONSTRAINT "trading_portfolio_policies_option_premium_check" CHECK ("trading_portfolio_policies"."max_option_premium" is null or "trading_portfolio_policies"."max_option_premium" > 0),
	CONSTRAINT "trading_portfolio_policies_risk_behavior_check" CHECK ("trading_portfolio_policies"."risk_behavior" in ('warn', 'block'))
);
--> statement-breakpoint
CREATE TABLE "trading_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"starting_cash" numeric(24, 8) NOT NULL,
	"data_mode" text NOT NULL,
	"execution_model_version" text NOT NULL,
	"risk_model_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "trading_portfolios_name_length_check" CHECK (length(btrim("trading_portfolios"."name")) between 1 and 48),
	CONSTRAINT "trading_portfolios_currency_check" CHECK ("trading_portfolios"."base_currency" = 'USD'),
	CONSTRAINT "trading_portfolios_starting_cash_check" CHECK ("trading_portfolios"."starting_cash" between 1000 and 100000000),
	CONSTRAINT "trading_portfolios_data_mode_check" CHECK ("trading_portfolios"."data_mode" = 'realtime'),
	CONSTRAINT "trading_portfolios_status_check" CHECK ("trading_portfolios"."status" in ('active', 'archived')),
	CONSTRAINT "trading_portfolios_archive_check" CHECK (("trading_portfolios"."status" = 'active' and "trading_portfolios"."archived_at" is null) or ("trading_portfolios"."status" = 'archived' and "trading_portfolios"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "trading_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(28, 8) DEFAULT '0' NOT NULL,
	"average_cost" numeric(24, 8) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_positions_average_cost_check" CHECK ("trading_positions"."average_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trading_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid,
	"reservation_type" text NOT NULL,
	"amount" numeric(28, 8) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "trading_reservations_type_check" CHECK ("trading_reservations"."reservation_type" in ('cash', 'shares', 'buying_power')),
	CONSTRAINT "trading_reservations_amount_check" CHECK ("trading_reservations"."amount" > 0),
	CONSTRAINT "trading_reservations_status_check" CHECK ("trading_reservations"."status" in ('active', 'released', 'consumed')),
	CONSTRAINT "trading_reservations_release_check" CHECK (("trading_reservations"."status" = 'active' and "trading_reservations"."released_at" is null) or ("trading_reservations"."status" <> 'active' and "trading_reservations"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "trading_watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"name" text DEFAULT 'Watchlist' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_watchlists_name_length_check" CHECK (length(btrim("trading_watchlists"."name")) between 1 and 48)
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_cash_ledger" ADD CONSTRAINT "trading_cash_ledger_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_cash_ledger" ADD CONSTRAINT "trading_cash_ledger_fill_id_trading_fills_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."trading_fills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_equity_snapshots" ADD CONSTRAINT "trading_equity_snapshots_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fill_legs" ADD CONSTRAINT "trading_fill_legs_fill_id_trading_fills_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."trading_fills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fill_legs" ADD CONSTRAINT "trading_fill_legs_order_leg_id_trading_order_legs_id_fk" FOREIGN KEY ("order_leg_id") REFERENCES "public"."trading_order_legs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fill_legs" ADD CONSTRAINT "trading_fill_legs_instrument_id_trading_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."trading_instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_journal_entries" ADD CONSTRAINT "trading_journal_entries_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_journal_entries" ADD CONSTRAINT "trading_journal_entries_instrument_id_trading_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."trading_instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_order_events" ADD CONSTRAINT "trading_order_events_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_order_legs" ADD CONSTRAINT "trading_order_legs_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_order_legs" ADD CONSTRAINT "trading_order_legs_instrument_id_trading_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."trading_instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD CONSTRAINT "trading_orders_trade_plan_id_trading_journal_entries_id_fk" FOREIGN KEY ("trade_plan_id") REFERENCES "public"."trading_journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_portfolio_policies" ADD CONSTRAINT "trading_portfolio_policies_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_portfolios" ADD CONSTRAINT "trading_portfolios_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_positions" ADD CONSTRAINT "trading_positions_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_positions" ADD CONSTRAINT "trading_positions_instrument_id_trading_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."trading_instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_reservations" ADD CONSTRAINT "trading_reservations_order_id_trading_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trading_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_reservations" ADD CONSTRAINT "trading_reservations_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_reservations" ADD CONSTRAINT "trading_reservations_instrument_id_trading_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."trading_instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_watchlist_items" ADD CONSTRAINT "trading_watchlist_items_watchlist_id_trading_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."trading_watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_watchlist_items" ADD CONSTRAINT "trading_watchlist_items_instrument_id_trading_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."trading_instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_watchlists" ADD CONSTRAINT "trading_watchlists_portfolio_id_trading_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."trading_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_idle_expires_at_idx" ON "auth_sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_absolute_expires_at_idx" ON "auth_sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_login_requests_state_uidx" ON "oidc_login_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "oidc_login_requests_expires_at_idx" ON "oidc_login_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_issuer_subject_uidx" ON "app_users" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "app_users_last_login_at_idx" ON "app_users" USING btree ("last_login_at");--> statement-breakpoint
CREATE INDEX "trading_cash_ledger_portfolio_occurred_idx" ON "trading_cash_ledger" USING btree ("portfolio_id","occurred_at");--> statement-breakpoint
CREATE INDEX "trading_cash_ledger_fill_idx" ON "trading_cash_ledger" USING btree ("fill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_equity_snapshots_portfolio_as_of_uidx" ON "trading_equity_snapshots" USING btree ("portfolio_id","as_of");--> statement-breakpoint
CREATE INDEX "trading_equity_snapshots_as_of_idx" ON "trading_equity_snapshots" USING btree ("as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_fill_legs_fill_order_leg_uidx" ON "trading_fill_legs" USING btree ("fill_id","order_leg_id");--> statement-breakpoint
CREATE INDEX "trading_fill_legs_order_leg_idx" ON "trading_fill_legs" USING btree ("order_leg_id");--> statement-breakpoint
CREATE INDEX "trading_fill_legs_instrument_created_idx" ON "trading_fill_legs" USING btree ("instrument_id","created_at");--> statement-breakpoint
CREATE INDEX "trading_fills_order_created_idx" ON "trading_fills" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "trading_fills_portfolio_created_idx" ON "trading_fills" USING btree ("portfolio_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_instruments_symbol_uidx" ON "trading_instruments" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "trading_instruments_underlying_expiry_idx" ON "trading_instruments" USING btree ("underlying_symbol","expiration_date");--> statement-breakpoint
CREATE INDEX "trading_journal_entries_portfolio_created_idx" ON "trading_journal_entries" USING btree ("portfolio_id","created_at");--> statement-breakpoint
CREATE INDEX "trading_journal_entries_instrument_idx" ON "trading_journal_entries" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "trading_order_events_order_occurred_idx" ON "trading_order_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_order_legs_order_number_uidx" ON "trading_order_legs" USING btree ("order_id","leg_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_order_legs_order_instrument_uidx" ON "trading_order_legs" USING btree ("order_id","instrument_id");--> statement-breakpoint
CREATE INDEX "trading_order_legs_instrument_idx" ON "trading_order_legs" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_orders_portfolio_client_order_uidx" ON "trading_orders" USING btree ("portfolio_id","client_order_id");--> statement-breakpoint
CREATE INDEX "trading_orders_portfolio_status_created_idx" ON "trading_orders" USING btree ("portfolio_id","status","created_at");--> statement-breakpoint
CREATE INDEX "trading_orders_trade_plan_idx" ON "trading_orders" USING btree ("trade_plan_id");--> statement-breakpoint
CREATE INDEX "trading_portfolios_owner_status_idx" ON "trading_portfolios" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_positions_portfolio_instrument_uidx" ON "trading_positions" USING btree ("portfolio_id","instrument_id");--> statement-breakpoint
CREATE INDEX "trading_positions_instrument_idx" ON "trading_positions" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "trading_reservations_order_status_idx" ON "trading_reservations" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "trading_reservations_portfolio_status_idx" ON "trading_reservations" USING btree ("portfolio_id","status");--> statement-breakpoint
CREATE INDEX "trading_reservations_instrument_idx" ON "trading_reservations" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_watchlist_items_watchlist_instrument_uidx" ON "trading_watchlist_items" USING btree ("watchlist_id","instrument_id");--> statement-breakpoint
CREATE INDEX "trading_watchlist_items_instrument_idx" ON "trading_watchlist_items" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_watchlists_portfolio_name_uidx" ON "trading_watchlists" USING btree ("portfolio_id","name");