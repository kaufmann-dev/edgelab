# Repository Instructions

## Build and Verification

- Use a full-ICU Node 24 build and pnpm 11.18.0.
- Run the smallest relevant check first, then finish with the full checks affected by the change:

```sh
pnpm check
pnpm lint
pnpm test:unit
pnpm build
```

- After editing a `.svelte` file, run the Svelte autofixer on the complete component until it
  reports no issues, then run `pnpm check`.
- Run the database integration test only against disposable PostgreSQL:

```sh
RUN_DATABASE_INTEGRATION=true pnpm test:unit -- src/lib/server/trading/drizzle-repository.integration.test.ts
```

## Architecture Boundaries

- Keep routes and page composition in `src/routes`, reusable UI in `src/lib/components`, and pure
  domain calculations in `src/lib/domain`.
- Keep credentials and provider access in `src/lib/server`. Never import Massive keys, OIDC
  secrets, database clients, or server repositories into browser code.
- Treat `src/lib/server/db/schema.ts` as the Drizzle schema entry point. Generate committed
  migrations with `pnpm db:generate`; apply them with `pnpm db:migrate`. Do not edit generated
  migration metadata by hand.
- Keep Massive transport and normalization in `src/lib/server/market-data`. Preserve source time,
  receive time, asset class, and real-time/delayed provenance.
- Keep order orchestration in `src/lib/server/order-application.ts`, deterministic risk and
  execution logic in `src/lib/server/trading`, and persistence in the Drizzle repository. Keep
  process-local restoration/subscription/event matching in `src/lib/server/live-order-execution.ts`
  and exchange-clock rules in `src/lib/server/market-session.ts`.

## Trading and Security Invariants

- Scope every portfolio read and mutation by the authenticated owner. Preserve same-origin checks
  on state-changing JSON routes and keep protected responses private and non-cacheable.
- Use `Decimal` through money, price, quantity, fee, collateral, and P&L calculations. Convert to
  strings at database and JSON boundaries; do not calculate financial values with JavaScript
  numbers.
- Keep portfolio mutations serializable, lock affected account state, and preserve idempotency by
  `clientOrderId`.
- Model a multi-leg strategy as one order and one parent fill with fill legs. Keep ledger entries
  linked to the parent fill, cap orders at four legs, fill strategies atomically, and never enable
  naked options.
- Reject market-data mode mismatches and stale or unavailable market events. Never conceal an
  entitlement failure by silently downgrading the feed or representing a bar as a quote. New
  portfolios require Massive Stocks Starter or better and persist the Stocks plan's clock. The
  Options plan is optional; option execution requires a same-clock quote-and-trade feed.
- Preserve OIDC authorization code flow with PKCE S256, state, nonce, `client_secret_post`, opaque
  local sessions, encrypted flow data, bounded login-flow creation, and POST logout. Keep browser
  market streams authenticated, bounded, and short-lived enough to recheck session validity.

## UI Conventions

- Use Svelte 5 runes and the existing square, high-contrast Tailwind token system. Reuse the
  existing shadcn-svelte primitives and preserve responsive keyboard and screen-reader behavior.
- Update existing Markdown only when changed behavior makes it inaccurate. Run Prettier on every
  edited Markdown file.
