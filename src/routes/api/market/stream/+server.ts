import { z } from 'zod';
import { getMarketEnvironment } from '#lib/server/market.js';
import {
	acquireMarketStreamAccess,
	MarketStreamAccessError
} from '#lib/server/market-stream-access.js';
import {
	buildMarketTopics,
	marketStreamHub,
	type MarketStreamEventName,
	type MarketStreamMessage
} from '#lib/server/market-stream.js';
import type { RequestHandler } from './$types';

const assetClassSchema = z.enum(['stocks', 'options']);
const eventSchema = z.enum(['Q', 'T', 'A', 'AM', 'LULD']);
const encoder = new TextEncoder();
const STREAM_AUTHORIZATION_LIFETIME_MILLISECONDS = 60_000;

function encode(message: MarketStreamMessage): Uint8Array {
	return encoder.encode(`event: ${message.type}\ndata: ${JSON.stringify(message.data)}\n\n`);
}

export const GET: RequestHandler = ({ url, request, locals }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
	const assetClass = assetClassSchema.safeParse(url.searchParams.get('assetClass'));
	const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
	const eventValues = (url.searchParams.get('events') ?? 'AM').split(',');
	const events = z.array(eventSchema).min(1).safeParse(eventValues);
	if (!assetClass.success || !events.success) {
		return Response.json({ error: 'Invalid assetClass or event selection.' }, { status: 400 });
	}

	let topics: string[];
	try {
		const environment = getMarketEnvironment();
		const capabilities = environment.capabilities[assetClass.data];
		if (events.data.includes('Q') && !capabilities.quotes) {
			return Response.json(
				{ error: 'Quote events are not included in the configured plan.' },
				{ status: 409 }
			);
		}
		if (events.data.includes('T') && !capabilities.trades) {
			return Response.json(
				{ error: 'Trade events are not included in the configured plan.' },
				{ status: 409 }
			);
		}
		if (events.data.includes('A') && !capabilities.secondBars) {
			return Response.json(
				{ error: 'Second aggregate events are not included in the configured plan.' },
				{ status: 409 }
			);
		}
		if (events.data.includes('AM') && !capabilities.minuteBars) {
			return Response.json(
				{ error: 'Minute aggregate events are not included in the configured plan.' },
				{ status: 409 }
			);
		}
		if (events.data.includes('LULD') && !capabilities.luld) {
			return Response.json(
				{ error: 'LULD events are not included in the configured plan.' },
				{ status: 409 }
			);
		}
		topics = buildMarketTopics({
			assetClass: assetClass.data,
			symbols,
			events: events.data as MarketStreamEventName[]
		});
	} catch (cause) {
		return Response.json(
			{ error: cause instanceof Error ? cause.message : 'Market stream unavailable.' },
			{ status: 503 }
		);
	}
	let releaseAccess: () => void;
	try {
		releaseAccess = acquireMarketStreamAccess({
			userId: locals.user.id,
			topicCount: topics.length
		});
	} catch (cause) {
		if (cause instanceof MarketStreamAccessError) {
			return Response.json(
				{ error: cause.message },
				{ status: 429, headers: { 'retry-after': String(cause.retryAfterSeconds) } }
			);
		}
		throw cause;
	}

	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let authorizationTimer: ReturnType<typeof setTimeout> | undefined;
	let cleanup = releaseAccess;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				if (heartbeat) clearInterval(heartbeat);
				if (authorizationTimer) clearTimeout(authorizationTimer);
				request.signal.removeEventListener('abort', finish);
				unsubscribe?.();
				releaseAccess();
				try {
					controller.close();
				} catch {
					// The client may already have closed the stream.
				}
			};
			const enqueue = (chunk: Uint8Array) => {
				if (finished) return;
				try {
					controller.enqueue(chunk);
				} catch {
					finish();
				}
			};
			cleanup = finish;
			enqueue(encoder.encode('retry: 3000\n\n'));
			try {
				unsubscribe = marketStreamHub.subscribe(assetClass.data, topics, (message) => {
					enqueue(encode(message));
				});
			} catch (cause) {
				enqueue(
					encode({
						type: 'status',
						data: {
							state: 'error',
							message: cause instanceof Error ? cause.message : String(cause)
						}
					})
				);
				finish();
				return;
			}
			heartbeat = setInterval(() => {
				enqueue(encoder.encode(': keepalive\n\n'));
			}, 25_000);
			authorizationTimer = setTimeout(finish, STREAM_AUTHORIZATION_LIFETIME_MILLISECONDS);
			authorizationTimer.unref?.();
			request.signal.addEventListener('abort', finish, { once: true });
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'private, no-store, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
