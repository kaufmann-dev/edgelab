<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { resolve } from '$app/paths';
	import {
		EquityCurveChart,
		MarketFeedStatus,
		MetricStrip,
		OrdersTable,
		PositionsTable
	} from '#lib/components/trading/index.js';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let positionsRoute = $derived(
		resolve('/p/[portfolioId]/positions', { portfolioId: data.portfolio.id })
	);
	let ordersRoute = $derived(
		resolve('/p/[portfolioId]/orders', { portfolioId: data.portfolio.id })
	);
	let marketsRoute = $derived(
		resolve('/p/[portfolioId]/markets', { portfolioId: data.portfolio.id })
	);
	let tradeRoute = $derived(resolve('/p/[portfolioId]/trade', { portfolioId: data.portfolio.id }));
	let valuationCountLabel = $derived(
		`${data.equityCurve.length} recorded ${data.equityCurve.length === 1 ? 'valuation' : 'valuations'}`
	);
	let marksIncomplete = $derived(
		data.marketError !== null ||
			data.metrics.some(
				(metric) =>
					(metric.id === 'market-value' || metric.id === 'unrealized') && metric.value === '—'
			)
	);
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
</script>

{#snippet positionActions()}
	<Button
		href={positionsRoute}
		variant="ghost"
		size="sm"
		class="rounded-none shadow-none transition-none"
	>
		View all
		<ArrowRightIcon aria-hidden="true" />
	</Button>
{/snippet}

{#snippet orderActions()}
	<Button
		href={ordersRoute}
		variant="ghost"
		size="sm"
		class="rounded-none shadow-none transition-none"
	>
		View all
		<ArrowRightIcon aria-hidden="true" />
	</Button>
{/snippet}

<svelte:head><title>Portfolio overview · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-[100rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
	<header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div class="min-w-0">
			<h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
				Performance, exposure, and recent execution for this portfolio.
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

	<EquityCurveChart
		points={data.equityCurve}
		title="Portfolio value"
		rangeLabel={valuationCountLabel}
	/>

	<PositionsTable
		positions={data.positions}
		label="Open positions"
		headerActions={positionActions}
		emptyActionLabel="Research a symbol"
		emptyActionHref={marketsRoute}
	/>

	<OrdersTable
		orders={data.orders}
		label="Recent orders"
		headerActions={orderActions}
		emptyActionLabel="Open an order ticket"
		emptyActionHref={tradeRoute}
	/>
</div>
