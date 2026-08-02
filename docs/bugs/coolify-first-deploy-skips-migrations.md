# Coolify first deployment starts without database tables

- Timestamp: 2026-08-02 10:53:39 UTC (+0000)
- Git commit: c7da44594196d299a5a350115e2d3341fa76573c

## Symptom

The application started and connected to PostgreSQL, but authentication and the live order matcher
failed with PostgreSQL `42P01` errors because tables such as `oidc_login_requests` and
`trading_orders` did not exist. Coolify had
`./node_modules/.bin/drizzle-kit migrate` configured as its pre-deployment command.

## Confirmed root cause

Coolify runs an application's pre-deployment command inside the previously running application
container. It skips that hook when no previous container exists, which is always true on the first
deployment. On later deployments, the hook still uses the old image and therefore cannot reliably
apply migrations introduced by the new commit.

The initial Drizzle migration was present in the deployed Git commit and creates both missing
tables. The application received a PostgreSQL relation error rather than a connection error, which
confirmed that database connectivity worked but the schema initialization had not run.

## Changes

- Changed the Nixpacks start command to run `drizzle-kit migrate` before `node build`.
- Removed the incorrect Coolify pre-deployment command from the deployment checklist.
- Documented that Coolify pre/post deployment command fields must remain empty for this project.

## Verification

- `nixpacks plan -f json .` resolved the start command to
  `./node_modules/.bin/drizzle-kit migrate && node build` and retained development dependencies so
  the migration executable is present in the image.
- `pnpm check` and `pnpm lint` passed.
- `pnpm test:unit` passed 167 tests with one intentionally skipped integration test.
- `pnpm build` produced the adapter-node production bundle.
