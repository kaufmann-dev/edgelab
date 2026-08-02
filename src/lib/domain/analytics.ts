import Decimal from 'decimal.js';

export interface EquityPoint {
	at: Date | string;
	netLiquidationValue: string;
	benchmarkValue?: string | null;
}

export interface ClosedTradeSample {
	id: string;
	realizedPnl: string;
	openedAt: Date | string;
	closedAt: Date | string;
	plannedRisk?: string | null;
	slippage?: string | null;
	followedPlan?: boolean | null;
}

export interface SkillEvidence {
	evidenceReady: boolean;
	closedTrades: number;
	activeMarketDays: number;
	outcomeQuality: number | null;
	riskControl: number | null;
	consistency: number | null;
	executionQuality: number | null;
	processAdherence: number | null;
}

export interface PerformanceMetrics {
	totalReturn: number | null;
	benchmarkReturn: number | null;
	benchmarkRelativeReturn: number | null;
	annualizedReturn: number | null;
	annualizedVolatility: number | null;
	sharpeRatio: number | null;
	sortinoRatio: number | null;
	maximumDrawdown: number | null;
	winRate: number | null;
	profitFactor: number | null;
	expectancy: string | null;
	averageWin: string | null;
	averageLoss: string | null;
	averageHoldingHours: number | null;
	skill: SkillEvidence;
}

const TRADING_DAYS_PER_YEAR = 252;
const MILLISECONDS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function asTime(value: Date | string): number {
	const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
	if (!Number.isFinite(milliseconds)) throw new Error('Analytics input contains an invalid date');
	return milliseconds;
}

function safeRatio(numerator: Decimal, denominator: Decimal): number | null {
	if (denominator.isZero()) return null;
	return numerator.div(denominator).toNumber();
}

function mean(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]): number | null {
	if (values.length < 2) return null;
	const average = mean(values);
	if (average === null) return null;
	const variance =
		values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
	return Math.sqrt(variance);
}

function clampScore(value: number): number {
	return Math.round(Math.min(100, Math.max(0, value)));
}

function calculateSkillEvidence(
	trades: ClosedTradeSample[],
	dailyReturns: number[],
	benchmarkRelativeReturn: number | null,
	maximumDrawdown: number | null
): SkillEvidence {
	const activeMarketDays = new Set(
		trades.map((trade) => new Date(asTime(trade.closedAt)).toISOString().slice(0, 10))
	).size;
	const evidenceReady = trades.length >= 30 && activeMarketDays >= 20;
	const positiveDayShare =
		dailyReturns.length === 0
			? null
			: dailyReturns.filter((value) => value > 0).length / dailyReturns.length;
	const riskMeasuredTrades = trades.filter(
		(trade) => trade.plannedRisk !== null && trade.plannedRisk !== undefined
	);
	const riskMultiples = riskMeasuredTrades.map((trade) => {
		const plannedRisk = new Decimal(trade.plannedRisk!);
		if (plannedRisk.lte(0)) return null;
		return new Decimal(trade.realizedPnl).div(plannedRisk).toNumber();
	});
	const validRiskMultiples = riskMultiples.filter((value): value is number => value !== null);
	const catastrophicLossShare =
		validRiskMultiples.length === 0
			? null
			: validRiskMultiples.filter((value) => value < -1.25).length / validRiskMultiples.length;
	const slippageSamples = trades
		.filter((trade) => trade.slippage !== null && trade.slippage !== undefined)
		.map((trade) => Math.abs(new Decimal(trade.slippage!).toNumber()));
	const averageSlippage = mean(slippageSamples);
	const planSamples = trades.filter(
		(trade) => trade.followedPlan !== null && trade.followedPlan !== undefined
	);
	const adherence =
		planSamples.length === 0
			? null
			: planSamples.filter((trade) => trade.followedPlan === true).length / planSamples.length;

	return {
		evidenceReady,
		closedTrades: trades.length,
		activeMarketDays,
		outcomeQuality:
			benchmarkRelativeReturn === null
				? null
				: clampScore(50 + Math.tanh(benchmarkRelativeReturn * 5) * 50),
		riskControl:
			maximumDrawdown === null || catastrophicLossShare === null
				? null
				: clampScore(100 - Math.min(60, maximumDrawdown * 200) - catastrophicLossShare * 40),
		consistency: positiveDayShare === null ? null : clampScore(positiveDayShare * 100),
		executionQuality:
			averageSlippage === null ? null : clampScore(100 - Math.min(100, averageSlippage * 100)),
		processAdherence: adherence === null ? null : clampScore(adherence * 100)
	};
}

export function calculatePerformanceMetrics(
	equityPoints: EquityPoint[],
	closedTrades: ClosedTradeSample[],
	annualRiskFreeRate = 0
): PerformanceMetrics {
	const curve = [...equityPoints].sort((left, right) => asTime(left.at) - asTime(right.at));
	const trades = [...closedTrades].sort(
		(left, right) => asTime(left.closedAt) - asTime(right.closedAt)
	);
	const first = curve.at(0);
	const last = curve.at(-1);
	const totalReturn =
		first && last
			? safeRatio(
					new Decimal(last.netLiquidationValue).minus(first.netLiquidationValue),
					new Decimal(first.netLiquidationValue)
				)
			: null;
	const benchmarkReturn =
		first?.benchmarkValue && last?.benchmarkValue
			? safeRatio(
					new Decimal(last.benchmarkValue).minus(first.benchmarkValue),
					new Decimal(first.benchmarkValue)
				)
			: null;
	const benchmarkRelativeReturn =
		totalReturn === null || benchmarkReturn === null ? null : totalReturn - benchmarkReturn;

	const dailyReturns: number[] = [];
	let peak: Decimal | null = null;
	let maximumDrawdown = 0;
	for (let index = 0; index < curve.length; index += 1) {
		const nav = new Decimal(curve[index].netLiquidationValue);
		if (nav.lte(0)) throw new Error('Net liquidation value must remain greater than zero');
		if (peak === null || nav.gt(peak)) peak = nav;
		const drawdown = peak.minus(nav).div(peak).toNumber();
		maximumDrawdown = Math.max(maximumDrawdown, drawdown);
		if (index > 0) {
			const prior = new Decimal(curve[index - 1].netLiquidationValue);
			dailyReturns.push(nav.minus(prior).div(prior).toNumber());
		}
	}

	const averageDailyReturn = mean(dailyReturns);
	const dailyVolatility = sampleStandardDeviation(dailyReturns);
	const annualizedVolatility =
		dailyVolatility === null ? null : dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);
	const dailyRiskFreeRate = annualRiskFreeRate / TRADING_DAYS_PER_YEAR;
	const sharpeRatio =
		averageDailyReturn === null || dailyVolatility === null || dailyVolatility === 0
			? null
			: ((averageDailyReturn - dailyRiskFreeRate) / dailyVolatility) *
				Math.sqrt(TRADING_DAYS_PER_YEAR);
	const downsideDeviation =
		dailyReturns.length === 0
			? null
			: Math.sqrt(
					dailyReturns.reduce(
						(total, value) => total + Math.min(0, value - dailyRiskFreeRate) ** 2,
						0
					) / dailyReturns.length
				);
	const sortinoRatio =
		averageDailyReturn === null || downsideDeviation === null || downsideDeviation === 0
			? null
			: ((averageDailyReturn - dailyRiskFreeRate) / downsideDeviation) *
				Math.sqrt(TRADING_DAYS_PER_YEAR);

	let annualizedReturn: number | null = null;
	if (first && last && totalReturn !== null && totalReturn > -1) {
		const elapsedYears = (asTime(last.at) - asTime(first.at)) / MILLISECONDS_PER_YEAR;
		if (elapsedYears >= 0.25) annualizedReturn = (1 + totalReturn) ** (1 / elapsedYears) - 1;
	}

	const wins = trades.filter((trade) => new Decimal(trade.realizedPnl).gt(0));
	const losses = trades.filter((trade) => new Decimal(trade.realizedPnl).lt(0));
	const grossWins = Decimal.sum(0, ...wins.map((trade) => trade.realizedPnl));
	const grossLosses = Decimal.sum(0, ...losses.map((trade) => trade.realizedPnl)).abs();
	const totalPnl = Decimal.sum(0, ...trades.map((trade) => trade.realizedPnl));
	const averageHoldingHours =
		trades.length === 0
			? null
			: trades.reduce(
					(total, trade) => total + (asTime(trade.closedAt) - asTime(trade.openedAt)) / 3_600_000,
					0
				) / trades.length;

	return {
		totalReturn,
		benchmarkReturn,
		benchmarkRelativeReturn,
		annualizedReturn,
		annualizedVolatility,
		sharpeRatio,
		sortinoRatio,
		maximumDrawdown: curve.length === 0 ? null : maximumDrawdown,
		winRate: trades.length === 0 ? null : wins.length / trades.length,
		profitFactor: losses.length === 0 ? null : grossWins.div(grossLosses).toNumber(),
		expectancy: trades.length === 0 ? null : totalPnl.div(trades.length).toFixed(4),
		averageWin: wins.length === 0 ? null : grossWins.div(wins.length).toFixed(4),
		averageLoss: losses.length === 0 ? null : grossLosses.neg().div(losses.length).toFixed(4),
		averageHoldingHours,
		skill: calculateSkillEvidence(
			trades,
			dailyReturns,
			benchmarkRelativeReturn,
			curve.length === 0 ? null : maximumDrawdown
		)
	};
}
