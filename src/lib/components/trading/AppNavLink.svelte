<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { AppNavItem } from './types.js';

	interface Props {
		item: AppNavItem;
		active?: boolean;
		class?: ClassValue;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let { item, active = false, class: className, onclick, children }: Props = $props();
</script>

{#snippet content()}
	{@render children()}
{/snippet}

{#if item.params}
	<a
		href={resolve(item.route, item.params)}
		aria-current={active ? 'page' : undefined}
		class={className}
		{onclick}>{@render content()}</a
	>
{:else if item.route === '/'}
	<a href={resolve('/')} aria-current={active ? 'page' : undefined} class={className} {onclick}
		>{@render content()}</a
	>
{:else if item.route === '/portfolios'}
	<a
		href={resolve('portfolios')}
		aria-current={active ? 'page' : undefined}
		class={className}
		{onclick}>{@render content()}</a
	>
{:else if item.route === '/learn'}
	<a href={resolve('learn')} aria-current={active ? 'page' : undefined} class={className} {onclick}
		>{@render content()}</a
	>
{:else}
	<a
		href={resolve('settings')}
		aria-current={active ? 'page' : undefined}
		class={className}
		{onclick}>{@render content()}</a
	>
{/if}
