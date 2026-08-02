import { redirect } from '@sveltejs/kit';
import { getAuthEnvironment } from '$lib/server/auth/environment';
import { safeReturnTo } from '$lib/server/auth/validation';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, setHeaders, url }) => {
	const environment = getAuthEnvironment();
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'), environment.origin);

	setHeaders({ 'cache-control': 'no-store' });

	if (locals.user) {
		locals.markSessionActive();
		redirect(303, returnTo);
	}

	return { returnTo };
};
