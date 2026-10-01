<script lang="ts">
	import CircleSlashIcon from '@lucide/svelte/icons/circle-slash';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { TradingIcon } from './types.js';

	interface Props {
		title: string;
		description?: string;
		icon?: TradingIcon;
		actionLabel?: string;
		actionHref?: string;
		onAction?: () => void;
		secondaryActionLabel?: string;
		secondaryActionHref?: string;
		onSecondaryAction?: () => void;
		compact?: boolean;
	}

	let {
		title,
		description,
		icon: Icon = CircleSlashIcon,
		actionLabel,
		actionHref,
		onAction,
		secondaryActionLabel,
		secondaryActionHref,
		onSecondaryAction,
		compact = false
	}: Props = $props();

	const uid = $props.id();
</script>

<section
	class={[
		'flex flex-col items-center justify-center border border-dashed border-border bg-background text-center',
		compact ? 'min-h-44 px-4 py-8' : 'min-h-64 px-6 py-12'
	]}
	aria-labelledby={`${uid}-title`}
>
	<Icon class="size-6 text-muted-foreground" aria-hidden="true" />
	<h2 id={`${uid}-title`} class="mt-4 text-base font-semibold text-foreground">{title}</h2>
	{#if description}
		<p class="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
	{/if}
	{#if actionLabel || secondaryActionLabel}
		<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
			{#if actionLabel}
				<Button
					href={actionHref}
					onclick={onAction}
					class="h-10 rounded-none px-4 shadow-none transition-none"
				>
					{actionLabel}
				</Button>
			{/if}
			{#if secondaryActionLabel}
				<Button
					href={secondaryActionHref}
					onclick={onSecondaryAction}
					variant="outline"
					class="h-10 rounded-none px-4 shadow-none transition-none"
				>
					{secondaryActionLabel}
				</Button>
			{/if}
		</div>
	{/if}
</section>
