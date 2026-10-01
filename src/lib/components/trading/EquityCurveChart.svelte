<script lang="ts">
	import ChartNoAxesCombinedIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import EmptyState from './EmptyState.svelte';
	import type { EquityCurvePoint } from './types.js';

	interface Props {
		points: EquityCurvePoint[];
		title?: string;
		rangeLabel?: string;
		portfolioLabel?: string;
		benchmarkLabel?: string;
		currency?: string;
		locale?: string;
		summary?: string;
		loading?: boolean;
		formatValue?: (value: number) => string;
		formatTimestamp?: (timestamp: string) => string;
	}

	let {
		points,
		title = 'Equity curve',
		rangeLabel,
		portfolioLabel = 'Portfolio',
		benchmarkLabel = 'Benchmark',
		currency = 'USD',
		locale = 'en-US',
		summary,
		loading = false,
		formatValue,
		formatTimestamp
	}: Props = $props();

	const uid = $props.id();
	const width = 800;
	const height = 280;
	const topPadding = 20;
	const rightPadding = 16;
	const bottomPadding = 32;
	const leftPadding = 76;
	const plotWidth = width - leftPadding - rightPadding;
	const plotHeight = height - topPadding - bottomPadding;

	let currencyFormatter = $derived(
		new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			maximumFractionDigits: 2
		})
	);
	let dateFormatter = $derived(
		new Intl.DateTimeFormat(locale, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		})
	);
	let validPoints = $derived(
		points.filter(
			(point) =>
				Number.isFinite(point.portfolioValue) &&
				(point.benchmarkValue === undefined || Number.isFinite(point.benchmarkValue))
		)
	);
	let chart = $derived.by(() => {
		const values = validPoints.flatMap((point) =>
			point.benchmarkValue === undefined
				? [point.portfolioValue]
				: [point.portfolioValue, point.benchmarkValue]
		);
		if (values.length === 0) {
			return {
				minimum: 0,
				maximum: 0,
				portfolioPath: '',
				benchmarkPath: ''
			};
		}

		const rawMinimum = Math.min(...values);
		const rawMaximum = Math.max(...values);
		const range = rawMaximum - rawMinimum;
		const padding = range === 0 ? Math.max(Math.abs(rawMaximum) * 0.05, 1) : range * 0.08;
		const minimum = rawMinimum - padding;
		const maximum = rawMaximum + padding;
		const yRange = maximum - minimum;

		function x(index: number) {
			return validPoints.length === 1
				? leftPadding + plotWidth / 2
				: leftPadding + (index / (validPoints.length - 1)) * plotWidth;
		}

		function y(value: number) {
			return topPadding + ((maximum - value) / yRange) * plotHeight;
		}

		const portfolioPath = validPoints
			.map(
				(point, index) =>
					`${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.portfolioValue).toFixed(2)}`
			)
			.join(' ');
		const benchmarkPath = validPoints
			.map((point, index) => {
				if (point.benchmarkValue === undefined) return '';
				const hasPrevious = validPoints
					.slice(0, index)
					.some((candidate) => candidate.benchmarkValue !== undefined);
				return `${hasPrevious ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.benchmarkValue).toFixed(2)}`;
			})
			.filter(Boolean)
			.join(' ');

		return { minimum, maximum, portfolioPath, benchmarkPath };
	});
	let accessibleSummary = $derived.by(() => {
		if (summary) return summary;
		if (validPoints.length === 0) return 'No equity data is available for this period.';
		const first = validPoints[0];
		const last = validPoints.at(-1) ?? first;
		return `${portfolioLabel} moved from ${displayValue(first.portfolioValue)} to ${displayValue(last.portfolioValue)} between ${displayTimestamp(first.timestamp)} and ${displayTimestamp(last.timestamp)}.`;
	});

	function displayValue(value: number) {
		return formatValue ? formatValue(value) : currencyFormatter.format(value);
	}

	function displayTimestamp(timestamp: string) {
		if (formatTimestamp) return formatTimestamp(timestamp);
		const date = new Date(timestamp);
		return Number.isNaN(date.valueOf()) ? timestamp : dateFormatter.format(date);
	}
</script>

<section class="border border-border bg-background" aria-labelledby={`${uid}-title`}>
	<header
		class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5"
	>
		<div>
			<h2 id={`${uid}-title`} class="text-sm font-semibold">{title}</h2>
			{#if rangeLabel}<p class="mt-0.5 text-xs text-muted-foreground">{rangeLabel}</p>{/if}
		</div>
		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
			aria-label="Chart legend"
		>
			<span class="inline-flex items-center gap-1.5">
				<span class="h-0.5 w-5 bg-foreground" aria-hidden="true"></span>
				{portfolioLabel}
			</span>
			{#if validPoints.some((point) => point.benchmarkValue !== undefined)}
				<span class="inline-flex items-center gap-1.5">
					<svg class="h-1 w-5 text-muted-foreground" viewBox="0 0 20 4" aria-hidden="true">
						<path d="M0 2H20" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2" />
					</svg>
					{benchmarkLabel}
				</span>
			{/if}
		</div>
	</header>

	{#if loading}
		<div class="p-4 sm:p-5" role="status" aria-label="Loading equity curve">
			<Skeleton class="h-72 w-full rounded-none" />
		</div>
	{:else if validPoints.length === 0}
		<div class="p-4">
			<EmptyState
				title="No performance data"
				description="Portfolio value will appear after the simulation records its first valuation."
				icon={ChartNoAxesCombinedIcon}
				compact
			/>
		</div>
	{:else}
		<figure class="p-4 sm:p-5">
			<p id={`${uid}-summary`} class="mb-4 text-sm text-muted-foreground">{accessibleSummary}</p>
			<div class="h-72 w-full" aria-hidden="true">
				<svg
					viewBox={`0 0 ${width} ${height}`}
					class="h-full w-full overflow-visible"
					preserveAspectRatio="none"
				>
					<line
						x1={leftPadding}
						y1={topPadding}
						x2={leftPadding}
						y2={height - bottomPadding}
						class="stroke-border"
						vector-effect="non-scaling-stroke"
					/>
					<line
						x1={leftPadding}
						y1={height - bottomPadding}
						x2={width - rightPadding}
						y2={height - bottomPadding}
						class="stroke-border"
						vector-effect="non-scaling-stroke"
					/>
					<line
						x1={leftPadding}
						y1={topPadding + plotHeight / 2}
						x2={width - rightPadding}
						y2={topPadding + plotHeight / 2}
						class="stroke-border"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>
					<text
						x={leftPadding - 10}
						y={topPadding + 4}
						text-anchor="end"
						class="fill-muted-foreground text-[11px] tabular-nums"
					>
						{displayValue(chart.maximum)}
					</text>
					<text
						x={leftPadding - 10}
						y={height - bottomPadding + 4}
						text-anchor="end"
						class="fill-muted-foreground text-[11px] tabular-nums"
					>
						{displayValue(chart.minimum)}
					</text>
					<text
						x={leftPadding}
						y={height - 8}
						text-anchor="start"
						class="fill-muted-foreground text-[11px]"
					>
						{displayTimestamp(validPoints[0].timestamp)}
					</text>
					<text
						x={width - rightPadding}
						y={height - 8}
						text-anchor="end"
						class="fill-muted-foreground text-[11px]"
					>
						{displayTimestamp(validPoints.at(-1)?.timestamp ?? validPoints[0].timestamp)}
					</text>
					{#if chart.benchmarkPath}
						<path
							d={chart.benchmarkPath}
							fill="none"
							class="stroke-muted-foreground"
							stroke-width="1.5"
							stroke-dasharray="5 5"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
					<path
						d={chart.portfolioPath}
						fill="none"
						class="stroke-foreground"
						stroke-width="2"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
			</div>
			<details class="mt-4 border-t border-border pt-3">
				<summary
					class="min-h-10 cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				>
					View chart data
				</summary>
				<div class="mt-2 max-h-72 overflow-auto border border-border">
					<table class="w-full border-collapse text-sm">
						<caption class="sr-only">{title} values</caption>
						<thead class="sticky top-0 bg-background">
							<tr class="border-b border-border">
								<th scope="col" class="px-3 py-2 text-left font-medium">Date</th>
								<th scope="col" class="px-3 py-2 text-right font-medium">{portfolioLabel}</th>
								<th scope="col" class="px-3 py-2 text-right font-medium">{benchmarkLabel}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each validPoints as point (point.id)}
								<tr>
									<th scope="row" class="px-3 py-2 text-left font-normal"
										>{displayTimestamp(point.timestamp)}</th
									>
									<td class="px-3 py-2 text-right tabular-nums"
										>{displayValue(point.portfolioValue)}</td
									>
									<td class="px-3 py-2 text-right tabular-nums">
										{point.benchmarkValue === undefined ? '—' : displayValue(point.benchmarkValue)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</figure>
	{/if}
</section>
