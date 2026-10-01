<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MarketFeedStatus, MetricStrip, PositionsTable } from '#lib/components/trading/index.js';
	import type { PositionRow } from '#lib/components/trading/index.js';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let marketsRoute = $derived(
		resolve('/p/[portfolioId]/markets', { portfolioId: data.portfolio.id })
	);
	let marksIncomplete = $derived(data.positions.some((position) => position.mark === null));
	let displayedMetrics = $derived(
		marksIncomplete
			? data.metrics.map((metric) =>
					metric.id === 'equity'
						? {
								...metric,
								value: '—',
								description: 'Unavailable until every open position has a provider mark'
							}
						: metric
				)
			: data.metrics
	);

	const marketTime = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatMarketTime(timestamp: string): string {
		const value = new Date(timestamp);
		return Number.isNaN(value.valueOf()) ? timestamp : marketTime.format(value);
	}

	function tradePosition(position: PositionRow): void {
		void goto(
			resolve(`/p/[portfolioId]/trade?symbol=${encodeURIComponent(position.symbol)}`, {
				portfolioId: data.portfolio.id
			})
		);
	}
</script>

<svelte:head><title>Positions · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-[100rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
	<header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div class="min-w-0">
			<h1 class="text-2xl font-semibold tracking-tight">Positions</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
				Open stock and option exposure with provider marks and realized context.
			</p>
		</div>
		{#if data.marketFeed}
			<MarketFeedStatus
				state={data.marketFeed.state}
				marketSession={data.marketFeed.modeLabel}
				updatedLabel={formatMarketTime(data.marketFeed.asOf)}
				asOf={data.marketFeed.asOf}
			/>
		{/if}
	</header>

	{#if data.marketError}
		<Alert variant="destructive" class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Market marks unavailable</AlertTitle>
			<AlertDescription>{data.marketError}</AlertDescription>
		</Alert>
	{:else if marksIncomplete}
		<Alert class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Some market marks unavailable</AlertTitle>
			<AlertDescription>
				Portfolio equity is withheld until every open position has a provider mark.
			</AlertDescription>
		</Alert>
	{/if}

	<MetricStrip metrics={displayedMetrics} />

	<PositionsTable
		positions={data.positions}
		onTrade={tradePosition}
		emptyActionLabel="Research a symbol"
		emptyActionHref={marketsRoute}
	/>
</div>
