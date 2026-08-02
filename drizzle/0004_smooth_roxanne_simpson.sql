ALTER TABLE "trading_fills" DROP CONSTRAINT "trading_fills_event_kind_check";--> statement-breakpoint
ALTER TABLE "trading_order_legs" DROP CONSTRAINT "trading_order_legs_number_check";--> statement-breakpoint
ALTER TABLE "trading_order_legs" DROP CONSTRAINT "trading_order_legs_quantity_check";--> statement-breakpoint
ALTER TABLE "trading_fills" ADD CONSTRAINT "trading_fills_event_kind_check" CHECK ("trading_fills"."source_event_kind" = 'bar') NOT VALID;--> statement-breakpoint
ALTER TABLE "trading_order_legs" ADD CONSTRAINT "trading_order_legs_number_check" CHECK ("trading_order_legs"."leg_number" = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "trading_order_legs" ADD CONSTRAINT "trading_order_legs_quantity_check" CHECK ("trading_order_legs"."ratio_quantity" = 1 and "trading_order_legs"."filled_quantity" >= 0) NOT VALID;
