<script lang="ts">
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import BriefcaseBusinessIcon from '@lucide/svelte/icons/briefcase-business';
	import ChartCandlestickIcon from '@lucide/svelte/icons/chart-candlestick';
	import ChartNoAxesCombinedIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import ChartSplineIcon from '@lucide/svelte/icons/chart-spline';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import WalletCardsIcon from '@lucide/svelte/icons/wallet-cards';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { AppHeaderActions } from '$lib/components/app/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { AppShell, MarketFeedStatus } from '$lib/components/trading/index.js';
	import type { AppNavItem, MarketFeedState } from '$lib/components/trading/types.js';
	import { ModeWatcher } from 'mode-watcher';
	import type { LayoutProps } from './$types';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	interface PortfolioContext {
		id: string;
		name: string;
	}

	interface MarketFeedContext {
		state: MarketFeedState;
		modeLabel: string;
		asOf: string;
	}

	type ShellPageData = typeof page.data & {
		portfolio?: PortfolioContext | null;
		marketFeed?: MarketFeedContext | null;
	};

	let { data, children }: LayoutProps = $props();

	const globalNavItems: AppNavItem[] = [
		{ id: 'portfolios', label: 'Portfolios', route: '/portfolios', icon: WalletCardsIcon },
		{ id: 'learn', label: 'Learn', route: '/learn', icon: BookOpenIcon },
		{ id: 'settings', label: 'Settings', route: '/settings', icon: SettingsIcon }
	];

	let shellData = $derived(page.data as ShellPageData);
	let portfolio = $derived(shellData.portfolio ?? null);
	let marketFeed = $derived(shellData.marketFeed ?? null);

	function resolveGlobalRoute(route: Extract<AppNavItem, { params?: never }>['route']) {
		switch (route) {
			case '/':
				return resolve('/');
			case '/portfolios':
				return resolve('/portfolios');
			case '/learn':
				return resolve('/learn');
			case '/settings':
				return resolve('/settings');
		}
	}

	let navItems = $derived.by<AppNavItem[]>(() => {
		if (!portfolio) return globalNavItems;

		const params = { portfolioId: portfolio.id };
		return [
			{
				id: 'overview',
				label: 'Overview',
				route: '/p/[portfolioId]/overview',
				params,
				icon: LayoutDashboardIcon
			},
			{
				id: 'markets',
				label: 'Markets',
				route: '/p/[portfolioId]/markets',
				params,
				icon: ChartNoAxesCombinedIcon
			},
			{
				id: 'trade',
				label: 'Trade',
				route: '/p/[portfolioId]/trade',
				params,
				icon: ChartCandlestickIcon
			},
			{
				id: 'positions',
				label: 'Positions',
				route: '/p/[portfolioId]/positions',
				params,
				icon: BriefcaseBusinessIcon
			},
			{
				id: 'orders',
				label: 'Orders',
				route: '/p/[portfolioId]/orders',
				params,
				icon: ListOrderedIcon
			},
			{
				id: 'activity',
				label: 'Activity',
				route: '/p/[portfolioId]/activity',
				params,
				icon: HistoryIcon
			},
			{
				id: 'analytics',
				label: 'Analytics',
				route: '/p/[portfolioId]/analytics',
				params,
				icon: ChartSplineIcon
			},
			{
				id: 'journal',
				label: 'Journal',
				route: '/p/[portfolioId]/journal',
				params,
				icon: NotebookPenIcon
			},
			{ id: 'learn', label: 'Learn', route: '/learn', icon: BookOpenIcon },
			{ id: 'settings', label: 'Settings', route: '/settings', icon: SettingsIcon }
		];
	});
	let mobileNavItems = $derived(
		portfolio
			? navItems.filter((item) =>
					['overview', 'markets', 'trade', 'positions', 'orders'].includes(item.id)
				)
			: globalNavItems
	);
	let searchHref = $derived(
		portfolio
			? `${resolve('/p/[portfolioId]/markets', { portfolioId: portfolio.id })}#market-search`
			: undefined
	);
	let activeNavId = $derived.by(() => {
		const pathname = page.url.pathname;
		const match = navItems.find((item) => {
			const href = item.params ? resolve(item.route, item.params) : resolveGlobalRoute(item.route);
			return pathname === href || pathname.startsWith(`${href}/`);
		});
		return match?.id ?? '';
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if data.user}
	<ModeWatcher disableTransitions />
	<Tooltip.Provider delayDuration={250}>
		<AppShell
			portfolioName={portfolio?.name ?? 'Portfolios'}
			{activeNavId}
			{navItems}
			{mobileNavItems}
		>
			{#snippet portfolioSwitcher()}
				<a
					href={resolve('/portfolios')}
					class="flex min-h-11 min-w-0 items-center gap-2 border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					aria-label={portfolio
						? `Change portfolio. Current portfolio: ${portfolio.name}`
						: 'Choose a portfolio'}
				>
					<span class="min-w-0 flex-1">
						<span class="block text-xs text-muted-foreground">Portfolio</span>
						<span class="block truncate text-sm font-medium">
							{portfolio?.name ?? 'Choose a portfolio'}
						</span>
					</span>
					<ChevronsUpDownIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				</a>
			{/snippet}

			{#snippet marketStatus()}
				{#if marketFeed}
					<MarketFeedStatus
						state={marketFeed.state}
						marketSession={marketFeed.modeLabel}
						asOf={marketFeed.asOf}
						compact
					/>
				{/if}
			{/snippet}

			{#snippet headerActions()}
				{#if data.user}<AppHeaderActions user={data.user} {searchHref} />{/if}
			{/snippet}

			{@render children()}
		</AppShell>
	</Tooltip.Provider>
	<Toaster position="bottom-right" closeButton />
{:else}
	{@render children()}
{/if}
