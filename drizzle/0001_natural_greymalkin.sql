ALTER TABLE "trading_portfolios" DROP CONSTRAINT "trading_portfolios_data_mode_check";--> statement-breakpoint
ALTER TABLE "trading_portfolio_policies" ALTER COLUMN "allow_long_options" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "trading_orders" ADD COLUMN "last_evaluated_bar_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trading_portfolios" ADD CONSTRAINT "trading_portfolios_data_mode_check" CHECK ("trading_portfolios"."data_mode" in ('realtime', 'delayed'));