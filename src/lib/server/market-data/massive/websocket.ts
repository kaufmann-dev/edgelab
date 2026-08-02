import { z } from 'zod';
import type { AssetClass, NormalizedMarketEvent } from '../types';
import { normalizeMassiveWebSocketFrame } from './normalize';

export interface WebSocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(
		type: 'open' | 'message' | 'error' | 'close',
		listener: (event: unknown) => void
	): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type MassiveSocketStatus =
	'idle' | 'connecting' | 'connected' | 'authenticated' | 'closed' | 'error';

export interface MassiveSocketHandlers {
	onEvents(events: NormalizedMarketEvent[]): void;
	onStatus?(status: MassiveSocketStatus, message?: string): void;
	onError?(error: Error): void;
}

const subscriptionSchema = z
	.string()
	.trim()
	.regex(/^(?:Q|T|A|AM|LULD)\.[A-Z0-9:._-]+$/);
const statusEventSchema = z
	.object({
		ev: z.literal('status'),
		status: z.string(),
		message: z.string().optional()
	})
	.passthrough();

function defaultWebSocketFactory(url: string): WebSocketLike {
	if (typeof globalThis.WebSocket !== 'function') {
		throw new Error('No native WebSocket implementation is available');
	}
	return new globalThis.WebSocket(url) as unknown as WebSocketLike;
}

function payloadData(event: unknown): unknown {
	if (typeof event === 'object' && event !== null && 'data' in event) {
		return (event as { data: unknown }).data;
	}
	return event;
}

function decodeForStatus(payload: unknown): unknown[] | undefined {
	const data = payloadData(payload);
	if (typeof data !== 'string') return undefined;
	try {
		const parsed = JSON.parse(data) as unknown;
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export class MassiveWebSocketSession {
	readonly #apiKey: string;
	readonly #assetClass: AssetClass;
	readonly #mode: 'realtime' | 'delayed';
	readonly #factory: WebSocketFactory;
	readonly #handlers: MassiveSocketHandlers;
	readonly #subscriptions = new Set<string>();
	#socket?: WebSocketLike;
	#authenticated = false;
	#status: MassiveSocketStatus = 'idle';

	constructor(input: {
		apiKey: string;
		assetClass: AssetClass;
		mode: 'realtime' | 'delayed';
		handlers: MassiveSocketHandlers;
		webSocketFactory?: WebSocketFactory;
	}) {
		if (!input.apiKey.trim()) throw new Error('Massive API key is required');
		this.#apiKey = input.apiKey;
		this.#assetClass = input.assetClass;
		this.#mode = input.mode;
		this.#handlers = input.handlers;
		this.#factory = input.webSocketFactory ?? defaultWebSocketFactory;
	}

	get status(): MassiveSocketStatus {
		return this.#status;
	}

	get subscriptions(): ReadonlySet<string> {
		return this.#subscriptions;
	}

	connect(): void {
		if (this.#socket) throw new Error('Massive WebSocket session is already connected');
		const host = this.#mode === 'realtime' ? 'socket.massive.com' : 'delayed.massive.com';
		const market = this.#assetClass === 'stocks' ? 'stocks' : 'options';
		this.#setStatus('connecting');
		const socket = this.#factory(`wss://${host}/${market}`);
		this.#socket = socket;

		socket.addEventListener('open', () => {
			this.#setStatus('connected');
			socket.send(JSON.stringify({ action: 'auth', params: this.#apiKey }));
		});
		socket.addEventListener('message', (event) => this.#handleMessage(event));
		socket.addEventListener('error', () => {
			this.#setStatus('error', 'Massive WebSocket error');
			this.#handlers.onError?.(new Error('Massive WebSocket error'));
		});
		socket.addEventListener('close', () => {
			this.#authenticated = false;
			this.#socket = undefined;
			this.#setStatus('closed');
		});
	}

	replaceSubscriptions(topics: Iterable<string>): void {
		const next = new Set(Array.from(topics, (topic) => this.#validateTopic(topic)));
		const removed = [...this.#subscriptions].filter((topic) => !next.has(topic));
		const added = [...next].filter((topic) => !this.#subscriptions.has(topic));
		this.#subscriptions.clear();
		for (const topic of next) this.#subscriptions.add(topic);
		if (!this.#authenticated || !this.#socket) return;
		if (removed.length > 0) this.#sendAction('unsubscribe', removed);
		if (added.length > 0) this.#sendAction('subscribe', added);
	}

	close(code = 1000, reason = 'client shutdown'): void {
		this.#socket?.close(code, reason);
		this.#socket = undefined;
		this.#authenticated = false;
		this.#setStatus('closed');
	}

	#validateTopic(topic: string): string {
		const normalized = subscriptionSchema.parse(topic.toUpperCase());
		if (this.#assetClass === 'options' && normalized.startsWith('LULD.')) {
			throw new Error('LULD is available only for stocks');
		}
		const symbol = normalized.slice(normalized.indexOf('.') + 1);
		if (this.#assetClass === 'options' && !symbol.startsWith('O:')) {
			throw new Error('Option subscriptions require an O: contract symbol');
		}
		return normalized;
	}

	#handleMessage(event: unknown): void {
		const payload = payloadData(event);
		const possibleStatuses = decodeForStatus(event);
		if (possibleStatuses) {
			for (const candidate of possibleStatuses) {
				const status = statusEventSchema.safeParse(candidate);
				if (!status.success) continue;
				if (status.data.status === 'auth_success') {
					this.#authenticated = true;
					this.#setStatus('authenticated', status.data.message);
					if (this.#subscriptions.size > 0) {
						this.#sendAction('subscribe', [...this.#subscriptions]);
					}
				} else if (status.data.status === 'auth_failed' || status.data.status === 'error') {
					const error = new Error(status.data.message ?? `Massive ${status.data.status}`);
					this.#setStatus('error', error.message);
					this.#handlers.onError?.(error);
				}
			}
		}

		try {
			const normalized = normalizeMassiveWebSocketFrame(payload, {
				assetClass: this.#assetClass,
				mode: this.#mode
			});
			if (normalized.length > 0) this.#handlers.onEvents(normalized);
		} catch (error) {
			this.#handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
		}
	}

	#sendAction(action: 'subscribe' | 'unsubscribe', topics: string[]): void {
		this.#socket?.send(JSON.stringify({ action, params: topics.join(',') }));
	}

	#setStatus(status: MassiveSocketStatus, message?: string): void {
		this.#status = status;
		this.#handlers.onStatus?.(status, message);
	}
}
