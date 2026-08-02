# Vite build crashes while Paraglide initializes

- Timestamp: 2026-08-02 00:05:49 UTC (+0000)
- Git commit: unavailable because the repository had an unborn `HEAD` when the defect was fixed

## Symptom

`pnpm build` exited with code 139 while Vite 8.2.0 was initializing the SSR production build. The
process printed no JavaScript error or application-module diagnostic before receiving `SIGSEGV`.

## Cause

The workspace's custom Node 24.18.0 binary was built with small ICU and had no external ICU data.
Calling `new Intl.Segmenter().segment('')` directly reproduced the segmentation fault. Paraglide
2.23.0 uses Consola 3.4.0 to report a successful compilation, and Consola's fancy reporter calls
`Intl.Segmenter` while measuring the log line. That made both Paraglide's Vite plugin and CLI crash
after compilation. Vite, Rolldown, and the Paraglide compiler were not the fault: a diagnostic Vite
config without the plugin built successfully, and Paraglide's documented programmatic `compile()`
API completed normally without invoking the logger.

The small-ICU `Intl.Segmenter` crash matches
[nodejs/node#51752](https://github.com/nodejs/node/issues/51752).

## Changes

- Removed `paraglideVitePlugin` from `vite.config.ts`.
- Added `scripts/compile-i18n.mjs` to invoke Paraglide's programmatic compiler in a separate process.
- Made development, type checking, tests, and production builds compile translations first.
- Added an explicit translation watch command for locale-message development.
- Documented full ICU as a Node runtime requirement; official Node distributions include it.

## Verification

`pnpm i18n:compile`, `pnpm check`, `pnpm lint`, `pnpm test:unit`, and the adapter-node `pnpm build`
all complete successfully. The unit suite reports 107 passing tests and one intentionally skipped
database integration test.
