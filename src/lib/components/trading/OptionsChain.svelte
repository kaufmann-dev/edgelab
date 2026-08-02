<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import EmptyState from './EmptyState.svelte';
	import { humanize } from './format.js';
	import type { DataError, OptionChainRow, OptionContractQuote, OptionType } from './types.js';

	interface Props {
		rows: OptionChainRow[];
		expirationLabel: string;
		daysToExpiration?: number;
		quoteAsOf?: string;
		currency?: string;
		locale?: string;
		loading?: boolean;
		error?: DataError;
		selectedContractIds?: string[];
		mobileType?: OptionType;
		onMobileTypeChange?: (type: OptionType) => void;
		onSelect?: (contract: OptionContractQuote) => void;
	}

	let {
		rows,
		expirationLabel,
		daysToExpiration,
		quoteAsOf,
		currency = 'USD',
		locale = 'en-US',
		loading = false,
		error,
		selectedContractIds = [],
		mobileType = $bindable('call'),
		onMobileTypeChange,
		onSelect
	}: Props = $props();

	const uid = $props.id();
	const loadingRows = [
		'option-loading-1',
		'option-loading-2',
		'option-loading-3',
		'option-loading-4'
	];
	const desktopColumns = [
		'call-action',
		'call-oi',
		'call-vol',
		'call-iv',
		'call-delta',
		'call-last',
		'call-bid',
		'call-ask',
		'strike',
		'put-bid',
		'put-ask',
		'put-last',
		'put-delta',
		'put-iv',
		'put-vol',
		'put-oi',
		'put-action'
	];
	let money = $derived(
		new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		})
	);
	let integer = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }));
	let mobileContracts = $derived(
		rows.flatMap((row) => {
			const contract = mobileType === 'call' ? row.call : row.put;
			return contract ? [{ row, contract }] : [];
		})
	);

	function formatPrice(value: number | undefined) {
		return value === undefined ? '—' : money.format(value);
	}

	function formatDecimal(value: number | undefined) {
		return value === undefined ? '—' : value.toFixed(3);
	}

	function formatPercent(value: number | undefined) {
		return value === undefined ? '—' : `${value.toFixed(1)}%`;
	}

	function formatInteger(value: number | undefined) {
		return value === undefined ? '—' : integer.format(value);
	}

	function isSelected(contract: OptionContractQuote | undefined) {
		return contract ? selectedContractIds.includes(contract.id) : false;
	}

	function selectMobileType(type: OptionType) {
		mobileType = type;
		onMobileTypeChange?.(type);
	}
</script>

{#snippet contractAction(contract: OptionContractQuote | undefined)}
	{#if contract && onSelect}
		<Button
			variant={isSelected(contract) ? 'default' : 'outline'}
			size="sm"
			class="rounded-none shadow-none transition-none"
			onclick={() => onSelect?.(contract)}
			aria-pressed={isSelected(contract)}
			aria-label={`${isSelected(contract) ? 'Remove' : 'Add'} ${contract.symbol} ${contract.type} contract`}
		>
			{isSelected(contract) ? 'Added' : 'Add'}
		</Button>
	{:else}
		<span aria-hidden="true">—</span><span class="sr-only">Unavailable</span>
	{/if}
{/snippet}

<section class="border border-border bg-background" aria-labelledby={`${uid}-heading`}>
	<header class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
		<div>
			<h2 id={`${uid}-heading`} class="text-sm font-semibold">Options chain</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">
				{expirationLabel}{#if daysToExpiration !== undefined}
					· {daysToExpiration} DTE{/if}{#if quoteAsOf}
					· As of {quoteAsOf}{/if}
			</p>
		</div>
		<div class="flex md:hidden" role="group" aria-label="Option type">
			<Button
				variant={mobileType === 'call' ? 'default' : 'outline'}
				class="h-10 rounded-none shadow-none transition-none"
				onclick={() => selectMobileType('call')}
				aria-pressed={mobileType === 'call'}
			>
				Calls
			</Button>
			<Button
				variant={mobileType === 'put' ? 'default' : 'outline'}
				class="h-10 rounded-none border-l-0 shadow-none transition-none"
				onclick={() => selectMobileType('put')}
				aria-pressed={mobileType === 'put'}
			>
				Puts
			</Button>
		</div>
	</header>

	{#if error}
		<div class="p-4">
			<Alert variant="destructive" class="rounded-none shadow-none">
				<RefreshCwIcon aria-hidden="true" />
				<AlertTitle>Option chain unavailable</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
				{#if error.onRetry}<Button
						variant="outline"
						size="sm"
						class="mt-3 rounded-none shadow-none transition-none"
						onclick={error.onRetry}>Retry</Button
					>{/if}
			</Alert>
		</div>
	{:else if !loading && rows.length === 0}
		<div class="p-4">
			<EmptyState
				title="No contracts available"
				description="Try another expiration or adjust the option-chain filters."
				compact
			/>
		</div>
	{:else}
		<div class="hidden md:block">
			<Table.Root class="min-w-[92rem]">
				<Table.Caption class="sr-only"
					>Options expiring {expirationLabel}. Select a contract to add it to the order ticket.</Table.Caption
				>
				<Table.Header>
					<Table.Row class="border-b-0 hover:bg-transparent">
						<Table.Head colspan={8} scope="colgroup" class="border-r border-border px-3 text-center"
							>Calls</Table.Head
						>
						<Table.Head
							rowspan={2}
							scope="col"
							class="border-r border-l border-border px-3 text-center">Strike</Table.Head
						>
						<Table.Head colspan={8} scope="colgroup" class="border-l border-border px-3 text-center"
							>Puts</Table.Head
						>
					</Table.Row>
					<Table.Row class="hover:bg-transparent">
						<Table.Head scope="col" class="px-3">Add</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">OI</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Vol</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">IV</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Delta</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Last</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Bid</Table.Head>
						<Table.Head scope="col" class="border-r border-border px-3 text-right">Ask</Table.Head>
						<Table.Head scope="col" class="border-l border-border px-3 text-right">Bid</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Ask</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Last</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Delta</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">IV</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Vol</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">OI</Table.Head>
						<Table.Head scope="col" class="px-3 text-right">Add</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if loading}
						{#each loadingRows as rowId (rowId)}
							<Table.Row>
								{#each desktopColumns as columnId (`${rowId}-${columnId}`)}
									<Table.Cell class="px-3 py-3"
										><Skeleton class="h-4 w-full rounded-none" /></Table.Cell
									>
								{/each}
							</Table.Row>
						{/each}
					{:else}
						{#each rows as row (row.id)}
							<Table.Row class={row.isAtTheMoney ? 'bg-muted/50' : undefined}>
								<Table.Cell class="px-3 py-2">{@render contractAction(row.call)}</Table.Cell>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatInteger(row.call?.openInterest)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatInteger(row.call?.volume)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatPercent(row.call?.impliedVolatilityPercent)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatDecimal(row.call?.delta)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatPrice(row.call?.last)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatPrice(row.call?.bid)}</Table.Cell
								>
								<Table.Cell class="border-r border-border px-3 py-2 text-right tabular-nums"
									>{formatPrice(row.call?.ask)}</Table.Cell
								>
								<Table.Cell
									class="border-r border-l border-border bg-muted/30 px-3 py-2 text-center font-semibold tabular-nums"
								>
									{money.format(row.strike)}
									{#if row.isAtTheMoney}<span
											class="ml-1 border border-border px-1 py-0.5 text-[0.625rem] font-medium text-muted-foreground"
											>ATM</span
										>{/if}
								</Table.Cell>
								<Table.Cell class="border-l border-border px-3 py-2 text-right tabular-nums"
									>{formatPrice(row.put?.bid)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatPrice(row.put?.ask)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatPrice(row.put?.last)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatDecimal(row.put?.delta)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatPercent(row.put?.impliedVolatilityPercent)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatInteger(row.put?.volume)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right tabular-nums"
									>{formatInteger(row.put?.openInterest)}</Table.Cell
								>
								<Table.Cell class="px-3 py-2 text-right"
									>{@render contractAction(row.put)}</Table.Cell
								>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>

		<div class="md:hidden">
			{#if loading}
				<ul class="divide-y divide-border" aria-label="Loading option contracts">
					{#each loadingRows as rowId (rowId)}
						<li class="space-y-3 p-4">
							<Skeleton class="h-5 w-24 rounded-none" /><Skeleton
								class="h-20 w-full rounded-none"
							/>
						</li>
					{/each}
				</ul>
			{:else if mobileContracts.length === 0}
				<div class="p-4">
					<EmptyState
						title={`No ${mobileType} contracts`}
						description="No contracts of this type are available for the selected expiration."
						compact
					/>
				</div>
			{:else}
				<ul
					class="divide-y divide-border"
					aria-label={`${mobileType === 'call' ? 'Call' : 'Put'} contracts`}
				>
					{#each mobileContracts as item (item.contract.id)}
						<li>
							<article class={item.row.isAtTheMoney ? 'bg-muted/30 p-4' : 'p-4'}>
								<header class="flex items-start justify-between gap-3">
									<div>
										<h3 class="font-semibold tabular-nums">
											{money.format(item.row.strike)}
											{humanize(item.contract.type)}
										</h3>
										<p class="text-xs text-muted-foreground">{item.contract.symbol}</p>
									</div>
									{#if item.row.isAtTheMoney}<Badge variant="outline" class="rounded-none"
											>ATM</Badge
										>{/if}
								</header>
								<dl class="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
									<div>
										<dt class="text-xs text-muted-foreground">Bid</dt>
										<dd class="mt-0.5 tabular-nums">{formatPrice(item.contract.bid)}</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Ask</dt>
										<dd class="mt-0.5 tabular-nums">{formatPrice(item.contract.ask)}</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Delta</dt>
										<dd class="mt-0.5 tabular-nums">{formatDecimal(item.contract.delta)}</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">IV</dt>
										<dd class="mt-0.5 tabular-nums">
											{formatPercent(item.contract.impliedVolatilityPercent)}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Volume</dt>
										<dd class="mt-0.5 tabular-nums">{formatInteger(item.contract.volume)}</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Open interest</dt>
										<dd class="mt-0.5 tabular-nums">{formatInteger(item.contract.openInterest)}</dd>
									</div>
								</dl>
								{#if onSelect}<div class="mt-4 border-t border-border pt-3">
										{@render contractAction(item.contract)}
									</div>{/if}
							</article>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>
