import type {
	AssetClass,
	MarketDataMode,
	MarketDataRestProvider,
	MarketSnapshot,
	NormalizedBar
} from '#lib/server/market-data/index.js';

const MINUTE_MILLISECONDS = 60_000;
const DEFAULT_LOOKBACK_MINUTES = 5;

export function completedMinuteEnd(at: Date, delayMinutes: number): Date {
	const logicalTime = at.getTime() - delayMinutes * MINUTE_MILLISECONDS;
	return new Date(Math.floor(logicalTime / MINUTE_MILLISECONDS) * MINUTE_MILLISECONDS);
}

export function completedSnapshotMinuteBar(input: {
	snapshot: MarketSnapshot;
	assetClass: AssetClass;
	symbol: string;
	mode: MarketDataMode;
	delayMinutes: number;
	at?: Date;
}): NormalizedBar | undefined {
	const bar = input.snapshot.lastMinute;
	const at = input.at ?? new Date();
	if (
		!bar ||
		bar.assetClass !== input.assetClass ||
		bar.symbol !== input.symbol ||
		bar.mode !== input.mode ||
		bar.interval !== 'minute' ||
		bar.sourceTime.getTime() !== bar.endTime.getTime() ||
		bar.endTime > completedMinuteEnd(at, input.delayMinutes) ||
		!bar.close.greaterThan(0)
	) {
		return undefined;
	}
	return bar;
}

export async function loadLatestCompletedMinuteBar(input: {
	provider: Pick<MarketDataRestProvider, 'getBars'>;
	assetClass: AssetClass;
	symbol: string;
	mode: MarketDataMode;
	delayMinutes: number;
	at?: Date;
	lookbackMinutes?: number;
}): Promise<NormalizedBar | undefined> {
	const at = input.at ?? new Date();
	const end = completedMinuteEnd(at, input.delayMinutes);
	const lookbackMinutes = input.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
	const page = await input.provider.getBars({
		assetClass: input.assetClass,
		symbol: input.symbol,
		multiplier: 1,
		timespan: 'minute',
		from: String(end.getTime() - lookbackMinutes * MINUTE_MILLISECONDS),
		to: String(end.getTime() - 1),
		limit: lookbackMinutes + 1
	});

	return page.items
		.filter(
			(bar) =>
				bar.assetClass === input.assetClass &&
				bar.symbol === input.symbol &&
				bar.mode === input.mode &&
				bar.interval === 'minute' &&
				bar.endTime <= end &&
				bar.sourceTime.getTime() === bar.endTime.getTime()
		)
		.sort((left, right) => left.endTime.getTime() - right.endTime.getTime())
		.at(-1);
}
