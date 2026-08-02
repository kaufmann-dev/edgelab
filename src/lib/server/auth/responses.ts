export function redirectNoStore(location: string | URL): Response {
	return new Response(null, {
		status: 303,
		headers: {
			'cache-control': 'no-store',
			location: location.toString()
		}
	});
}

export function signedOutResponse(): Response {
	return new Response(
		'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Signed out</title><body><main><h1>Signed out</h1><p>Your trading simulator session has ended.</p><p><a href="/auth/login">Sign in again</a></p></main></body></html>',
		{
			headers: {
				'cache-control': 'no-store',
				'content-security-policy':
					"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
				'content-type': 'text/html; charset=utf-8',
				'referrer-policy': 'no-referrer',
				'x-content-type-options': 'nosniff'
			}
		}
	);
}
