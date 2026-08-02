<script lang="ts">
	import ArrowDownRightIcon from '@lucide/svelte/icons/arrow-down-right';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import type { MetricItem, ValueTone } from './types.js';

	interface Props {
		metrics: MetricItem[];
		label?: string;
		compact?: boolean;
	}

	let { metrics, label = 'Portfolio metrics', compact = false }: Props = $props();

	function toneClass(tone: ValueTone | undefined) {
		if (tone === 'positive') return 'text-emerald-700 dark:text-emerald-300';
		if (tone === 'negative') return 'text-destructive';
		if (tone === 'warning') return 'text-amber-800 dark:text-amber-300';
		if (tone === 'info') return 'text-blue-700 dark:text-blue-300';
		return 'text-foreground';
	}
</script>

<dl
	class="grid grid-cols-2 border-t border-l border-border bg-background sm:grid-cols-3 xl:grid-cols-6"
	aria-label={label}
>
	{#each metrics as metric (metric.id)}
		<div class={['min-w-0 border-r border-b border-border', compact ? 'p-3' : 'p-4']}>
			<dt class="truncate text-xs font-medium text-muted-foreground" title={metric.label}>
				{metric.label}
			</dt>
			<dd
				class={[
					'mt-1 truncate font-semibold tabular-nums',
					compact ? 'text-base' : 'text-lg',
					toneClass(metric.tone)
				]}
			>
				{metric.value}
			</dd>
			{#if metric.change}
				<p class={['mt-1 flex items-center gap-1 text-xs tabular-nums', toneClass(metric.tone)]}>
					{#if metric.direction === 'up'}
						<ArrowUpRightIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Increased by</span>
					{:else if metric.direction === 'down'}
						<ArrowDownRightIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Decreased by</span>
					{:else if metric.direction === 'flat'}
						<MinusIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">Unchanged at</span>
					{/if}
					<span>{metric.change}</span>
				</p>
			{/if}
			{#if metric.description}
				<p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{metric.description}</p>
			{/if}
		</div>
	{/each}
</dl>
