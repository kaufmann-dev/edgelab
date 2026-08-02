import { json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import {
	OrderApplicationError,
	previewSimulationOrder,
	serializeApplicationPreview
} from '$lib/server/order-application';
import { MassiveHttpError } from '$lib/server/market-data';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	if (!locals.user) return json({ error: 'Authentication required.' }, { status: 401 });
	if (request.headers.get('origin') !== url.origin) {
		return json({ error: 'Cross-origin order requests are not allowed.' }, { status: 403 });
	}
	if (!request.headers.get('content-type')?.startsWith('application/json')) {
		return json({ error: 'Order previews require JSON.' }, { status: 415 });
	}

	try {
		const draft = (await request.json()) as Record<string, unknown>;
		if (draft.portfolioId !== params.portfolioId) {
			return json({ error: 'Order portfolio does not match the route.' }, { status: 400 });
		}
		locals.markSessionActive();
		const preview = await previewSimulationOrder({ ownerUserId: locals.user.id, draft });
		return json({ preview: serializeApplicationPreview(preview) });
	} catch (cause) {
		if (cause instanceof ZodError) {
			return json({ error: 'Order fields are invalid.', issues: cause.issues }, { status: 400 });
		}
		if (cause instanceof OrderApplicationError) {
			return json(
				{
					error: cause.message,
					preview: cause.preview ? serializeApplicationPreview(cause.preview) : undefined
				},
				{ status: cause.status }
			);
		}
		if (cause instanceof MassiveHttpError) {
			return json({ error: cause.message }, { status: cause.status === 429 ? 429 : 502 });
		}
		throw cause;
	}
};
