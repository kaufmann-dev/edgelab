import type { RequestHandler } from './$types';
import { OIDC_FLOW_COOKIE_NAME } from '#lib/server/auth/constants.js';
import { setOidcFlowCookie } from '#lib/server/auth/cookies.js';
import { getAuthEnvironment } from '#lib/server/auth/environment.js';
import { abandonLoginFlow, startLoginFlow } from '#lib/server/auth/flow.js';
import { LoginRateLimitError } from '#lib/server/auth/login-rate-limit.js';
import { LoginFlowCapacityError } from '#lib/server/auth/repository.js';
import { redirectNoStore } from '#lib/server/auth/responses.js';
import { safeReturnTo } from '#lib/server/auth/validation.js';

export const GET: RequestHandler = async ({ cookies, locals, url }) => {
	const environment = getAuthEnvironment();
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'), environment.origin);

	if (locals.user) {
		locals.markSessionActive();
		return redirectNoStore(returnTo);
	}

	const previousFlowToken = cookies.get(OIDC_FLOW_COOKIE_NAME);
	if (previousFlowToken) await abandonLoginFlow(previousFlowToken);

	let flow: Awaited<ReturnType<typeof startLoginFlow>>;
	try {
		flow = await startLoginFlow(returnTo, environment);
	} catch (cause) {
		if (cause instanceof LoginRateLimitError || cause instanceof LoginFlowCapacityError) {
			return new Response(cause.message, {
				status: 429,
				headers: {
					'cache-control': 'no-store',
					'retry-after': String(cause instanceof LoginRateLimitError ? cause.retryAfterSeconds : 60)
				}
			});
		}
		throw cause;
	}
	setOidcFlowCookie(cookies, flow.token, environment);
	return redirectNoStore(flow.authorizationUrl);
};
