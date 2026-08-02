# Create portfolio crashes and header Search is inert

- Timestamp: 2026-08-02 11:32:19 UTC (+0000)
- Git commit: b01599eac8da8c61319b7e1fcd5662da5e2d372f

## Symptom

Opening the create-portfolio screen crashed the hydrated client with
`Cannot set properties of undefined (setting 'labelId')`. The header Search action also appeared to
do nothing on screens without an active portfolio.

## Confirmed root causes

Five checkbox fields rendered their Formsnap `Label` components after their `Control` child
snippets had closed. Formsnap's label state requires that active control context and immediately
assigns its generated label ID to the control. Without the context, the control was undefined and
the assignment produced the reported exception.

Market search and watchlists are portfolio-scoped. The root layout nevertheless rendered Search
without a portfolio and pointed it at `/portfolios`, which was already the current page in the
reported flow. With an active portfolio, the destination opened Markets but did not target its
search control.

## Changes

- Moved each checkbox label and description inside its corresponding Formsnap `Control` snippet.
- Added a browser regression test that renders the complete portfolio form and verifies its
  checkbox label associations, including optional Options Starter controls.
- Omitted the portfolio-scoped Search action when there is no active portfolio.
- Pointed active-portfolio Search links at the Markets page's `#market-search` control.
- Added header-action browser tests for both portfolio states.

## Verification

- Before the changes, the portfolio browser test reproduced the exact Formsnap `labelId` exception.
- Before the changes, the header test observed a no-op Search button without a portfolio.
- The two targeted Chromium test files now pass all three regression tests.
- Svelte autofixers report no issues or suggestions for all three changed components.
- `pnpm check` and `pnpm lint` passed.
- `pnpm test:unit` passed 173 tests with two intentionally skipped integration tests.
- `pnpm build` produced the adapter-node production bundle.
