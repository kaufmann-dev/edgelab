# Exact stock lookup fails and stale trade price is hidden

- Timestamp: 2026-08-02 11:52:53 UTC (+0000)
- Git commit: ec4eefcb097dd95d18760e6fb36fa4245b18ba2e

## Symptom

Searching for `META` returned twenty loosely matching instruments but not Meta Platforms, and
saving `META` reported that it was not an exact active US stock. A saved `DDD` watchlist row showed
a `$2.64` minute close while its trade page reported that no recent completed minute aggregate was
available and displayed no price.

## Confirmed root causes

Watchlist and order validation reused Massive's fuzzy instrument-directory search and inspected
only its first page. Massive ranked alphabetically earlier partial matches ahead of the exact
`META` ticker, so exact-symbol validation incorrectly depended on fuzzy result ordering and page
size. Massive's exact ticker endpoint returned the active Nasdaq `META` instrument correctly.

The trade page requires a completed minute bar in a narrow execution window so stale data can
never enable an order. On the weekend, that lookup correctly returned no bar for `DDD`, while the
snapshot endpoint still carried the most recent completed minute close from July 31. The watchlist
showed that snapshot reference, but the trade page discarded it when no execution-eligible bar was
available.

## Changes

- Added an exact stock lookup backed by Massive's ticker-details endpoint and use it for watchlist
  additions and stock-order instrument validation.
- Preserve fuzzy search only for browsing the instrument directory.
- Added a shared validator for completed snapshot minute bars and reuse it in watchlist and trade
  data loading.
- Show an older valid snapshot minute close on the trade page as a clearly stale, reference-only
  value while keeping order review and execution disabled.
- Added server and browser regressions for exact ticker lookup, snapshot-clock validation, and the
  non-actionable stale-price presentation.

## Verification

- Massive's fuzzy `search=META` request reproduced the missing exact result on the first page, while
  the exact ticker-details request returned active US stock `META`.
- Massive returned no `DDD` bar in the execution window and returned a `$2.64` last-minute snapshot,
  reproducing the differing screens.
- Targeted server tests passed 42 tests across the Massive client, market-bar, watchlist, and order
  application suites.
- The targeted Chromium trade-page suite passed both browser tests.
- Svelte autofix reported no issues, and `pnpm check` and `pnpm lint` passed.
- `pnpm test:unit` passed 175 tests with two intentionally skipped database-integration tests.
- `pnpm build` produced the adapter-node production bundle.
