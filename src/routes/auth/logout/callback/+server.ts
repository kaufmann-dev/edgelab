import type { RequestHandler } from './$types';
import { clearSessionCookie } from '#lib/server/auth/cookies.js';
import { getAuthEnvironment } from '#lib/server/auth/environment.js';
import { signedOutResponse } from '#lib/server/auth/responses.js';

export const GET: RequestHandler = ({ cookies }) => {
	clearSessionCookie(cookies, getAuthEnvironment());
	return signedOutResponse();
};
