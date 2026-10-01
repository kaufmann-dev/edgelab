<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import type { Snippet } from 'svelte';
	import EmptyState from './EmptyState.svelte';
	import { formatPercent, humanize, signedCurrency, toneForNumber } from './format.js';
	import type {
		DataError,
		PositionRow,
		PositionSortKey,
		SortDirection,
		SortState
	} from './types.js';

	interface Props {
		positions: PositionRow[];
		label?: string;
		currency?: string;
		locale?: string;
		loading?: boolean;
		error?: DataError;
		sort?: SortState<PositionSortKey>;
		onSort?: (key: PositionSortKey) => void;
		onOpen?: (position: PositionRow) => void;
		onTrade?: (position: PositionRow) => void;
		onClose?: (position: PositionRow) => void;
		headerActions?: Snippet;
		emptyTitle?: string;
		emptyDescription?: string;
		emptyActionLabel?: string;
		emptyActionHref?: string;
		onEmptyAction?: () => void;
	}

	let {
		positions,
		label = 'Positions',
		currency = 'USD',
		locale = 'en-US',
		loading = false,
		error,
		sort,
		onSort,
		onOpen,
		onTrade,
		onClose,
		headerActions,
		emptyTitle = 'No open positions',
		emptyDescription = 'Positions will appear here after an order receives its first fill.',
		emptyActionLabel,
		emptyActionHref,
		onEmptyAction
	}: Props = $props();

	const uid = $props.id();
	const loadingRows = ['position-loading-1', 'position-loading-2', 'position-loading-3'];
	const loadingColumns = [
		'symbol',
		'position',
		'quantity',
		'cost',
		'mark',
		'value',
		'day',
		'unrealized',
		'return',
		'weight',
		'actions'
	];
	let money = $derived(
		new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			maximumFractionDigits: 2
		})
	);
	let quantity = $derived(
		new Intl.NumberFormat(locale, {
			maximumFractionDigits: 4
		})
	);

	function ariaSort(key: PositionSortKey): SortDirection | 'none' {
		return sort?.key === key ? sort.direction : 'none';
	}

	function displayMoney(value: number | null) {
		return value === null ? '—' : money.format(value);
	}

	function displaySignedMoney(value: number | null) {
		return value === null ? '—' : signedCurrency(money, value);
	}

	function displayPercent(value: number | null, signed = false) {
		return value === null ? '—' : formatPercent(value, 2, signed);
	}

	function nullableTone(value: number | null) {
		return value === null ? 'text-muted-foreground' : toneForNumber(value);
	}
</script>

{#snippet sortableHeader(key: PositionSortKey, text: string, align: 'left' | 'right' = 'right')}
	<Table.Head
		scope="col"
		aria-sort={ariaSort(key)}
		class={align === 'right' ? 'px-3 text-right' : 'px-3 text-left'}
	>
		{#if onSort}
			<button
				type="button"
				onclick={() => onSort?.(key)}
				class={[
					'inline-flex min-h-8 items-center gap-1.5 font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
					align === 'right' && 'justify-end'
				]}
			>
				{text}
				{#if sort?.key === key && sort.direction === 'ascending'}
					<ArrowUpIcon class="size-3.5" aria-hidden="true" />
				{:else if sort?.key === key && sort.direction === 'descending'}
					<ArrowDownIcon class="size-3.5" aria-hidden="true" />
				{:else}
					<ArrowUpDownIcon class="size-3.5 text-muted-foreground" aria-hidden="true" />
				{/if}
			</button>
		{:else}
			{text}
		{/if}
	</Table.Head>
{/snippet}

<section class="border border-border bg-background" aria-labelledby={`${uid}-heading`}>
	<header
		class="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"
	>
		<div class="min-w-0">
			<h2 id={`${uid}-heading`} class="text-sm font-semibold">{label}</h2>
			{#if !loading && !error}
				<p class="text-xs text-muted-foreground">
					{positions.length} open {positions.length === 1 ? 'position' : 'positions'}
				</p>
			{/if}
		</div>
		{#if headerActions}<div class="flex items-center gap-2">{@render headerActions()}</div>{/if}
	</header>

	{#if error}
		<div class="p-4">
			<Alert variant="destructive" class="rounded-none shadow-none">
				<RefreshCwIcon aria-hidden="true" />
				<AlertTitle>Positions unavailable</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
				{#if error.onRetry}
					<Button
						variant="outline"
						size="sm"
						class="mt-3 rounded-none shadow-none transition-none"
						onclick={error.onRetry}
					>
						Retry
					</Button>
				{/if}
			</Alert>
		</div>
	{:else if !loading && positions.length === 0}
		<div class="p-4">
			<EmptyState
				title={emptyTitle}
				description={emptyDescription}
				actionLabel={emptyActionLabel}
				actionHref={emptyActionHref}
				onAction={onEmptyAction}
				compact
			/>
		</div>
	{:else}
		<div class="hidden md:block">
			<Table.Root>
				<Table.Caption class="sr-only">{label}. Values update with market data.</Table.Caption>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						{@render sortableHeader('symbol', 'Symbol', 'left')}
						<Table.Head scope="col" class="px-3">Position</Table.Head>
						{@render sortableHeader('quantity', 'Quantity')}
						{@render sortableHeader('averageCost', 'Avg. cost')}
						{@render sortableHeader('mark', 'Mark')}
						{@render sortableHeader('marketValue', 'Market value')}
						{@render sortableHeader('dayPnl', 'Today')}
						{@render sortableHeader('unrealizedPnl', 'Unrealized')}
						{@render sortableHeader('totalReturnPercent', 'Return')}
						{@render sortableHeader('portfolioWeightPercent', 'Weight')}
						<Table.Head scope="col" class="px-3 text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if loading}
						{#each loadingRows as rowId (rowId)}
							<Table.Row>
								{#each loadingColumns as columnId (`${rowId}-${columnId}`)}
									<Table.Cell class="px-3 py-3"
										><Skeleton class="h-4 w-full rounded-none" /></Table.Cell
									>
								{/each}
							</Table.Row>
						{/each}
					{:else}
						{#each positions as position (position.id)}
							<Table.Row>
								<Table.Cell class="max-w-52 px-3 py-3">
									{#if onOpen}
										<button
											type="button"
											class="block max-w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
											onclick={() => onOpen?.(position)}
										>
											<span class="block truncate font-semibold">{position.symbol}</span>
											{#if position.name}<span class="block truncate text-xs text-muted-foreground"
													>{position.name}</span
												>{/if}
										</button>
									{:else}
										<span class="block truncate font-semibold">{position.symbol}</span>
										{#if position.name}<span class="block truncate text-xs text-muted-foreground"
												>{position.name}</span
											>{/if}
									{/if}
								</Table.Cell>
								<Table.Cell class="px-3 py-3">
									<div class="flex flex-wrap gap-1">
										<Badge variant="outline" class="rounded-none">{humanize(position.side)}</Badge>
										<Badge variant="secondary" class="rounded-none"
											>{humanize(position.assetType)}</Badge
										>
									</div>
									{#if position.strategy}<p
											class="mt-1 max-w-36 truncate text-xs text-muted-foreground"
										>
											{position.strategy}
										</p>{/if}
									{#if position.daysToExpiration !== undefined}<p
											class="mt-1 text-xs text-muted-foreground"
										>
											{position.daysToExpiration} DTE
										</p>{/if}
								</Table.Cell>
								<Table.Cell class="px-3 py-3 text-right tabular-nums"
									>{quantity.format(position.quantity)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3 text-right tabular-nums"
									>{money.format(position.averageCost)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3 text-right tabular-nums"
									>{displayMoney(position.mark)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3 text-right font-medium tabular-nums"
									>{displayMoney(position.marketValue)}</Table.Cell
								>
								<Table.Cell
									class={['px-3 py-3 text-right tabular-nums', nullableTone(position.dayPnl)]}
									>{displaySignedMoney(position.dayPnl)}</Table.Cell
								>
								<Table.Cell
									class={[
										'px-3 py-3 text-right tabular-nums',
										nullableTone(position.unrealizedPnl)
									]}>{displaySignedMoney(position.unrealizedPnl)}</Table.Cell
								>
								<Table.Cell
									class={[
										'px-3 py-3 text-right tabular-nums',
										nullableTone(position.totalReturnPercent)
									]}>{displayPercent(position.totalReturnPercent, true)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3 text-right tabular-nums"
									>{displayPercent(position.portfolioWeightPercent)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3">
									<div class="flex justify-end gap-1">
										{#if onTrade}<Button
												variant="outline"
												size="sm"
												class="rounded-none shadow-none transition-none"
												onclick={() => onTrade?.(position)}>Trade</Button
											>{/if}
										{#if onClose}<Button
												variant="ghost"
												size="sm"
												class="rounded-none shadow-none transition-none"
												onclick={() => onClose?.(position)}>Close</Button
											>{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>

		<div class="md:hidden">
			{#if loading}
				<ul class="divide-y divide-border" aria-label="Loading positions">
					{#each loadingRows as rowId (rowId)}
						<li class="space-y-3 p-4">
							<Skeleton class="h-5 w-24 rounded-none" /><Skeleton
								class="h-16 w-full rounded-none"
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<ul class="divide-y divide-border" aria-label={label}>
					{#each positions as position (position.id)}
						<li>
							<article class="p-4">
								<header class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<h3 class="truncate text-sm font-semibold">{position.symbol}</h3>
										<p class="truncate text-xs text-muted-foreground">
											{position.strategy ?? position.name ?? humanize(position.assetType)}
										</p>
									</div>
									<div class="flex shrink-0 gap-1">
										<Badge variant="outline" class="rounded-none">{humanize(position.side)}</Badge>
									</div>
								</header>
								<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
									<div>
										<dt class="text-xs text-muted-foreground">Quantity</dt>
										<dd class="mt-0.5 tabular-nums">{quantity.format(position.quantity)}</dd>
									</div>
									<div class="text-right">
										<dt class="text-xs text-muted-foreground">Mark</dt>
										<dd class="mt-0.5 tabular-nums">{displayMoney(position.mark)}</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Market value</dt>
										<dd class="mt-0.5 font-medium tabular-nums">
											{displayMoney(position.marketValue)}
										</dd>
									</div>
									<div class="text-right">
										<dt class="text-xs text-muted-foreground">Today</dt>
										<dd class={['mt-0.5 tabular-nums', nullableTone(position.dayPnl)]}>
											{displaySignedMoney(position.dayPnl)}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Unrealized</dt>
										<dd class={['mt-0.5 tabular-nums', nullableTone(position.unrealizedPnl)]}>
											{displaySignedMoney(position.unrealizedPnl)}
										</dd>
									</div>
									<div class="text-right">
										<dt class="text-xs text-muted-foreground">Weight</dt>
										<dd class="mt-0.5 tabular-nums">
											{displayPercent(position.portfolioWeightPercent)}
										</dd>
									</div>
								</dl>
								{#if onOpen || onTrade || onClose}
									<div class="mt-4 flex gap-2 border-t border-border pt-3">
										{#if onOpen}<Button
												variant="ghost"
												class="h-10 flex-1 rounded-none shadow-none transition-none"
												onclick={() => onOpen?.(position)}>Details</Button
											>{/if}
										{#if onTrade}<Button
												variant="outline"
												class="h-10 flex-1 rounded-none shadow-none transition-none"
												onclick={() => onTrade?.(position)}>Trade</Button
											>{/if}
										{#if onClose}<Button
												variant="ghost"
												class="h-10 flex-1 rounded-none shadow-none transition-none"
												onclick={() => onClose?.(position)}>Close</Button
											>{/if}
									</div>
								{/if}
							</article>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>
