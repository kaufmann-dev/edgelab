import { error, redirect } from '@sveltejs/kit';
import { building } from '$app/env';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getTextDirection } from '#lib/paraglide/runtime.js';
import { paraglideMiddleware } from '#lib/paraglide/server.js';
import { SESSION_COOKIE_NAME } from '#lib/server/auth/constants.js';
import {
	clearSessionCookie,
	serializeClearedSessionCookie,
	serializeSessionCookie
} from '#lib/server/auth/cookies.js';
import { getAuthEnvironment } from '#lib/server/auth/environment.js';
import { loadAuthenticatedSession, refreshAuthenticatedSession } from '#lib/server/auth/session.js';
import { ensureLiveOrderExecutionStarted } from '#lib/server/live-order-execution.js';

const PUBLIC_ROUTE_IDS = new Set([
	'/auth/login',
	'/auth/login/start',
	'/auth/callback',
	'/auth/logout/callback',
	'/healthz'
]);

if (!building) ensureLiveOrderExecutionStarted();

function isDocumentNavigation(request: Request): boolean {
	return (
		(request.method === 'GET' || request.method === 'HEAD') &&
		(request.headers.get('accept')?.includes('text/html') ?? false)
	);
}

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) =>
		resolve(
			{ ...event, request },
			{
				transformPageChunk: ({ html }) =>
					html
						.replace('%paraglide.lang%', locale)
						.replace('%paraglide.dir%', getTextDirection(locale))
			}
		)
	);

export const handleAuthentication: Handle = async ({ event, resolve }) => {
	const environment = getAuthEnvironment();
	const sessionToken = event.cookies.get(SESSION_COOKIE_NAME);
	const authenticated = sessionToken ? await loadAuthenticatedSession(sessionToken) : null;
	let activityRequested = false;

	event.locals.user = authenticated?.user ?? null;
	event.locals.session = authenticated?.session ?? null;
	event.locals.markSessionActive = () => {
		if (event.locals.user) activityRequested = true;
	};
	if (sessionToken && !authenticated) clearSessionCookie(event.cookies, environment);

	const isPublicRoute = event.route.id === null || PUBLIC_ROUTE_IDS.has(event.route.id);
	if (!isPublicRoute && !authenticated) {
		if (isDocumentNavigation(event.request)) {
			const returnTo = `${event.url.pathname}${event.url.search}`;
			redirect(303, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
		}
		error(401, 'Authentication required.');
	}

	if (authenticated && isDocumentNavigation(event.request)) activityRequested = true;
	const response = await resolve(event);
	if (!authenticated) return response;

	const headers = new Headers(response.headers);

	if (sessionToken && activityRequested) {
		const idleExpiresAt = await refreshAuthenticatedSession(sessionToken);
		if (idleExpiresAt) {
			headers.append(
				'set-cookie',
				serializeSessionCookie(event.cookies, sessionToken, idleExpiresAt, environment)
			);
		} else {
			headers.append('set-cookie', serializeClearedSessionCookie(event.cookies, environment));
			event.locals.user = null;
			event.locals.session = null;
		}
	}

	headers.set('cache-control', 'private, no-store');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};

export const handle: Handle = sequence(handleParaglide, handleAuthentication);
