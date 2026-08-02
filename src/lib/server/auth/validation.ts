import { DEFAULT_RETURN_TO } from './constants';

const AUTH_PATH_PREFIX = '/auth';

export function safeReturnTo(value: string | null | undefined, origin: string): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
		return DEFAULT_RETURN_TO;
	}

	try {
		const parsed = new URL(value, origin);
		if (parsed.origin !== origin || parsed.pathname.startsWith(AUTH_PATH_PREFIX)) {
			return DEFAULT_RETURN_TO;
		}
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return DEFAULT_RETURN_TO;
	}
}

export function assertSameOrigin(request: Request, expectedOrigin: string): void {
	if (request.headers.get('origin') !== expectedOrigin) {
		throw new Error('Cross-origin request rejected');
	}
}
