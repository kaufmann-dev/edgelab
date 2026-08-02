# EdgeLab

EdgeLab is an authenticated paper-trading application for practicing US stock workflows with
Massive market data. Optional option workflows become available when the configured plans provide
the required execution feeds. EdgeLab keeps portfolios, cash, positions, orders, fills, journal
entries, and analytics inside the simulator; it does not connect to a brokerage or use real money.

Each user can create isolated USD portfolios with independent starting capital, permissions, and
risk limits. The interface includes stock tickets, capability-gated one-to-four-leg option
tickets, live watchlists, working orders, positions, activity, a trade journal, benchmark-aware
portfolio analytics, and short learning modules.

## Run Locally

Prerequisites:

- Node.js 24 with full ICU data (the official Node.js distribution includes it)
- pnpm 11.18.0
- PostgreSQL 15 or newer (PostgreSQL 17 is recommended)
- A confidential OpenID Connect client
- A Massive API key with Stocks Starter or a higher Stocks plan

Install dependencies and create local configuration:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -base64 32
```

Put the generated 32-byte key in `OIDC_DATA_ENCRYPTION_KEY`, fill the remaining secrets in
`.env`, then initialize the database and start SvelteKit:

```sh
pnpm db:migrate
pnpm dev
```

Open `http://localhost:5173`. EdgeLab redirects unauthenticated requests to the configured OIDC
provider.

## Configuration

The core configuration is required at runtime:

- `DATABASE_URL` is a PostgreSQL connection URL.
- `ORIGIN` is EdgeLab's canonical origin. Use HTTPS in production; only localhost development may
  use HTTP. Do not include a path, query, fragment, or credentials.
- `OIDC_ISSUER_URL` is the provider's discovery issuer URL.
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` identify a confidential OIDC client.
- `OIDC_DATA_ENCRYPTION_KEY` is a base64-encoded, exactly 32-byte key used to encrypt sensitive
  flow data at rest.
- `MASSIVE_API_KEY` authenticates server-side Massive REST and WebSocket requests.
- `MASSIVE_STOCKS_PLAN` declares the key's actual Stocks tier. `starter` is the baseline and uses
  Massive's 15-minute-delayed snapshots and second-aggregate WebSocket feed.
- `MASSIVE_OPTIONS_PLAN` is optional. Omit it when the key has no Options plan; when set, it must
  be the key's actual Options tier. Option chains follow that plan's snapshot entitlement. Option
  order execution remains disabled unless the Stocks and Options plans share one clock and the
  Options plan supplies snapshots, WebSockets, quotes, and trades.

Register these exact OIDC redirect URIs for the value of `ORIGIN`:

```text
https://your-edgelab.example/auth/callback
https://your-edgelab.example/auth/logout/callback
```

The client must use authorization code flow, `client_secret_post`, and PKCE S256. Public-client
mode is not supported. EdgeLab validates state and nonce, stores opaque local session tokens, and
applies a 24-hour idle timeout with a seven-day absolute lifetime.

The Massive capability layer checks declared entitlements before opening a stream or calling a
plan-gated endpoint. EdgeLab labels source provenance, validates both receive time and provider
source time, and never presents aggregate bars as quotes or trades.

## Simulation Rules

- Portfolio state and every mutation are owner-scoped. Cash and quantity calculations use exact
  decimal arithmetic and an append-only cash ledger.
- Stocks use the latest completed minute returned by Massive's aggregate endpoint for preview and
  reservation. Execution waits for the first eligible future second aggregate, so an order never
  fills from a bar already visible when it was submitted. Delayed bars are validated against the
  portfolio's 15-minute logical market clock and retain their provider and receipt timestamps.
- Options execution requires a positive, non-crossed NBBO no more than 60 seconds old on both the
  wall clock and portfolio's logical market clock. Multi-leg quotes must share a coherent
  timestamp. Naked options are disabled, and a strategy may contain at most four compatible legs.
- The initial execution model uses zero artificial latency, 2 basis points of stock slippage,
  5 basis points of option slippage, and at most 25% of aggregate volume or displayed option quote
  liquidity.
- Stock trades have no simulated per-share fee. Options cost $0.65 per contract with no minimum
  order fee.
- Risk checks cover available cash or collateral, portfolio permissions, order and position
  limits, gross exposure, daily loss, drawdown, option premium, and required trade plans. Market
  estimates include simulated slippage before cash is reserved.
- Stock market, limit, stop, and stop-limit orders support DAY or GTC and match from Massive's
  second-aggregate stream. Aggregate-priced stock orders do not offer IOC or trailing stops because
  those semantics require an immediate or ordered tick feed. Eligible option orders may fill from
  quote/trade streams. Resting orders and first-seen bar cursors persist in PostgreSQL.
- The matcher uses the US equity calendar and regular/extended sessions, expires DAY orders at the
  deterministic exchange boundary, and fails closed when calendar or executable market data is
  unavailable. Extended-hours execution is limited to opted-in stock limit orders.
- Cash, fills, positions, reservations, and order events update atomically. FIFO analytics are
  reconstructed from immutable fill legs with proportional fees. Duplicate source events cannot
  create duplicate fills, including when Massive omits a sequence value.

These rules model trading mechanics for education. They are not investment advice and do not
promise broker-identical execution.

## Development and Verification

Use the repository scripts for the normal development loop:

```sh
pnpm check
pnpm lint
pnpm test:unit
pnpm build
```

The development, check, test, and build scripts compile Paraglide messages before loading the
application. While editing locale message files, run `pnpm i18n:watch` in a second terminal for
continuous regeneration.

The Drizzle schema lives in `src/lib/server/db/schema.ts`; committed migrations live in
`drizzle/`. After an intentional schema change, generate and review a migration before applying
it:

```sh
pnpm db:generate
pnpm db:migrate
```

The trading repository integration suite is opt-in because it modifies its target database. Run
it only against a disposable PostgreSQL database:

```sh
RUN_DATABASE_INTEGRATION=true pnpm test:unit -- src/lib/server/trading/drizzle-repository.integration.test.ts
```

## Coolify Deployment

Configure the application in Coolify with these UI values:

- **Build Pack:** Nixpacks.
- **Base Directory:** `/`.
- **Pre-Deployment Command:** `./node_modules/.bin/drizzle-kit migrate`.
- **Health Check Path:** `/healthz`; it returns `503` when PostgreSQL is unavailable.
- **Replicas:** exactly `1`, because Massive WebSocket fan-out is process-local.
- **Database:** attach a persistent PostgreSQL resource and use its internal connection URL.

Set every uncommented variable from `.env.example` in Coolify. Add `MASSIVE_OPTIONS_PLAN` only
when that key has an Options plan. Treat `DATABASE_URL`, `OIDC_CLIENT_SECRET`,
`OIDC_DATA_ENCRYPTION_KEY`, and `MASSIVE_API_KEY` as secrets. Set `ORIGIN` to the public HTTPS
origin, and register its `/auth/callback` and `/auth/logout/callback` URLs with the OIDC provider.

The repository's `nixpacks.toml` works around the generated Nixpacks plan's obsolete Corepack by
running the pinned pnpm 11.18.0 explicitly during install and build. Node 24 remains pinned only in
`package.json`; use a full-ICU Node build rather than a custom small-ICU build. The adapter-node
server reads Coolify's injected `PORT` at runtime.

The live matcher starts with the server and does not require an open browser. Browser market streams
are authenticated, resource-capped, and reconnect at least once per minute so session expiry and
revocation are enforced promptly. OIDC login starts are rate-limited, and expired login flows and
sessions are pruned automatically.
