import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import { MassiveHttpError } from '$lib/server/market-data';
import { serializeInstrument } from '$lib/server/market-view';
import type { RequestHandler } from './$types';

const querySchema = z.string().trim().min(1).max(80);

export const GET: RequestHandler = async ({ url }) => {
	const parsed = querySchema.safeParse(url.searchParams.get('q'));
	if (!parsed.success) return json({ error: 'Enter a company name or ticker.' }, { status: 400 });

	try {
		const page = await getMarketDataProvider().searchStocks(parsed.data, 20);
		const environment = getMarketEnvironment();
		return json({
			items: page.items.map(serializeInstrument),
			feed: environment.capabilities.stocks
		});
	} catch (cause) {
		if (cause instanceof MassiveHttpError) {
			return json({ error: cause.message }, { status: cause.status === 429 ? 429 : 502 });
		}
		throw cause;
	}
};
