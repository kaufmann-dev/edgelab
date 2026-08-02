<script lang="ts">
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import RadioTowerIcon from '@lucide/svelte/icons/radio-tower';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import WifiIcon from '@lucide/svelte/icons/wifi';
	import WifiOffIcon from '@lucide/svelte/icons/wifi-off';
	import type { MarketFeedState } from './types.js';

	interface Props {
		state: MarketFeedState;
		marketSession?: string;
		updatedLabel?: string;
		asOf?: string;
		compact?: boolean;
	}

	let { state, marketSession, updatedLabel, asOf, compact = false }: Props = $props();

	const stateLabels: Record<MarketFeedState, string> = {
		connecting: 'Connecting',
		live: 'Live',
		delayed: 'Delayed',
		stale: 'Stale',
		reconnecting: 'Reconnecting',
		offline: 'Offline'
	};

	let label = $derived(stateLabels[state]);
	let detail = $derived([marketSession, updatedLabel].filter(Boolean).join(' · '));
	let title = $derived(
		[label, detail, asOf ? `As of ${asOf}` : undefined].filter(Boolean).join('. ')
	);
	let toneClass = $derived(
		state === 'live'
			? 'border-emerald-700/30 bg-emerald-700/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300'
			: state === 'delayed' || state === 'stale'
				? 'border-amber-700/30 bg-amber-700/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300'
				: state === 'offline'
					? 'border-destructive/30 bg-destructive/10 text-destructive'
					: 'border-border bg-muted text-foreground'
	);
</script>

<div
	class={[
		'inline-flex min-w-0 items-center gap-2 rounded-none border font-medium',
		compact ? 'h-7 px-2 text-xs' : 'min-h-8 px-2.5 text-xs',
		toneClass
	]}
	role="status"
	aria-live="polite"
	{title}
>
	{#if state === 'live'}
		<WifiIcon class="size-3.5 shrink-0" aria-hidden="true" />
	{:else if state === 'delayed'}
		<Clock3Icon class="size-3.5 shrink-0" aria-hidden="true" />
	{:else if state === 'stale'}
		<TriangleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
	{:else if state === 'offline'}
		<WifiOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
	{:else if state === 'reconnecting'}
		<RefreshCwIcon class="size-3.5 shrink-0" aria-hidden="true" />
	{:else}
		<RadioTowerIcon class="size-3.5 shrink-0" aria-hidden="true" />
	{/if}
	<span class="shrink-0">{label}</span>
	{#if !compact && detail}
		<span aria-hidden="true" class="text-current/50">·</span>
		<span class="truncate font-normal">{detail}</span>
	{/if}
</div>
