import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import { MassiveHttpError } from '$lib/server/market-data';
import { serializeSnapshot } from '$lib/server/market-view';
import type { RequestHandler } from './$types';

const symbolSchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z][A-Z0-9.]{0,14}$/);

export const GET: RequestHandler = async ({ params }) => {
	const parsed = symbolSchema.safeParse(params.symbol);
	if (!parsed.success) return json({ error: 'Invalid US stock symbol.' }, { status: 400 });
	const environment = getMarketEnvironment();
	if (!environment.capabilities.stocks.snapshots) {
		return json(
			{
				error: 'Stock snapshots are not included in the configured Massive plan.',
				feed: environment.capabilities.stocks
			},
			{ status: 409 }
		);
	}

	try {
		const page = await getMarketDataProvider().getUnifiedSnapshots([parsed.data]);
		const snapshot = page.items.find(
			(item) => item.assetClass === 'stocks' && item.symbol === parsed.data
		);
		if (!snapshot) return json({ error: 'No stock snapshot was found.' }, { status: 404 });
		return json({ snapshot: serializeSnapshot(snapshot), feed: environment.capabilities.stocks });
	} catch (cause) {
		if (cause instanceof MassiveHttpError) {
			return json({ error: cause.message }, { status: cause.status === 429 ? 429 : 502 });
		}
		throw cause;
	}
};
