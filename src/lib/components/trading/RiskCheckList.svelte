<script lang="ts">
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ShieldXIcon from '@lucide/svelte/icons/shield-x';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { RiskCheck, RiskCheckStatus } from './types.js';

	interface Props {
		checks: RiskCheck[];
		title?: string;
		compact?: boolean;
		showSummary?: boolean;
	}

	let { checks, title = 'Risk checks', compact = false, showSummary = true }: Props = $props();

	const uid = $props.id();
	let blockedCount = $derived(checks.filter((check) => check.status === 'blocked').length);
	let warningCount = $derived(checks.filter((check) => check.status === 'warning').length);
	let summary = $derived(
		blockedCount > 0
			? `${blockedCount} blocked`
			: warningCount > 0
				? `${warningCount} warning${warningCount === 1 ? '' : 's'}`
				: 'All checks passed'
	);

	function statusLabel(status: RiskCheckStatus) {
		if (status === 'pass') return 'Pass';
		if (status === 'warning') return 'Warning';
		return 'Blocked';
	}

	function statusClass(status: RiskCheckStatus) {
		if (status === 'pass') return 'text-emerald-700 dark:text-emerald-300';
		if (status === 'warning') return 'text-amber-800 dark:text-amber-300';
		return 'text-destructive';
	}
</script>

<section class="border border-border bg-background" aria-labelledby={`${uid}-title`}>
	<header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
		<h2 id={`${uid}-title`} class="text-sm font-semibold">{title}</h2>
		{#if showSummary}
			<Badge
				variant="outline"
				class={[
					'rounded-none shadow-none',
					blockedCount > 0
						? 'text-destructive'
						: warningCount > 0
							? 'text-amber-800 dark:text-amber-300'
							: 'text-emerald-700 dark:text-emerald-300'
				]}
			>
				{summary}
			</Badge>
		{/if}
	</header>
	<ul class="divide-y divide-border" aria-label={summary}>
		{#each checks as check (check.id)}
			<li
				class={['grid grid-cols-[auto_minmax(0,1fr)] gap-3', compact ? 'px-3 py-2.5' : 'px-4 py-3']}
			>
				<span class={['mt-0.5', statusClass(check.status)]}>
					{#if check.status === 'pass'}
						<CheckCircle2Icon class="size-4" aria-hidden="true" />
					{:else if check.status === 'warning'}
						<CircleAlertIcon class="size-4" aria-hidden="true" />
					{:else}
						<ShieldXIcon class="size-4" aria-hidden="true" />
					{/if}
					<span class="sr-only">{statusLabel(check.status)}:</span>
				</span>
				<div class="min-w-0">
					<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
						<p class="text-sm font-medium">{check.label}</p>
						{#if check.currentValue || check.limitValue}
							<p class="text-xs text-muted-foreground tabular-nums">
								{check.currentValue ?? '—'}
								{#if check.limitValue}<span aria-hidden="true"> / </span><span class="sr-only"
										>of limit
									</span>{check.limitValue}{/if}
							</p>
						{/if}
					</div>
					<p class="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
				</div>
			</li>
		{/each}
	</ul>
</section>
