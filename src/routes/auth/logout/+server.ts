import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE_NAME } from '$lib/server/auth/constants';
import { clearSessionCookie } from '$lib/server/auth/cookies';
import { getAuthEnvironment } from '$lib/server/auth/environment';
import { createLogoutUrl } from '$lib/server/auth/oidc';
import { redirectNoStore } from '$lib/server/auth/responses';
import { endAuthenticatedSession } from '$lib/server/auth/session';
import { assertSameOrigin } from '$lib/server/auth/validation';

export const POST: RequestHandler = async ({ cookies, locals, request }) => {
	const environment = getAuthEnvironment();
	try {
		assertSameOrigin(request, environment.origin);
	} catch {
		error(403, 'Cross-origin logout request rejected.');
	}

	const token = cookies.get(SESSION_COOKIE_NAME);
	if (!locals.user || !token) error(401, 'Authentication required.');

	const idToken = await endAuthenticatedSession(token, environment);
	clearSessionCookie(cookies, environment);
	locals.user = null;
	locals.session = null;

	if (!idToken) return redirectNoStore(environment.logoutCallbackUrl);
	return redirectNoStore(await createLogoutUrl(environment, idToken));
};
