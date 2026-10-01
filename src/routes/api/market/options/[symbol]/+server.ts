import { z } from 'zod';
import { getMarketDataProvider, getMarketEnvironment } from '#lib/server/market.js';
import { MassiveHttpError } from '#lib/server/market-data/index.js';
import { serializeOptionSnapshot } from '#lib/server/market-view.js';
import type { RequestHandler } from './$types';

const symbolSchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z][A-Z0-9.]{0,14}$/);
const expirationSchema = z.string().date();

export const GET: RequestHandler = async ({ params, url }) => {
	const symbol = symbolSchema.safeParse(params.symbol);
	if (!symbol.success)
		return Response.json({ error: 'Invalid underlying symbol.' }, { status: 400 });
	const rawExpiration = url.searchParams.get('expiration');
	const expiration = rawExpiration ? expirationSchema.safeParse(rawExpiration) : undefined;
	if (expiration && !expiration.success) {
		return Response.json({ error: 'Expiration must use YYYY-MM-DD.' }, { status: 400 });
	}

	const environment = getMarketEnvironment();
	if (!environment.capabilities.options.snapshots) {
		return Response.json(
			{
				error: 'Option-chain snapshots are not included in the configured Massive plan.',
				feed: environment.capabilities.options
			},
			{ status: 409 }
		);
	}

	try {
		const page = await getMarketDataProvider().getOptionChain(symbol.data, {
			expirationDate: expiration?.data,
			limit: 250
		});
		return Response.json({
			items: page.items.map((snapshot) =>
				serializeOptionSnapshot(snapshot, environment.capabilities.options)
			),
			feed: environment.capabilities.options,
			nextUrlAvailable: Boolean(page.nextUrl)
		});
	} catch (cause) {
		if (cause instanceof MassiveHttpError) {
			return Response.json({ error: cause.message }, { status: cause.status === 429 ? 429 : 502 });
		}
		throw cause;
	}
};
