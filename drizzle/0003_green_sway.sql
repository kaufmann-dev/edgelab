ALTER TABLE "trading_portfolio_policies" DROP COLUMN "allow_covered_options";--> statement-breakpoint
WITH "locked_portfolios" AS MATERIALIZED (
	SELECT "portfolio"."id"
	FROM "trading_portfolios" AS "portfolio"
	WHERE "portfolio"."status" = 'active'
	ORDER BY "portfolio"."id"
	FOR UPDATE
),
"incompatible_orders" AS MATERIALIZED (
	SELECT
		"order"."id",
		"order"."status" AS "from_status"
	FROM "trading_orders" AS "order"
	INNER JOIN "locked_portfolios" AS "portfolio"
		ON "portfolio"."id" = "order"."portfolio_id"
	WHERE
		"order"."status" IN ('pending_new', 'open', 'partially_filled')
		AND (
			"order"."execution_model_version" <> 'sim-execution-v2'
			OR (
				SELECT count(*)
				FROM "trading_order_legs" AS "leg"
				WHERE "leg"."order_id" = "order"."id"
			) <> 1
			OR EXISTS (
				SELECT 1
				FROM "trading_order_legs" AS "leg"
				WHERE
					"leg"."order_id" = "order"."id"
					AND "leg"."ratio_quantity" <> 1
			)
		)
	ORDER BY "order"."id"
	FOR UPDATE OF "order"
),
"canceled_orders" AS (
	UPDATE "trading_orders" AS "order"
	SET
		"status" = 'canceled',
		"terminal_at" = transaction_timestamp(),
		"revision" = "order"."revision" + 1,
		"updated_at" = transaction_timestamp()
	FROM "incompatible_orders" AS "incompatible"
	WHERE "order"."id" = "incompatible"."id"
	RETURNING "order"."id", "incompatible"."from_status"
),
"released_reservations" AS (
	UPDATE "trading_reservations" AS "reservation"
	SET
		"status" = 'released',
		"released_at" = transaction_timestamp()
	FROM "canceled_orders" AS "order"
	WHERE
		"reservation"."order_id" = "order"."id"
		AND "reservation"."status" = 'active'
	RETURNING "reservation"."id"
),
"cancellation_events" AS (
	INSERT INTO "trading_order_events" (
		"order_id",
		"from_status",
		"to_status",
		"reason",
		"occurred_at"
	)
	SELECT
		"order"."id",
		"order"."from_status",
		'canceled',
		'Canceled during the sim-execution-v2 upgrade because the active order is incompatible with aggregate execution',
		transaction_timestamp()
	FROM "canceled_orders" AS "order"
	WHERE (SELECT count(*) FROM "released_reservations") >= 0
	RETURNING "id"
)
UPDATE "trading_portfolios" AS "portfolio"
SET "execution_model_version" = 'sim-execution-v2'
FROM "locked_portfolios" AS "locked"
WHERE
	"portfolio"."id" = "locked"."id"
	AND "portfolio"."execution_model_version" <> 'sim-execution-v2'
	AND (SELECT count(*) FROM "cancellation_events") >= 0;
