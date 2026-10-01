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
	import { humanize } from './format.js';
	import type {
		DataError,
		OrderRow,
		OrderSortKey,
		OrderStatus,
		SortDirection,
		SortState
	} from './types.js';

	interface Props {
		orders: OrderRow[];
		label?: string;
		currency?: string;
		locale?: string;
		loading?: boolean;
		error?: DataError;
		sort?: SortState<OrderSortKey>;
		onSort?: (key: OrderSortKey) => void;
		onOpen?: (order: OrderRow) => void;
		onEdit?: (order: OrderRow) => void;
		onCancel?: (order: OrderRow) => void;
		pendingOrderId?: string;
		headerActions?: Snippet;
		emptyTitle?: string;
		emptyDescription?: string;
		emptyActionLabel?: string;
		emptyActionHref?: string;
		onEmptyAction?: () => void;
	}

	let {
		orders,
		label = 'Orders',
		currency = 'USD',
		locale = 'en-US',
		loading = false,
		error,
		sort,
		onSort,
		onOpen,
		onEdit,
		onCancel,
		pendingOrderId,
		headerActions,
		emptyTitle = 'No orders',
		emptyDescription = 'Submitted simulated orders will appear here.',
		emptyActionLabel,
		emptyActionHref,
		onEmptyAction
	}: Props = $props();

	const uid = $props.id();
	const loadingRows = ['order-loading-1', 'order-loading-2', 'order-loading-3'];
	const loadingColumns = [
		'submitted',
		'symbol',
		'side',
		'quantity',
		'type',
		'duration',
		'status',
		'fill',
		'actions'
	];
	let money = $derived(
		new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			maximumFractionDigits: 2
		})
	);
	let quantityFormatter = $derived(
		new Intl.NumberFormat(locale, {
			maximumFractionDigits: 4
		})
	);
	let dateFormatter = $derived(
		new Intl.DateTimeFormat(locale, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		})
	);

	function ariaSort(key: OrderSortKey): SortDirection | 'none' {
		return sort?.key === key ? sort.direction : 'none';
	}

	function displayDate(timestamp: string) {
		const value = new Date(timestamp);
		return Number.isNaN(value.valueOf()) ? timestamp : dateFormatter.format(value);
	}

	function statusClass(status: OrderStatus) {
		if (status === 'filled')
			return 'border-emerald-700/30 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300';
		if (status === 'rejected') return 'border-destructive/30 text-destructive';
		if (status === 'partially-filled')
			return 'border-amber-700/30 text-amber-800 dark:border-amber-400/30 dark:text-amber-300';
		if (status === 'working' || status === 'accepted')
			return 'border-blue-700/30 text-blue-700 dark:border-blue-400/30 dark:text-blue-300';
		return 'text-muted-foreground';
	}

	function priceDescription(order: OrderRow) {
		const values: string[] = [];
		if (order.limitPrice !== undefined) values.push(`Limit ${money.format(order.limitPrice)}`);
		if (order.stopPrice !== undefined) values.push(`Stop ${money.format(order.stopPrice)}`);
		return values.join(' · ');
	}
</script>

{#snippet sortableHeader(key: OrderSortKey, text: string, align: 'left' | 'right' = 'left')}
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
			{#if !loading && !error}<p class="text-xs text-muted-foreground">
					{orders.length}
					{orders.length === 1 ? 'order' : 'orders'}
				</p>{/if}
		</div>
		{#if headerActions}<div class="flex items-center gap-2">{@render headerActions()}</div>{/if}
	</header>

	{#if error}
		<div class="p-4">
			<Alert variant="destructive" class="rounded-none shadow-none">
				<RefreshCwIcon aria-hidden="true" />
				<AlertTitle>Orders unavailable</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
				{#if error.onRetry}
					<Button
						variant="outline"
						size="sm"
						class="mt-3 rounded-none shadow-none transition-none"
						onclick={error.onRetry}>Retry</Button
					>
				{/if}
			</Alert>
		</div>
	{:else if !loading && orders.length === 0}
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
				<Table.Caption class="sr-only">{label}. Order status is server-confirmed.</Table.Caption>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						{@render sortableHeader('submittedAt', 'Submitted')}
						{@render sortableHeader('symbol', 'Symbol')}
						<Table.Head scope="col" class="px-3">Side</Table.Head>
						{@render sortableHeader('quantity', 'Filled / ordered', 'right')}
						<Table.Head scope="col" class="px-3">Order</Table.Head>
						<Table.Head scope="col" class="px-3">Duration</Table.Head>
						{@render sortableHeader('status', 'Status')}
						{@render sortableHeader('averageFillPrice', 'Avg. fill', 'right')}
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
						{#each orders as order (order.id)}
							<Table.Row>
								<Table.Cell class="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground"
									>{displayDate(order.submittedAt)}</Table.Cell
								>
								<Table.Cell class="max-w-44 px-3 py-3">
									{#if onOpen}
										<button
											type="button"
											class="block max-w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
											onclick={() => onOpen?.(order)}
										>
											<span class="block truncate font-semibold">{order.symbol}</span>
											{#if order.strategy}<span class="block truncate text-xs text-muted-foreground"
													>{order.strategy}</span
												>{/if}
										</button>
									{:else}
										<span class="block truncate font-semibold">{order.symbol}</span>
										{#if order.strategy}<span class="block truncate text-xs text-muted-foreground"
												>{order.strategy}</span
											>{/if}
									{/if}
								</Table.Cell>
								<Table.Cell class="px-3 py-3"
									><span class="font-medium">{humanize(order.side)}</span><span
										class="block text-xs text-muted-foreground"
										>{humanize(order.positionEffect)}</span
									></Table.Cell
								>
								<Table.Cell class="px-3 py-3 text-right tabular-nums"
									>{quantityFormatter.format(order.filledQuantity)} / {quantityFormatter.format(
										order.quantity
									)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3"
									><span>{humanize(order.type)}</span>{#if priceDescription(order)}<span
											class="block text-xs text-muted-foreground tabular-nums"
											>{priceDescription(order)}</span
										>{/if}</Table.Cell
								>
								<Table.Cell class="px-3 py-3 uppercase">{order.timeInForce}</Table.Cell>
								<Table.Cell class="px-3 py-3"
									><Badge variant="outline" class={['rounded-none', statusClass(order.status)]}
										>{humanize(order.status)}</Badge
									>{#if order.statusDetail}<p class="mt-1 max-w-40 text-xs text-muted-foreground">
											{order.statusDetail}
										</p>{/if}</Table.Cell
								>
								<Table.Cell class="px-3 py-3 text-right tabular-nums"
									>{order.averageFillPrice === undefined
										? '—'
										: money.format(order.averageFillPrice)}</Table.Cell
								>
								<Table.Cell class="px-3 py-3">
									<div class="flex justify-end gap-1">
										{#if order.canEdit && onEdit}<Button
												variant="outline"
												size="sm"
												class="rounded-none shadow-none transition-none"
												disabled={pendingOrderId === order.id}
												onclick={() => onEdit?.(order)}>Edit</Button
											>{/if}
										{#if order.canCancel && onCancel}<Button
												variant="destructive"
												size="sm"
												class="rounded-none shadow-none transition-none"
												disabled={pendingOrderId === order.id}
												onclick={() => onCancel?.(order)}
												>{pendingOrderId === order.id ? 'Cancelling…' : 'Cancel'}</Button
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
				<ul class="divide-y divide-border" aria-label="Loading orders">
					{#each loadingRows as rowId (rowId)}
						<li class="space-y-3 p-4">
							<Skeleton class="h-5 w-24 rounded-none" /><Skeleton
								class="h-20 w-full rounded-none"
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<ul class="divide-y divide-border" aria-label={label}>
					{#each orders as order (order.id)}
						<li>
							<article class="p-4">
								<header class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<h3 class="truncate text-sm font-semibold">{order.symbol}</h3>
										<p class="truncate text-xs text-muted-foreground">
											{order.strategy ??
												`${humanize(order.side)} · ${humanize(order.positionEffect)}`}
										</p>
									</div>
									<Badge
										variant="outline"
										class={['shrink-0 rounded-none', statusClass(order.status)]}
										>{humanize(order.status)}</Badge
									>
								</header>
								<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
									<div>
										<dt class="text-xs text-muted-foreground">Submitted</dt>
										<dd class="mt-0.5">{displayDate(order.submittedAt)}</dd>
									</div>
									<div class="text-right">
										<dt class="text-xs text-muted-foreground">Filled / ordered</dt>
										<dd class="mt-0.5 tabular-nums">
											{quantityFormatter.format(order.filledQuantity)} / {quantityFormatter.format(
												order.quantity
											)}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Order</dt>
										<dd class="mt-0.5">
											{humanize(order.type)}{#if priceDescription(order)}<span
													class="block text-xs text-muted-foreground tabular-nums"
													>{priceDescription(order)}</span
												>{/if}
										</dd>
									</div>
									<div class="text-right">
										<dt class="text-xs text-muted-foreground">Average fill</dt>
										<dd class="mt-0.5 tabular-nums">
											{order.averageFillPrice === undefined
												? '—'
												: money.format(order.averageFillPrice)}
										</dd>
									</div>
								</dl>
								{#if onOpen || (order.canEdit && onEdit) || (order.canCancel && onCancel)}
									<div class="mt-4 flex gap-2 border-t border-border pt-3">
										{#if onOpen}<Button
												variant="ghost"
												class="h-10 flex-1 rounded-none shadow-none transition-none"
												onclick={() => onOpen?.(order)}>Details</Button
											>{/if}
										{#if order.canEdit && onEdit}<Button
												variant="outline"
												class="h-10 flex-1 rounded-none shadow-none transition-none"
												disabled={pendingOrderId === order.id}
												onclick={() => onEdit?.(order)}>Edit</Button
											>{/if}
										{#if order.canCancel && onCancel}<Button
												variant="destructive"
												class="h-10 flex-1 rounded-none shadow-none transition-none"
												disabled={pendingOrderId === order.id}
												onclick={() => onCancel?.(order)}
												>{pendingOrderId === order.id ? 'Cancelling…' : 'Cancel'}</Button
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
