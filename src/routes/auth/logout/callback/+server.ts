import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth/cookies';
import { getAuthEnvironment } from '$lib/server/auth/environment';
import { signedOutResponse } from '$lib/server/auth/responses';

export const GET: RequestHandler = ({ cookies }) => {
	clearSessionCookie(cookies, getAuthEnvironment());
	return signedOutResponse();
};
