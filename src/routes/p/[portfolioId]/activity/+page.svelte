<script lang="ts">
	import CircleDollarSignIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import ListTreeIcon from '@lucide/svelte/icons/list-tree';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { EmptyState } from '$lib/components/trading';
	import { Badge } from '$lib/components/ui/badge';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const timestamp = new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
	const signedMoney = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 2,
		signDisplay: 'exceptZero'
	});

	function kindLabel(kind: 'order' | 'fill' | 'cash'): string {
		if (kind === 'fill') return 'Fill';
		if (kind === 'cash') return 'Cash';
		return 'Order';
	}

	function displayAmount(amount: string): string {
		const value = Number(amount);
		return Number.isFinite(value) ? signedMoney.format(value) : amount;
	}

	function amountTone(amount: string): string {
		const value = Number(amount);
		if (value > 0) return 'text-positive';
		if (value < 0) return 'text-destructive';
		return 'text-foreground';
	}
</script>

<svelte:head><title>Activity · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
	<header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Activity</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
				A server-recorded chronology of orders, fills, and cash movements.
			</p>
		</div>
		<p class="text-xs text-muted-foreground tabular-nums">
			{data.activity.length}
			{data.activity.length === 1 ? 'event' : 'events'}
		</p>
	</header>

	{#if data.activity.length === 0}
		<EmptyState
			title="No activity yet"
			description="Order changes, fills, and cash ledger entries will appear here as the simulation runs."
			icon={ListTreeIcon}
		/>
	{:else}
		<section class="border border-border bg-background" aria-labelledby="activity-log-title">
			<header class="border-b border-border px-4 py-3 sm:px-5">
				<h2 id="activity-log-title" class="text-sm font-semibold">Activity log</h2>
				<p class="mt-0.5 text-xs text-muted-foreground">Newest events first</p>
			</header>

			<ol class="divide-y divide-border">
				{#each data.activity as entry (`${entry.kind}:${entry.id}`)}
					<li>
						<article class="grid gap-3 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:px-5">
							<div
								class="hidden size-8 place-items-center border border-border text-muted-foreground sm:grid"
								aria-hidden="true"
							>
								{#if entry.kind === 'fill'}
									<ShieldCheckIcon class="size-4" />
								{:else if entry.kind === 'cash'}
									<CircleDollarSignIcon class="size-4" />
								{:else}
									<ReceiptTextIcon class="size-4" />
								{/if}
							</div>

							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="text-sm font-medium">{entry.title}</h3>
									<Badge variant="outline" class="rounded-none">{kindLabel(entry.kind)}</Badge>
								</div>
								{#if entry.detail}
									<p class="mt-1 text-sm break-words text-muted-foreground">{entry.detail}</p>
								{/if}
							</div>

							<div class="flex items-start justify-between gap-4 sm:block sm:text-right">
								<time
									datetime={entry.at.toISOString()}
									class="text-xs whitespace-nowrap text-muted-foreground"
								>
									{timestamp.format(entry.at)}
								</time>
								{#if entry.amount !== null}
									<p class={['mt-1 text-sm font-semibold tabular-nums', amountTone(entry.amount)]}>
										{displayAmount(entry.amount)}
									</p>
								{/if}
							</div>
						</article>
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>
