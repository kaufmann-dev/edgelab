# Authenticated SSR fails on navigation and session refresh

- Timestamp: 2026-08-02 11:13:46 UTC (+0000)
- Git commit: 5d5edc979ae3fd80bffa297bfed77a76ce9d5ede

## Symptom

After database initialization and session timestamp encoding were fixed, authenticated document
requests still returned HTTP 500. Server rendering rejected `./portfolios` as an input to
SvelteKit's `resolve(...)`, and the authentication hook separately rejected `cookies.set(...)`
after the response had been generated. Requests for the missing conventional `/favicon.ico` also
rendered the error layout and exposed the navigation failure.

## Confirmed root causes

The shared `Button` component called `resolve(...)` on every supplied `href`. Its callers already
supplied final hrefs, including output from `resolve(...)`. During server rendering with relative
paths enabled, the first resolution produced values such as `./portfolios`; resolving that value a
second time violated SvelteKit's requirement that internal resolver inputs be absolute pathnames or
route IDs. The same component also needed to support final hash and external hrefs that must not be
passed to SvelteKit's internal route resolver.

The authentication hook deliberately waited until route handling completed to learn whether the
request counted as session activity. It then refreshed the database session and called
`event.cookies.set(...)` or `event.cookies.delete(...)`. SvelteKit closes its event cookie mutation
collection once `resolve(event)` produces a response, so those calls were always too late on an
authenticated activity request.

## Changes

- Changed the shared anchor-style `Button` to forward its caller-supplied final `href` without a
  second route resolution.
- Added a browser component regression test for an SSR-relative resolved href.
- Kept the post-route session activity decision, but serialize the refreshed or cleared session
  cookie and append it to the returned response's `Set-Cookie` headers.
- Added hook and cookie serialization regression tests that fail if response generation is followed
  by a cookie collection mutation.

## Verification

- Reproduced the exact `resolve('./portfolios')` failure against the generated server runtime before
  the change.
- Confirmed the rebuilt server `Button` chunk forwards `href` without calling `resolve(...)`.
- The targeted Button browser test and authentication hook/cookie tests passed.
- `pnpm check` and `pnpm lint` passed.
- `pnpm test:unit` passed 170 tests with two intentionally skipped integration tests.
- `pnpm build` produced the adapter-node production bundle.
