import {
	MassiveWebSocketSession,
	type AssetClass,
	type MarketDataMode,
	type MassiveSocketStatus,
	type NormalizedMarketEvent
} from '#lib/server/market-data/index.js';
import { getMarketEnvironment } from '#lib/server/market.js';

export type MarketStreamEventName = 'Q' | 'T' | 'A' | 'AM' | 'LULD';

export interface MarketStreamMessage {
	type: 'status' | 'market';
	data: unknown;
}

interface Subscriber {
	id: symbol;
	topics: Set<string>;
	onMessage: (message: MarketStreamMessage) => void;
}

interface EventSubscriber {
	id: symbol;
	topics: Set<string>;
	onEvent: (event: NormalizedMarketEvent) => void;
	onStatus?: (status: MassiveSocketStatus, message?: string) => void;
}

const validSymbol = /^[A-Z][A-Z0-9:._-]{0,63}$/;

export function buildMarketTopics(input: {
	assetClass: AssetClass;
	symbols: readonly string[];
	events: readonly MarketStreamEventName[];
}): string[] {
	if (input.symbols.length === 0 || input.symbols.length > 25) {
		throw new Error('A stream requires between 1 and 25 symbols');
	}
	const topics = new Set<string>();
	for (const rawSymbol of input.symbols) {
		const symbol = rawSymbol.trim().toUpperCase();
		if (!validSymbol.test(symbol)) throw new Error(`Invalid market symbol: ${rawSymbol}`);
		if (input.assetClass === 'options' && !symbol.startsWith('O:')) {
			throw new Error('Option streams require O: contract symbols');
		}
		for (const eventName of input.events) {
			if (input.assetClass === 'options' && eventName === 'LULD') {
				throw new Error('LULD streams are available only for stocks');
			}
			topics.add(`${eventName}.${symbol}`);
		}
	}
	return [...topics].sort();
}

function topicForEvent(event: NormalizedMarketEvent): string {
	const prefix =
		event.kind === 'quote'
			? 'Q'
			: event.kind === 'trade'
				? 'T'
				: event.kind === 'luld'
					? 'LULD'
					: event.interval === 'minute'
						? 'AM'
						: 'A';
	return `${prefix}.${event.symbol}`;
}

function serializableEvent(event: NormalizedMarketEvent): unknown {
	return JSON.parse(
		JSON.stringify(event, (_key, value: unknown) => {
			if (value instanceof Date) return value.toISOString();
			if (
				value &&
				typeof value === 'object' &&
				'toString' in value &&
				value.constructor?.name === 'Decimal'
			) {
				return value.toString();
			}
			return value;
		})
	) as unknown;
}

class AssetStream {
	readonly #assetClass: AssetClass;
	readonly #mode: MarketDataMode;
	readonly #subscribers = new Map<symbol, Subscriber>();
	readonly #eventSubscribers = new Map<symbol, EventSubscriber>();
	#session?: MassiveWebSocketSession;
	#retryTimer?: ReturnType<typeof setTimeout>;
	#retryAttempt = 0;
	#closing = false;

	constructor(assetClass: AssetClass, mode: MarketDataMode) {
		this.#assetClass = assetClass;
		this.#mode = mode;
	}

	subscribe(topics: string[], onMessage: Subscriber['onMessage']): () => void {
		const subscriber: Subscriber = {
			id: Symbol('market-subscriber'),
			topics: new Set(topics),
			onMessage
		};
		this.#subscribers.set(subscriber.id, subscriber);
		try {
			this.#assertEntitlements();
			this.#replaceSubscriptions();
			this.#ensureConnected();
		} catch (error) {
			this.#subscribers.delete(subscriber.id);
			this.#replaceSubscriptions();
			if (this.#subscriberCount() === 0) this.#shutdown();
			throw error;
		}
		onMessage({
			type: 'status',
			data: {
				state: this.#session?.status ?? 'connecting',
				assetClass: this.#assetClass,
				mode: this.#mode
			}
		});

		return () => {
			this.#subscribers.delete(subscriber.id);
			this.#replaceSubscriptions();
			if (this.#subscriberCount() === 0) this.#shutdown();
		};
	}

	subscribeEvents(
		topics: string[],
		onEvent: EventSubscriber['onEvent'],
		onStatus?: EventSubscriber['onStatus']
	): () => void {
		const subscriber: EventSubscriber = {
			id: Symbol('market-event-subscriber'),
			topics: new Set(topics),
			onEvent,
			onStatus
		};
		this.#eventSubscribers.set(subscriber.id, subscriber);
		try {
			this.#assertEntitlements();
			this.#replaceSubscriptions();
			this.#ensureConnected();
		} catch (error) {
			this.#eventSubscribers.delete(subscriber.id);
			this.#replaceSubscriptions();
			if (this.#subscriberCount() === 0) this.#shutdown();
			throw error;
		}
		onStatus?.(this.#session?.status ?? 'connecting');

		return () => {
			this.#eventSubscribers.delete(subscriber.id);
			this.#replaceSubscriptions();
			if (this.#subscriberCount() === 0) this.#shutdown();
		};
	}

	#ensureConnected(): void {
		if (this.#session || this.#subscriberCount() === 0) return;
		const environment = getMarketEnvironment();
		this.#assertEntitlements();
		this.#closing = false;
		const session = new MassiveWebSocketSession({
			apiKey: environment.apiKey,
			assetClass: this.#assetClass,
			mode: this.#mode,
			handlers: {
				onEvents: (events) => {
					if (this.#session === session) this.#broadcastEvents(events);
				},
				onStatus: (status, message) => this.#handleStatus(session, status, message),
				onError: (error) => {
					if (this.#session === session) this.#broadcastStatus('error', error.message);
				}
			}
		});
		this.#session = session;
		session.replaceSubscriptions(this.#combinedTopics());
		try {
			session.connect();
		} catch (error) {
			this.#session = undefined;
			throw error;
		}
	}

	#assertEntitlements(): void {
		const capabilities = getMarketEnvironment().capabilities[this.#assetClass];
		if (!capabilities.websocket) {
			throw new Error(
				`${this.#assetClass} WebSocket data is not included in the configured Massive plan`
			);
		}
		if (this.#mode !== capabilities.executionMode) {
			throw new Error(
				`${this.#assetClass} ${this.#mode} WebSocket data does not match the configured Massive plan`
			);
		}
		const topics = this.#combinedTopics();
		if ([...topics].some((topic) => topic.startsWith('Q.')) && !capabilities.quotes) {
			throw new Error(
				`${this.#assetClass} WebSocket quotes are not included in the configured Massive plan`
			);
		}
		if ([...topics].some((topic) => topic.startsWith('T.')) && !capabilities.trades) {
			throw new Error(
				`${this.#assetClass} WebSocket trades are not included in the configured Massive plan`
			);
		}
		if ([...topics].some((topic) => topic.startsWith('A.')) && !capabilities.secondBars) {
			throw new Error(
				`${this.#assetClass} WebSocket second aggregates are not included in the configured Massive plan`
			);
		}
		if ([...topics].some((topic) => topic.startsWith('AM.')) && !capabilities.minuteBars) {
			throw new Error(
				`${this.#assetClass} WebSocket minute aggregates are not included in the configured Massive plan`
			);
		}
		if ([...topics].some((topic) => topic.startsWith('LULD.')) && !capabilities.luld) {
			throw new Error(
				`${this.#assetClass} LULD events are not included in the configured Massive plan`
			);
		}
	}

	#handleStatus(
		session: MassiveWebSocketSession,
		status: MassiveSocketStatus,
		message?: string
	): void {
		if (this.#session !== session) return;
		if (status === 'authenticated') this.#retryAttempt = 0;
		this.#broadcastStatus(status, message);
		if ((status === 'closed' || status === 'error') && !this.#closing) {
			this.#session = undefined;
			if (status === 'error') session.close(1011, 'reconnecting after stream error');
			this.#scheduleReconnect();
		}
	}

	#scheduleReconnect(): void {
		if (this.#retryTimer || this.#subscriberCount() === 0) return;
		this.#session = undefined;
		const delay = Math.min(30_000, 1_000 * 2 ** this.#retryAttempt);
		this.#retryAttempt += 1;
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			try {
				this.#ensureConnected();
			} catch (cause) {
				this.#broadcastStatus('error', cause instanceof Error ? cause.message : String(cause));
				this.#scheduleReconnect();
			}
		}, delay);
		this.#retryTimer.unref?.();
	}

	#combinedTopics(): Set<string> {
		return new Set(
			[...this.#subscribers.values(), ...this.#eventSubscribers.values()].flatMap((subscriber) => [
				...subscriber.topics
			])
		);
	}

	#subscriberCount(): number {
		return this.#subscribers.size + this.#eventSubscribers.size;
	}

	#replaceSubscriptions(): void {
		this.#session?.replaceSubscriptions(this.#combinedTopics());
	}

	#broadcastEvents(events: NormalizedMarketEvent[]): void {
		for (const event of events) {
			const topic = topicForEvent(event);
			for (const subscriber of this.#eventSubscribers.values()) {
				if (subscriber.topics.has(topic)) subscriber.onEvent(event);
			}
			const message: MarketStreamMessage = { type: 'market', data: serializableEvent(event) };
			for (const subscriber of this.#subscribers.values()) {
				if (subscriber.topics.has(topic)) subscriber.onMessage(message);
			}
		}
	}

	#broadcastStatus(status: MassiveSocketStatus, message?: string): void {
		for (const subscriber of this.#eventSubscribers.values()) {
			subscriber.onStatus?.(status, message);
		}
		for (const subscriber of this.#subscribers.values()) {
			subscriber.onMessage({
				type: 'status',
				data: { state: status, assetClass: this.#assetClass, mode: this.#mode, message }
			});
		}
	}

	#shutdown(): void {
		this.#closing = true;
		if (this.#retryTimer) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		this.#retryAttempt = 0;
		this.#session?.close(1000, 'no active subscribers');
		this.#session = undefined;
	}
}

class MarketStreamHub {
	readonly #streams = new Map<string, AssetStream>();

	#stream(assetClass: AssetClass, mode: MarketDataMode): AssetStream {
		const key = `${mode}:${assetClass}`;
		const existing = this.#streams.get(key);
		if (existing) return existing;
		const stream = new AssetStream(assetClass, mode);
		this.#streams.set(key, stream);
		return stream;
	}

	#configuredMode(assetClass: AssetClass): MarketDataMode {
		const mode = getMarketEnvironment().capabilities[assetClass].executionMode;
		if (!mode) throw new Error(`${assetClass} has no executable WebSocket clock`);
		return mode;
	}

	subscribe(
		assetClass: AssetClass,
		topics: string[],
		onMessage: Subscriber['onMessage']
	): () => void {
		return this.#stream(assetClass, this.#configuredMode(assetClass)).subscribe(topics, onMessage);
	}

	subscribeEvents(
		assetClass: AssetClass,
		topics: string[],
		onEvent: (event: NormalizedMarketEvent) => void,
		mode = this.#configuredMode(assetClass),
		onStatus?: EventSubscriber['onStatus']
	): () => void {
		return this.#stream(assetClass, mode).subscribeEvents(topics, onEvent, onStatus);
	}
}

export const marketStreamHub = new MarketStreamHub();
