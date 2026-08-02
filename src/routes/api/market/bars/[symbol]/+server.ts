import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getMarketDataProvider, getMarketEnvironment } from '$lib/server/market';
import { MassiveHttpError } from '$lib/server/market-data';
import { serializeBar } from '$lib/server/market-view';
import type { RequestHandler } from './$types';

const symbolSchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z][A-Z0-9.:]{0,63}$/);
const dateSchema = z.string().date();

export const GET: RequestHandler = async ({ params, url }) => {
	const symbol = symbolSchema.safeParse(params.symbol);
	const from = dateSchema.safeParse(url.searchParams.get('from'));
	const to = dateSchema.safeParse(url.searchParams.get('to'));
	const assetClass = symbol.success && symbol.data.startsWith('O:') ? 'options' : 'stocks';
	if (!symbol.success || !from.success || !to.success) {
		return json({ error: 'Provide a valid symbol and YYYY-MM-DD from/to dates.' }, { status: 400 });
	}
	if (Date.parse(from.data) > Date.parse(to.data)) {
		return json({ error: 'The from date must not be after the to date.' }, { status: 400 });
	}

	try {
		const page = await getMarketDataProvider().getBars({
			assetClass,
			symbol: symbol.data,
			multiplier: 1,
			timespan: 'day',
			from: from.data,
			to: to.data,
			limit: 5_000
		});
		return json({
			items: page.items.map(serializeBar),
			feed: getMarketEnvironment().capabilities[assetClass],
			nextUrlAvailable: Boolean(page.nextUrl)
		});
	} catch (cause) {
		if (cause instanceof MassiveHttpError) {
			return json({ error: cause.message }, { status: cause.status === 429 ? 429 : 502 });
		}
		throw cause;
	}
};
