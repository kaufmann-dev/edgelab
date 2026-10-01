<script lang="ts">
	import ChartNoAxesCombinedIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import { EquityCurveChart, MetricStrip } from '#lib/components/trading/index.js';
	import type { MetricItem, ValueTone } from '#lib/components/trading/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const percent = new Intl.NumberFormat('en-US', {
		style: 'percent',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		signDisplay: 'exceptZero'
	});
	const percentMagnitude = new Intl.NumberFormat('en-US', {
		style: 'percent',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
	const money = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 2
	});
	const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

	let valuationCountLabel = $derived(
		`${data.curve.length} recorded ${data.curve.length === 1 ? 'valuation' : 'valuations'}`
	);
	let performanceMetrics = $derived.by((): MetricItem[] => [
		{
			id: 'total-return',
			label: 'Total return',
			value: formatRate(data.metrics.totalReturn),
			tone: returnTone(data.metrics.totalReturn)
		},
		{
			id: 'benchmark-return',
			label: 'Benchmark return',
			value: formatRate(data.metrics.benchmarkReturn),
			tone: returnTone(data.metrics.benchmarkReturn)
		},
		{
			id: 'relative-return',
			label: 'Relative return',
			value: formatRate(data.metrics.benchmarkRelativeReturn),
			tone: returnTone(data.metrics.benchmarkRelativeReturn)
		},
		{
			id: 'annualized-return',
			label: 'Annualized return',
			value: formatRate(data.metrics.annualizedReturn),
			tone: returnTone(data.metrics.annualizedReturn)
		},
		{
			id: 'volatility',
			label: 'Annualized volatility',
			value: formatMagnitude(data.metrics.annualizedVolatility)
		},
		{
			id: 'drawdown',
			label: 'Maximum drawdown',
			value: formatMagnitude(data.metrics.maximumDrawdown),
			tone:
				data.metrics.maximumDrawdown && data.metrics.maximumDrawdown > 0 ? 'negative' : 'default'
		}
	]);
	let evidenceDimensions = $derived([
		{ id: 'outcome', label: 'Outcome quality', value: data.metrics.skill.outcomeQuality },
		{ id: 'risk', label: 'Risk control', value: data.metrics.skill.riskControl },
		{ id: 'consistency', label: 'Consistency', value: data.metrics.skill.consistency },
		{ id: 'execution', label: 'Execution quality', value: data.metrics.skill.executionQuality },
		{ id: 'process', label: 'Process adherence', value: data.metrics.skill.processAdherence }
	]);

	function formatRate(value: number | null): string {
		return value === null ? '—' : percent.format(value);
	}

	function formatMagnitude(value: number | null): string {
		return value === null ? '—' : percentMagnitude.format(value);
	}

	function formatDecimal(value: number | null): string {
		return value === null ? '—' : decimal.format(value);
	}

	function formatMoney(value: string | null): string {
		if (value === null) return '—';
		const parsed = Number(value);
		return Number.isFinite(parsed) ? money.format(parsed) : value;
	}

	function formatHours(value: number | null): string {
		return value === null ? '—' : `${decimal.format(value)} h`;
	}

	function returnTone(value: number | null): ValueTone {
		if (value === null || value === 0) return 'default';
		return value > 0 ? 'positive' : 'negative';
	}
</script>

<svelte:head><title>Analytics · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">Analytics</h1>
		<p class="mt-1 max-w-3xl text-sm text-muted-foreground">
			Risk, return, execution, and sample sufficiency remain separate so limited history is not
			presented as proven skill.
		</p>
	</header>

	<MetricStrip metrics={performanceMetrics} label="Performance metrics" />

	<EquityCurveChart
		points={data.curve}
		title="Portfolio and benchmark"
		rangeLabel={valuationCountLabel}
	/>

	<div class="grid gap-6 lg:grid-cols-2">
		<section class="border border-border bg-background" aria-labelledby="risk-statistics-title">
			<header class="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
				<ScaleIcon class="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
				<div>
					<h2 id="risk-statistics-title" class="text-sm font-semibold">Risk-adjusted statistics</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						Unavailable values need more valuation history.
					</p>
				</div>
			</header>
			<dl class="grid grid-cols-2 gap-px bg-border">
				<div class="bg-background p-4 sm:p-5">
					<dt class="text-xs text-muted-foreground">Sharpe ratio</dt>
					<dd class="mt-1 text-lg font-semibold tabular-nums">
						{formatDecimal(data.metrics.sharpeRatio)}
					</dd>
				</div>
				<div class="bg-background p-4 sm:p-5">
					<dt class="text-xs text-muted-foreground">Sortino ratio</dt>
					<dd class="mt-1 text-lg font-semibold tabular-nums">
						{formatDecimal(data.metrics.sortinoRatio)}
					</dd>
				</div>
			</dl>
		</section>

		<section class="border border-border bg-background" aria-labelledby="trade-outcomes-title">
			<header class="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
				<ChartNoAxesCombinedIcon class="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
				<div>
					<h2 id="trade-outcomes-title" class="text-sm font-semibold">Closed-trade outcomes</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						Calculated only from completed trade samples.
					</p>
				</div>
			</header>
			<dl class="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">Win rate</dt>
					<dd class="mt-1 font-semibold tabular-nums">{formatMagnitude(data.metrics.winRate)}</dd>
				</div>
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">Profit factor</dt>
					<dd class="mt-1 font-semibold tabular-nums">
						{formatDecimal(data.metrics.profitFactor)}
					</dd>
				</div>
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">Expectancy</dt>
					<dd class="mt-1 font-semibold tabular-nums">{formatMoney(data.metrics.expectancy)}</dd>
				</div>
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">Average win</dt>
					<dd class="mt-1 font-semibold tabular-nums">{formatMoney(data.metrics.averageWin)}</dd>
				</div>
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">Average loss</dt>
					<dd class="mt-1 font-semibold tabular-nums">{formatMoney(data.metrics.averageLoss)}</dd>
				</div>
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">Average hold</dt>
					<dd class="mt-1 font-semibold tabular-nums">
						{formatHours(data.metrics.averageHoldingHours)}
					</dd>
				</div>
			</dl>
		</section>
	</div>

	<section class="border border-border bg-background" aria-labelledby="skill-evidence-title">
		<header
			class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5"
		>
			<div class="flex items-start gap-3">
				<ClipboardCheckIcon class="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
				<div>
					<h2 id="skill-evidence-title" class="text-sm font-semibold">Skill evidence</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						{data.metrics.skill.closedTrades} closed trades across {data.metrics.skill
							.activeMarketDays}
						active market days
					</p>
				</div>
			</div>
			<Badge
				variant={data.metrics.skill.evidenceReady ? 'default' : 'outline'}
				class="rounded-none"
			>
				{data.metrics.skill.evidenceReady ? 'Evidence ready' : 'Building sample'}
			</Badge>
		</header>

		{#if !data.metrics.skill.evidenceReady}
			<p class="border-b border-border px-4 py-3 text-sm text-muted-foreground sm:px-5">
				Any available dimension scores are preliminary until the portfolio has enough relevant
				observations.
			</p>
		{/if}

		<dl class="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
			{#each evidenceDimensions as dimension (dimension.id)}
				<div class="bg-background p-4">
					<dt class="text-xs text-muted-foreground">{dimension.label}</dt>
					<dd class="mt-1 font-semibold tabular-nums">
						{dimension.value === null ? '—' : `${dimension.value} / 100`}
					</dd>
				</div>
			{/each}
		</dl>
	</section>
</div>
