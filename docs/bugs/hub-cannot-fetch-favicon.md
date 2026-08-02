# Hub cannot fetch the EdgeLab favicon

- Timestamp: 2026-08-02 13:33:52 UTC (+0000)
- Git commit: 7d57f717dbaad49109cca2551648473fc3238576

## Symptom

Hub reported EdgeLab as a failed website when its admin favicon refresh tried to fetch and cache
the EdgeLab icon.

## Confirmed root cause

Hub first requests the website HTML and extracts declared icon links. Unauthenticated requests to
the deployed EdgeLab homepage returned `401 application/json`, so Hub could not discover the
build-generated, hashed favicon URL in the authenticated HTML. Hub then tried its direct
`/favicon.ico` and `/favicon.svg` fallbacks, but both returned `404 text/html`. Its Google and
DuckDuckGo provider fallbacks also returned 404 for the EdgeLab domain, leaving no successful
response for Hub's image validator.

EdgeLab kept the favicon under `src/lib/assets`, so Vite only emitted it at a hashed path referenced
by rendered page HTML. It did not exist as an authentication-independent static asset at the
conventional URL Hub probes.

## Changes

- Moved the existing theme-aware SVG from `src/lib/assets/favicon.svg` to
  `static/favicon.svg` so adapter-node serves it before SvelteKit authentication handling.
- Updated the root layout to reference `/favicon.svg` through SvelteKit's static asset resolver,
  keeping one canonical icon file for both browsers and external consumers.

## Verification

- Before the change, the deployed homepage returned 401 and `/favicon.svg`, `/favicon.ico`, and
  both Hub provider fallbacks returned 404.
- The built adapter-node server returned `200 OK`, `Content-Type: image/svg+xml`, and valid SVG
  markup for `/favicon.svg` with Hub's `hub.kaufmann.dev favicon fetcher` user agent and no session.
- The Svelte autofixer reported no issues or suggestions for the root layout.
- `pnpm check`, `pnpm lint`, `pnpm test:unit`, and `pnpm build` passed.
