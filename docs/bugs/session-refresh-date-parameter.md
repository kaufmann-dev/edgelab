# Session refresh fails after successful database migration

- Timestamp: 2026-08-02 11:01:54 UTC (+0000)
- Git commit: 7c1e356a2ff2e237cda2220dcbc299485747584f

## Symptom

After all Drizzle migrations completed successfully, requests carrying an authentication cookie
failed with HTTP 500 while updating `auth_sessions`. The generated query attempted to set
`idle_expires_at` with PostgreSQL `least(...)`, and its logged parameter was a JavaScript `Date`
string instead of an encoded timestamp.

## Confirmed root cause

The session refresh repository interpolated a JavaScript `Date` directly into a raw Drizzle SQL
expression. Raw SQL interpolation uses Drizzle's no-op parameter encoder unless an encoder is
specified, so `postgres-js` received a `Date` object rather than the timestamp string it expects.
This failed before PostgreSQL could evaluate the query, including when the cookie referred to a
session that did not exist in a newly initialized database.

The migration-time identifier-truncation notice was unrelated. PostgreSQL consistently truncates
identifiers longer than 63 bytes, and the migration itself completed successfully.

## Changes

- Bound the candidate idle expiry with the `auth_sessions.idle_expires_at` column encoder inside
  the `least(...)` expression.
- Added a PostgreSQL integration regression test that refreshes an idle expiry and verifies that
  the absolute session expiry remains the upper bound.

## Verification

- Reproduced the failing query against disposable PostgreSQL before the change.
- Confirmed the encoded expression succeeds against the same PostgreSQL instance.
- The PostgreSQL integration run passed 169 tests, including the session refresh and absolute-expiry
  cap regression test.
- `pnpm check` and `pnpm lint` passed.
- `pnpm test:unit` passed 167 tests with two intentionally skipped integration tests.
- `pnpm build` produced the adapter-node production bundle.
