<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChartCandlestickIcon from '@lucide/svelte/icons/chart-candlestick';
	import CircleDollarSignIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { resolve } from '$app/paths';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let activePortfolios = $derived(
		data.portfolios.filter((portfolio) => portfolio.status === 'active')
	);
	let archivedPortfolios = $derived(
		data.portfolios.filter((portfolio) => portfolio.status === 'archived')
	);

	const currency = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});
	const date = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});

	function dataModeLabel(mode: string): string {
		if (mode === 'realtime') return 'Real-time';
		return 'Delayed';
	}
</script>

<svelte:head>
	<title>Portfolios · EdgeLab</title>
	<meta
		name="description"
		content="Choose or create an isolated paper-trading portfolio in EdgeLab."
	/>
</svelte:head>

<main class="min-h-svh bg-background text-foreground">
	<header class="border-b border-border">
		<div class="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
			<a href={resolve('/')} class="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
				<ChartCandlestickIcon class="size-5 shrink-0" aria-hidden="true" />
				<span class="truncate">EdgeLab</span>
			</a>
			<span class="text-xs text-muted-foreground">Simulation only · No real money</span>
		</div>
	</header>

	<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
		<div
			class="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between"
		>
			<div>
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Choose a portfolio</h1>
				<p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
					Each portfolio keeps its own capital, orders, positions, and trading history.
				</p>
			</div>
			<Button
				href={resolve('/portfolios/new')}
				class="h-11 rounded-none px-4 shadow-none transition-none"
			>
				<PlusIcon class="size-4" aria-hidden="true" />
				New portfolio
			</Button>
		</div>

		{#if form?.archiveError}
			<Alert.Root variant="destructive" class="mt-6 rounded-none shadow-none">
				<ArchiveIcon class="size-4" aria-hidden="true" />
				<Alert.Title>Portfolio not archived</Alert.Title>
				<Alert.Description>{form.archiveError}</Alert.Description>
			</Alert.Root>
		{:else if form?.archivedPortfolioId}
			<Alert.Root class="mt-6 rounded-none bg-positive/5 text-positive shadow-none">
				<ShieldCheckIcon class="size-4" aria-hidden="true" />
				<Alert.Title>Portfolio archived</Alert.Title>
				<Alert.Description>Its trading history remains available in this chooser.</Alert.Description
				>
			</Alert.Root>
		{/if}

		<section class="mt-8" aria-labelledby="active-portfolios-title">
			<div class="mb-4 flex items-center justify-between gap-4">
				<h2 id="active-portfolios-title" class="text-sm font-semibold">Active portfolios</h2>
				<span class="text-xs text-muted-foreground tabular-nums"
					>{activePortfolios.length} active</span
				>
			</div>

			{#if activePortfolios.length === 0}
				<div
					class="grid min-h-64 place-items-center border border-dashed border-border px-5 py-10 text-center"
				>
					<div class="max-w-md">
						<CircleDollarSignIcon class="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
						<h2 class="mt-4 text-lg font-semibold">Create your first simulation</h2>
						<p class="mt-2 text-sm leading-6 text-muted-foreground">
							Set the starting capital and data mode, then practice without putting real money at
							risk.
						</p>
						<Button
							href={resolve('/portfolios/new')}
							class="mt-5 h-11 rounded-none px-4 shadow-none transition-none"
						>
							<PlusIcon class="size-4" aria-hidden="true" />
							Create portfolio
						</Button>
					</div>
				</div>
			{:else}
				<ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{#each activePortfolios as portfolio (portfolio.id)}
						<li class="min-w-0 border border-border bg-card">
							<div class="flex min-h-full flex-col">
								<div class="flex items-start justify-between gap-3 border-b border-border p-5">
									<div class="min-w-0">
										<h3 class="truncate text-base font-semibold" title={portfolio.name}>
											{portfolio.name}
										</h3>
										<p class="mt-1 text-xs text-muted-foreground">
											Created {date.format(portfolio.createdAt)}
										</p>
									</div>
									<Badge variant="outline" class="rounded-none"
										>{dataModeLabel(portfolio.dataMode)}</Badge
									>
								</div>

								<dl class="grid flex-1 grid-cols-2 gap-px bg-border">
									<div class="bg-card p-4">
										<dt class="text-xs text-muted-foreground">Starting capital</dt>
										<dd class="mt-1 truncate text-sm font-semibold tabular-nums">
											{currency.format(Number(portfolio.startingCash))}
										</dd>
									</div>
									<div class="bg-card p-4">
										<dt class="text-xs text-muted-foreground">Currency</dt>
										<dd class="mt-1 text-sm font-semibold">{portfolio.baseCurrency}</dd>
									</div>
								</dl>

								<div class="flex items-center justify-between gap-3 border-t border-border p-3">
									<form method="POST" action="?/archive">
										<input type="hidden" name="portfolioId" value={portfolio.id} />
										<Button
											type="submit"
											variant="ghost"
											disabled={activePortfolios.length === 1}
											title={activePortfolios.length === 1
												? 'Create another portfolio before archiving this one'
												: 'Archive portfolio'}
											class="h-10 rounded-none px-3 text-muted-foreground shadow-none transition-none"
										>
											<ArchiveIcon class="size-4" aria-hidden="true" />
											Archive
										</Button>
									</form>
									<Button
										href={resolve('/p/[portfolioId]/overview', {
											portfolioId: portfolio.id
										})}
										class="h-10 rounded-none px-3 shadow-none transition-none"
									>
										Open
										<ArrowRightIcon class="size-4" aria-hidden="true" />
									</Button>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if archivedPortfolios.length > 0}
			<details class="mt-10 border-t border-border pt-5">
				<summary class="min-h-11 cursor-pointer py-3 text-sm font-semibold">
					Archived portfolios ({archivedPortfolios.length})
				</summary>
				<ul class="mt-3 divide-y divide-border border border-border">
					{#each archivedPortfolios as portfolio (portfolio.id)}
						<li class="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{portfolio.name}</p>
								<p class="mt-1 text-xs text-muted-foreground">
									Started with {currency.format(Number(portfolio.startingCash))}
								</p>
							</div>
							<p class="text-xs text-muted-foreground">
								Archived {portfolio.archivedAt ? date.format(portfolio.archivedAt) : '—'}
							</p>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>
</main>
