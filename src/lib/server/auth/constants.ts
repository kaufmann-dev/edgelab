export const SESSION_COOKIE_NAME = 'sim_session';
export const OIDC_FLOW_COOKIE_NAME = 'oidc_flow';

export const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const OIDC_FLOW_LIFETIME_MS = 10 * 60 * 1_000;

export const OIDC_SCOPE = 'openid profile email';
export const DEFAULT_RETURN_TO = '/';
