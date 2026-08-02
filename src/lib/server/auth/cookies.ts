import type { Cookies } from '@sveltejs/kit';
import type { AuthEnvironment } from './environment';
import { OIDC_FLOW_COOKIE_NAME, OIDC_FLOW_LIFETIME_MS, SESSION_COOKIE_NAME } from './constants';

function baseOptions(environment: AuthEnvironment) {
	return {
		httpOnly: true,
		secure: environment.secureCookies,
		sameSite: 'lax' as const,
		path: '/'
	};
}

export function setSessionCookie(
	cookies: Cookies,
	token: string,
	expires: Date,
	environment: AuthEnvironment
): void {
	cookies.set(SESSION_COOKIE_NAME, token, { ...baseOptions(environment), expires });
}

export function clearSessionCookie(cookies: Cookies, environment: AuthEnvironment): void {
	cookies.delete(SESSION_COOKIE_NAME, baseOptions(environment));
}

export function setOidcFlowCookie(
	cookies: Cookies,
	token: string,
	environment: AuthEnvironment
): void {
	cookies.set(OIDC_FLOW_COOKIE_NAME, token, {
		...baseOptions(environment),
		maxAge: OIDC_FLOW_LIFETIME_MS / 1_000
	});
}

export function clearOidcFlowCookie(cookies: Cookies, environment: AuthEnvironment): void {
	cookies.delete(OIDC_FLOW_COOKIE_NAME, baseOptions(environment));
}
