const MAX_PROCESS_CONNECTIONS = 100;
const MAX_PROCESS_TOPICS = 500;
const MAX_USER_CONNECTIONS = 4;
const MAX_USER_TOPICS = 40;
const MAX_USER_STARTS_PER_MINUTE = 12;
const START_WINDOW_MILLISECONDS = 60_000;

interface AccessState {
	activeConnections: number;
	activeTopics: number;
	connectionsByUser: Map<string, Map<symbol, number>>;
	startsByUser: Map<string, number[]>;
}

const stateSymbol = Symbol.for('trading-simulator.market-stream-access');
const processGlobal = globalThis as typeof globalThis & { [stateSymbol]?: AccessState };
const state =
	processGlobal[stateSymbol] ??
	({
		activeConnections: 0,
		activeTopics: 0,
		connectionsByUser: new Map(),
		startsByUser: new Map()
	} satisfies AccessState);
processGlobal[stateSymbol] = state;

export class MarketStreamAccessError extends Error {
	constructor(
		message: string,
		readonly retryAfterSeconds: number
	) {
		super(message);
		this.name = 'MarketStreamAccessError';
	}
}

function registerStart(userId: string, now: Date): void {
	const nowMilliseconds = now.getTime();
	if (!Number.isFinite(nowMilliseconds)) throw new Error('Market-stream time is invalid');
	const cutoff = nowMilliseconds - START_WINDOW_MILLISECONDS;
	const previousStarts: number[] = state.startsByUser.get(userId) ?? [];
	const starts = previousStarts.filter((startedAt) => startedAt > cutoff);
	if (starts.length >= MAX_USER_STARTS_PER_MINUTE) {
		const retryAt = starts[0] + START_WINDOW_MILLISECONDS;
		throw new MarketStreamAccessError(
			'Too many market-stream connections. Try again shortly.',
			Math.max(1, Math.ceil((retryAt - nowMilliseconds) / 1_000))
		);
	}
	starts.push(nowMilliseconds);
	state.startsByUser.set(userId, starts);
}

/** Reserves one process-local authenticated SSE slot and returns an idempotent release function. */
export function acquireMarketStreamAccess(input: {
	userId: string;
	topicCount: number;
	now?: Date;
}): () => void {
	if (!input.userId || !Number.isInteger(input.topicCount) || input.topicCount < 1) {
		throw new Error('Market-stream access input is invalid');
	}
	registerStart(input.userId, input.now ?? new Date());
	const userConnections = state.connectionsByUser.get(input.userId) ?? new Map<symbol, number>();
	const userTopicCount = [...userConnections.values()].reduce((total, count) => total + count, 0);
	if (
		state.activeConnections >= MAX_PROCESS_CONNECTIONS ||
		state.activeTopics + input.topicCount > MAX_PROCESS_TOPICS ||
		userConnections.size >= MAX_USER_CONNECTIONS ||
		userTopicCount + input.topicCount > MAX_USER_TOPICS
	) {
		throw new MarketStreamAccessError('Market-stream capacity is temporarily exhausted.', 5);
	}

	const connectionId = Symbol('market-stream-connection');
	userConnections.set(connectionId, input.topicCount);
	state.connectionsByUser.set(input.userId, userConnections);
	state.activeConnections += 1;
	state.activeTopics += input.topicCount;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (userConnections.delete(connectionId)) {
			state.activeConnections -= 1;
			state.activeTopics -= input.topicCount;
		}
		if (userConnections.size === 0) state.connectionsByUser.delete(input.userId);
	};
}

export function resetMarketStreamAccessForTests(): void {
	state.activeConnections = 0;
	state.activeTopics = 0;
	state.connectionsByUser.clear();
	state.startsByUser.clear();
}
