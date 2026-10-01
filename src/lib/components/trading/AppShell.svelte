<script lang="ts">
	import ChartCandlestickIcon from '@lucide/svelte/icons/chart-candlestick';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import type { Snippet } from 'svelte';
	import AppNavLink from './AppNavLink.svelte';
	import type { AppNavItem } from './types.js';

	interface Props {
		appName?: string;
		portfolioName: string;
		activeNavId: string;
		navItems: AppNavItem[];
		mobileNavItems?: AppNavItem[];
		children: Snippet;
		portfolioSwitcher?: Snippet;
		marketStatus?: Snippet;
		headerActions?: Snippet;
		contextPanel?: Snippet;
	}

	let {
		appName = 'EdgeLab',
		portfolioName,
		activeNavId,
		navItems,
		mobileNavItems = [],
		children,
		portfolioSwitcher,
		marketStatus,
		headerActions,
		contextPanel
	}: Props = $props();

	let mobileMenuOpen = $state(false);
	let bottomItems = $derived(mobileNavItems.length > 0 ? mobileNavItems : navItems.slice(0, 5));
</script>

<div class="min-h-svh bg-background text-foreground">
	<a
		href="#main-content"
		class="fixed top-2 left-2 z-50 -translate-y-20 border border-foreground bg-background px-3 py-2 text-sm font-semibold focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
	>
		Skip to content
	</a>

	<aside
		class="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-background lg:flex lg:flex-col"
	>
		<a
			href={resolve('/')}
			class="flex h-14 items-center gap-2 border-b border-border px-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
		>
			<ChartCandlestickIcon class="size-5" aria-hidden="true" />
			<span class="truncate text-sm font-semibold tracking-tight">{appName}</span>
		</a>
		<div class="border-b border-border p-3">
			{#if portfolioSwitcher}
				{@render portfolioSwitcher()}
			{:else}
				<a
					href={resolve('portfolios')}
					class="block min-h-11 border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				>
					<span class="block text-xs text-muted-foreground">Portfolio</span>
					<span class="block truncate text-sm font-medium">{portfolioName}</span>
				</a>
			{/if}
		</div>
		<nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Primary navigation">
			<ul class="space-y-1">
				{#each navItems as item (item.id)}
					<li>
						<AppNavLink
							{item}
							active={item.id === activeNavId}
							class={[
								'flex min-h-10 items-center gap-3 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
								item.id === activeNavId
									? 'bg-foreground text-background'
									: 'text-muted-foreground hover:bg-muted hover:text-foreground'
							]}
						>
							{#if item.icon}
								{@const Icon = item.icon}
								<Icon class="size-4 shrink-0" aria-hidden="true" />
							{/if}
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							{#if item.badge}
								<span
									class="border border-current/30 px-1.5 py-0.5 text-[0.625rem] leading-none tabular-nums"
								>
									{item.badge}
								</span>
							{/if}
						</AppNavLink>
					</li>
				{/each}
			</ul>
		</nav>
		<div class="border-t border-border px-3 py-2 text-xs text-muted-foreground">
			Simulation only · No real money
		</div>
	</aside>

	<div class="min-w-0 lg:pl-60">
		<header
			class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background px-3 sm:px-4 lg:px-6"
		>
			<Button
				variant="outline"
				size="icon"
				class="size-10 rounded-none shadow-none transition-none lg:hidden"
				onclick={() => (mobileMenuOpen = true)}
				aria-label="Open navigation"
			>
				<MenuIcon class="size-4" aria-hidden="true" />
			</Button>
			<div class="min-w-0 flex-1 lg:hidden">
				{#if portfolioSwitcher}
					{@render portfolioSwitcher()}
				{:else}
					<a href={resolve('portfolios')} class="block truncate text-sm font-semibold"
						>{portfolioName}</a
					>
				{/if}
			</div>
			<div class="hidden min-w-0 flex-1 lg:block">
				<p class="truncate text-sm font-medium">{portfolioName}</p>
			</div>
			{#if marketStatus}
				<div class="shrink-0">{@render marketStatus()}</div>
			{/if}
			{#if headerActions}
				<div class="flex shrink-0 items-center gap-1">{@render headerActions()}</div>
			{/if}
		</header>

		<div class={contextPanel ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_24rem]' : undefined}>
			<main id="main-content" class="min-w-0 pb-20 focus:outline-none lg:pb-0">
				{@render children()}
			</main>
			{#if contextPanel}
				<aside
					class="hidden min-h-[calc(100svh-3.5rem)] border-l border-border bg-background xl:block"
					aria-label="Trading controls"
				>
					{@render contextPanel()}
				</aside>
			{/if}
		</div>
	</div>

	{#if bottomItems.length > 0}
		<nav
			class="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
			aria-label="Mobile navigation"
		>
			<ul
				class="grid"
				style:grid-template-columns={`repeat(${bottomItems.length}, minmax(0, 1fr))`}
			>
				{#each bottomItems as item (item.id)}
					<li class="min-w-0">
						<AppNavLink
							{item}
							active={item.id === activeNavId}
							class={[
								'flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
								item.id === activeNavId ? 'bg-foreground text-background' : 'text-muted-foreground'
							]}
						>
							{#if item.icon}
								{@const Icon = item.icon}
								<Icon class="size-4" aria-hidden="true" />
							{/if}
							<span class="max-w-full truncate">{item.label}</span>
						</AppNavLink>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>

<Sheet.Root bind:open={mobileMenuOpen}>
	<Sheet.Content
		side="left"
		class="w-[min(20rem,88vw)] rounded-none bg-background p-0 shadow-none transition-none data-open:animate-none data-closed:animate-none"
	>
		<Sheet.Header class="border-b border-border px-4 py-4 text-left">
			<Sheet.Title class="flex items-center gap-2 text-sm font-semibold">
				<ChartCandlestickIcon class="size-5" aria-hidden="true" />
				{appName}
			</Sheet.Title>
			<Sheet.Description class="truncate text-xs">{portfolioName}</Sheet.Description>
		</Sheet.Header>
		<nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="All navigation">
			<ul class="space-y-1">
				{#each navItems as item (item.id)}
					<li>
						<AppNavLink
							{item}
							active={item.id === activeNavId}
							onclick={() => (mobileMenuOpen = false)}
							class={[
								'flex min-h-11 items-center gap-3 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
								item.id === activeNavId
									? 'bg-foreground text-background'
									: 'text-muted-foreground hover:bg-muted hover:text-foreground'
							]}
						>
							{#if item.icon}
								{@const Icon = item.icon}
								<Icon class="size-4" aria-hidden="true" />
							{/if}
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							{#if item.badge}<span class="text-xs tabular-nums">{item.badge}</span>{/if}
						</AppNavLink>
					</li>
				{/each}
			</ul>
		</nav>
		<p class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
			Simulation only · No real money
		</p>
	</Sheet.Content>
</Sheet.Root>
