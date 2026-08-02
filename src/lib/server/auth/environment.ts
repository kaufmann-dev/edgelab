import { env } from '$env/dynamic/private';
import { decodeEncryptionKey } from './crypto';

export interface AuthEnvironment {
	origin: string;
	issuerUrl: string;
	clientId: string;
	clientSecret: string;
	dataEncryptionKey: string;
	callbackUrl: string;
	logoutCallbackUrl: string;
	secureCookies: boolean;
}

type EnvironmentSource = Record<string, string | undefined>;

function required(source: EnvironmentSource, name: string): string {
	const value = source[name];
	if (!value || value.trim().length === 0) throw new Error(`${name} is not set`);
	return value;
}

function isLocalhost(url: URL): boolean {
	return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function canonicalOrigin(value: string): URL {
	const parsed = new URL(value);
	if (
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		parsed.pathname !== '/'
	) {
		throw new Error('ORIGIN must be an origin without credentials, path, query, or fragment');
	}
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost(parsed))) {
		throw new Error('ORIGIN must use HTTPS except for localhost development');
	}
	return parsed;
}

function issuerUrl(value: string): URL {
	const parsed = new URL(value);
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error('OIDC_ISSUER_URL must not contain credentials, a query, or a fragment');
	}
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost(parsed))) {
		throw new Error('OIDC_ISSUER_URL must use HTTPS except for localhost development');
	}
	return parsed;
}

export function getAuthEnvironment(source: EnvironmentSource = env): AuthEnvironment {
	const origin = canonicalOrigin(required(source, 'ORIGIN'));
	const issuer = issuerUrl(required(source, 'OIDC_ISSUER_URL'));
	const dataEncryptionKey = required(source, 'OIDC_DATA_ENCRYPTION_KEY');
	decodeEncryptionKey(dataEncryptionKey);

	return {
		origin: origin.origin,
		issuerUrl: issuer.href,
		clientId: required(source, 'OIDC_CLIENT_ID'),
		clientSecret: required(source, 'OIDC_CLIENT_SECRET'),
		dataEncryptionKey,
		callbackUrl: new URL('/auth/callback', origin).href,
		logoutCallbackUrl: new URL('/auth/logout/callback', origin).href,
		secureCookies: origin.protocol === 'https:'
	};
}
