import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OIDC_FLOW_COOKIE_NAME } from '#lib/server/auth/constants.js';
import { clearOidcFlowCookie, setSessionCookie } from '#lib/server/auth/cookies.js';
import { getAuthEnvironment } from '#lib/server/auth/environment.js';
import { finishLoginFlow } from '#lib/server/auth/flow.js';
import { exchangeAuthorizationCode } from '#lib/server/auth/oidc.js';
import { redirectNoStore } from '#lib/server/auth/responses.js';
import { createAuthenticatedSession } from '#lib/server/auth/session.js';
import { safeReturnTo } from '#lib/server/auth/validation.js';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const environment = getAuthEnvironment();
	const flowToken = cookies.get(OIDC_FLOW_COOKIE_NAME);
	clearOidcFlowCookie(cookies, environment);
	if (!flowToken) error(400, 'The sign-in request is missing or expired. Start again.');

	const flow = await finishLoginFlow(flowToken, environment);
	if (!flow) error(400, 'The sign-in request is missing or expired. Start again.');

	const callbackUrl = new URL(environment.callbackUrl);
	callbackUrl.search = url.search;

	let exchange;
	try {
		exchange = await exchangeAuthorizationCode(environment, callbackUrl, {
			codeVerifier: flow.codeVerifier,
			state: flow.state,
			nonce: flow.nonce
		});
	} catch {
		error(400, 'The identity provider could not complete sign-in. Start again.');
	}

	const localSession = await createAuthenticatedSession(
		exchange.identity,
		exchange.idToken,
		environment
	);
	setSessionCookie(
		cookies,
		localSession.token,
		localSession.authenticated.session.idleExpiresAt,
		environment
	);

	return redirectNoStore(safeReturnTo(flow.returnTo, environment.origin));
};
