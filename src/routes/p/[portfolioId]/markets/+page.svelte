<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BookmarkPlusIcon from '@lucide/svelte/icons/bookmark-plus';
	import CandlestickChartIcon from '@lucide/svelte/icons/chart-candlestick';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import RadioTowerIcon from '@lucide/svelte/icons/radio-tower';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { applyAction, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { EmptyState } from '#lib/components/trading/index.js';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';

	type WatchlistSuccess = {
		watchlistSuccess: string;
		addedSymbol?: string;
		alreadySaved?: boolean;
		removedItemId?: string;
	};
	type WatchlistFailure = { watchlistError: string };

	let { data, form: actionData }: PageProps = $props();
	let pendingOperation = $state<string | null>(null);
	let watchlistError = $state(
		untrack(() => (actionData && 'watchlistError' in actionData ? actionData.watchlistError : null))
	);
	let watchlistNotice = $state(
		untrack(() =>
			actionData && 'watchlistSuccess' in actionData ? actionData.watchlistSuccess : null
		)
	);

	const retrievedAtFormatter = new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'medium',
		timeZone: 'UTC'
	});
	const moneyFormatter = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 4
	});

	let tradeRoute = $derived(resolve('/p/[portfolioId]/trade', { portfolioId: data.portfolio.id }));
	let savedSymbols = $derived(
		new Set(data.watchlist.items.map((item) => item.symbol.toUpperCase()))
	);

	function tradeHref(symbol: string) {
		return `${tradeRoute}?symbol=${encodeURIComponent(symbol)}`;
	}

	function retrievedAtLabel(value: string) {
		return `${retrievedAtFormatter.format(new Date(value))} UTC`;
	}

	function formatMoney(value: string | undefined) {
		return value === undefined ? 'Not reported' : moneyFormatter.format(Number(value));
	}

	async function runWatchlistAction(
		action: 'addWatchlistItem' | 'removeWatchlistItem',
		formData: FormData,
		operation: string
	) {
		if (pendingOperation) return;
		pendingOperation = operation;
		watchlistError = null;
		watchlistNotice = null;

		try {
			const response = await fetch(`?/${action}`, { method: 'POST', body: formData });
			const result = deserialize<WatchlistSuccess, WatchlistFailure>(await response.text());

			if (result.type === 'failure') {
				watchlistError = result.data?.watchlistError ?? 'The watchlist could not be updated.';
			} else if (result.type === 'success') {
				watchlistNotice = result.data?.watchlistSuccess ?? 'The watchlist was updated.';
			}

			await applyAction(result);
			if (result.type === 'success') await invalidateAll();
		} catch {
			watchlistError = 'The watchlist request failed. Check your connection and try again.';
		} finally {
			pendingOperation = null;
		}
	}

	function addSymbol(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);
		const symbol = String(formData.get('symbol') ?? '')
			.trim()
			.toUpperCase();
		void runWatchlistAction('addWatchlistItem', formData, `add:${symbol}`);
	}

	function removeItem(event: SubmitEvent) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget as HTMLFormElement);
		const symbol = String(formData.get('symbol') ?? 'symbol');
		void runWatchlistAction('removeWatchlistItem', formData, `remove:${symbol}`);
	}
</script>

<svelte:head><title>Markets · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-[100rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
	<header>
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
			Massive market data
		</p>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">Markets</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Search active US stocks before opening a simulated position.
		</p>
	</header>

	<section class="border border-border" aria-labelledby="watchlist-heading">
		<header
			class="border-b border-border px-4 py-4 lg:flex lg:items-end lg:justify-between lg:gap-6"
		>
			<div>
				<h2 id="watchlist-heading" class="text-base font-semibold">{data.watchlist.name}</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					Save active stock symbols to this portfolio and review their latest Massive market data.
				</p>
			</div>
			<form
				method="POST"
				action="?/addWatchlistItem"
				onsubmit={addSymbol}
				class="mt-4 flex w-full flex-col gap-2 sm:flex-row lg:mt-0 lg:max-w-md"
			>
				<label for="watchlist-symbol" class="sr-only">Stock symbol to save</label>
				<Input
					id="watchlist-symbol"
					name="symbol"
					value={data.query.toUpperCase()}
					maxlength={15}
					autocapitalize="characters"
					autocomplete="off"
					placeholder="Stock symbol, e.g. AAPL"
					class="h-11 rounded-none font-medium uppercase shadow-none transition-none"
				/>
				<Button
					type="submit"
					disabled={pendingOperation !== null}
					class="h-11 rounded-none px-4 shadow-none transition-none"
				>
					<BookmarkPlusIcon aria-hidden="true" />
					{pendingOperation?.startsWith('add:') ? 'Saving…' : 'Save symbol'}
				</Button>
			</form>
		</header>

		{#if watchlistError}
			<div class="border-b border-border p-4">
				<Alert variant="destructive" class="rounded-none shadow-none">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>Watchlist not updated</AlertTitle>
					<AlertDescription>{watchlistError}</AlertDescription>
				</Alert>
			</div>
		{:else if watchlistNotice}
			<div class="border-b border-border p-4">
				<Alert class="rounded-none shadow-none">
					<CircleCheckIcon aria-hidden="true" />
					<AlertTitle>Watchlist updated</AlertTitle>
					<AlertDescription>{watchlistNotice}</AlertDescription>
				</Alert>
			</div>
		{:else if pendingOperation}
			<div
				class="flex min-h-11 items-center gap-2 border-b border-border px-4 py-2 text-sm text-muted-foreground"
				role="status"
				aria-live="polite"
			>
				<Clock3Icon class="size-4" aria-hidden="true" />
				Updating this portfolio’s watchlist…
			</div>
		{/if}

		{#if data.watchlist.items.length === 0}
			<div class="p-4">
				<EmptyState
					title="No saved symbols"
					description="Enter an exact stock symbol above, or search the Massive directory and save a result."
					icon={CandlestickChartIcon}
				/>
			</div>
		{:else}
			<div class="hidden overflow-x-auto md:block">
				<table
					class={[
						'w-full border-collapse text-left text-sm',
						data.feed?.quotes ? 'min-w-[62rem]' : 'min-w-[50rem]'
					]}
				>
					<caption class="sr-only">
						Saved stock symbols, Massive market data, and portfolio actions
					</caption>
					<thead class="bg-muted/40 text-xs text-muted-foreground uppercase">
						<tr>
							<th scope="col" class="px-4 py-3 font-medium">Instrument</th>
							{#if data.feed?.quotes}
								<th scope="col" class="px-4 py-3 font-medium">Bid / ask</th>
							{/if}
							<th scope="col" class="px-4 py-3 font-medium">
								{data.feed?.trades ? 'Last trade' : 'Minute close'}
							</th>
							<th scope="col" class="px-4 py-3 font-medium">
								{data.feed?.trades ? 'Trade update' : 'Aggregate update'}
							</th>
							<th scope="col" class="px-4 py-3 text-right font-medium">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.watchlist.items as item (item.id)}
							<tr>
								<th scope="row" class="px-4 py-4 align-top font-normal">
									<div class="flex items-center gap-2">
										<span class="font-semibold tracking-tight">{item.symbol}</span>
										{#if item.snapshot.status === 'available'}
											<Badge variant="outline" class="rounded-none">
												{item.snapshot.data.mode === 'realtime' ? 'Real-time' : 'Delayed'}
											</Badge>
										{/if}
									</div>
									<p class="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={item.name}>
										{item.name}
									</p>
									<p class="mt-1 text-xs text-muted-foreground">
										{item.primaryExchange ?? 'Exchange not reported'}
									</p>
								</th>
								{#if item.snapshot.status === 'available'}
									{#if data.feed?.quotes}
										<td class="px-4 py-4 align-top tabular-nums">
											{#if item.snapshot.data.quote}
												<span aria-label={`Bid ${formatMoney(item.snapshot.data.quote.bidPrice)}`}>
													{formatMoney(item.snapshot.data.quote.bidPrice)}
												</span>
												<span class="text-muted-foreground" aria-hidden="true"> / </span>
												<span aria-label={`Ask ${formatMoney(item.snapshot.data.quote.askPrice)}`}>
													{formatMoney(item.snapshot.data.quote.askPrice)}
												</span>
											{:else}
												<span class="text-muted-foreground">Not reported</span>
											{/if}
										</td>
									{/if}
									<td class="px-4 py-4 align-top font-medium tabular-nums">
										{formatMoney(
											data.feed?.trades
												? (item.snapshot.data.lastTrade?.price ??
														item.snapshot.data.lastMinute?.close)
												: item.snapshot.data.lastMinute?.close
										)}
									</td>
									<td class="px-4 py-4 align-top">
										{#if data.feed?.trades && item.snapshot.data.lastTrade}
											<time
												datetime={item.snapshot.data.lastTrade.sourceTime}
												class="text-xs text-muted-foreground"
											>
												{retrievedAtLabel(item.snapshot.data.lastTrade.sourceTime)}
											</time>
										{:else if item.snapshot.data.lastMinute}
											<time
												datetime={item.snapshot.data.lastMinute.sourceTime}
												class="text-xs text-muted-foreground"
											>
												{retrievedAtLabel(item.snapshot.data.lastMinute.sourceTime)}
											</time>
										{:else}
											<span class="text-xs text-muted-foreground">Not reported</span>
										{/if}
									</td>
								{:else}
									<td colspan={data.feed?.quotes ? 3 : 2} class="px-4 py-4 align-top">
										<div class="flex max-w-xl items-start gap-2 text-xs text-muted-foreground">
											<CircleAlertIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
											<span>{item.snapshot.reason}</span>
										</div>
									</td>
								{/if}
								<td class="px-4 py-4 align-top">
									<div class="flex justify-end gap-2">
										<Button
											href={tradeHref(item.symbol)}
											variant="outline"
											class="h-9 rounded-none px-3 shadow-none transition-none"
										>
											Trade
											<ArrowRightIcon aria-hidden="true" />
										</Button>
										<form method="POST" action="?/removeWatchlistItem" onsubmit={removeItem}>
											<input type="hidden" name="itemId" value={item.id} />
											<input type="hidden" name="symbol" value={item.symbol} />
											<Button
												type="submit"
												variant="ghost"
												disabled={pendingOperation !== null}
												aria-label={`Remove ${item.symbol} from watchlist`}
												class="size-9 rounded-none shadow-none transition-none"
											>
												<Trash2Icon aria-hidden="true" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<ul class="divide-y divide-border md:hidden" aria-label="Saved stock symbols">
				{#each data.watchlist.items as item (item.id)}
					<li class="space-y-4 p-4">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="font-semibold tracking-tight">{item.symbol}</h3>
								{#if item.snapshot.status === 'available'}
									<Badge variant="outline" class="rounded-none">
										{item.snapshot.data.mode === 'realtime' ? 'Real-time' : 'Delayed'}
									</Badge>
								{/if}
							</div>
							<p class="mt-1 truncate text-sm" title={item.name}>{item.name}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{item.primaryExchange ?? 'Exchange not reported'}
							</p>
						</div>

						{#if item.snapshot.status === 'available'}
							<dl class="grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
								{#if data.feed?.quotes}
									<div>
										<dt class="text-xs text-muted-foreground">Bid</dt>
										<dd class="mt-1 font-medium tabular-nums">
											{formatMoney(item.snapshot.data.quote?.bidPrice)}
										</dd>
									</div>
									<div>
										<dt class="text-xs text-muted-foreground">Ask</dt>
										<dd class="mt-1 font-medium tabular-nums">
											{formatMoney(item.snapshot.data.quote?.askPrice)}
										</dd>
									</div>
								{/if}
								<div>
									<dt class="text-xs text-muted-foreground">
										{data.feed?.trades ? 'Last trade' : 'Minute close'}
									</dt>
									<dd class="mt-1 font-medium tabular-nums">
										{formatMoney(
											data.feed?.trades
												? (item.snapshot.data.lastTrade?.price ??
														item.snapshot.data.lastMinute?.close)
												: item.snapshot.data.lastMinute?.close
										)}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-muted-foreground">
										{data.feed?.trades ? 'Trade update' : 'Aggregate update'}
									</dt>
									<dd class="mt-1 text-xs">
										{#if data.feed?.trades && item.snapshot.data.lastTrade}
											<time datetime={item.snapshot.data.lastTrade.sourceTime}>
												{retrievedAtLabel(item.snapshot.data.lastTrade.sourceTime)}
											</time>
										{:else if item.snapshot.data.lastMinute}
											<time datetime={item.snapshot.data.lastMinute.sourceTime}>
												{retrievedAtLabel(item.snapshot.data.lastMinute.sourceTime)}
											</time>
										{:else}
											Not reported
										{/if}
									</dd>
								</div>
							</dl>
						{:else}
							<div
								class="flex items-start gap-2 border-y border-border py-3 text-xs text-muted-foreground"
							>
								<CircleAlertIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
								<span>{item.snapshot.reason}</span>
							</div>
						{/if}

						<div class="grid grid-cols-[1fr_auto] gap-2">
							<Button
								href={tradeHref(item.symbol)}
								variant="outline"
								class="h-11 rounded-none shadow-none transition-none"
							>
								Trade {item.symbol}
								<ArrowRightIcon aria-hidden="true" />
							</Button>
							<form method="POST" action="?/removeWatchlistItem" onsubmit={removeItem}>
								<input type="hidden" name="itemId" value={item.id} />
								<input type="hidden" name="symbol" value={item.symbol} />
								<Button
									type="submit"
									variant="ghost"
									disabled={pendingOperation !== null}
									aria-label={`Remove ${item.symbol} from watchlist`}
									class="size-11 rounded-none shadow-none transition-none"
								>
									<Trash2Icon aria-hidden="true" />
								</Button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
		<div class="min-w-0 space-y-4">
			<form method="GET" class="flex max-w-2xl flex-col gap-2 sm:flex-row" role="search">
				<label for="market-search" class="sr-only">Search companies or symbols</label>
				<Input
					id="market-search"
					name="q"
					value={data.query}
					maxlength={80}
					autocomplete="off"
					placeholder="Search by company or symbol"
					class="h-11 rounded-none shadow-none transition-none"
				/>
				<Button type="submit" class="h-11 rounded-none px-4 shadow-none transition-none">
					<SearchIcon aria-hidden="true" />
					Search Massive
				</Button>
			</form>

			{#if data.searchStatus === 'error'}
				<Alert variant="destructive" class="rounded-none shadow-none">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>Market search unavailable</AlertTitle>
					<AlertDescription>{data.searchError}</AlertDescription>
				</Alert>
			{:else if data.searchStatus === 'success' && data.items.length > 0}
				<section class="border border-border" aria-labelledby="market-results-heading">
					<header
						class="border-b border-border px-4 py-3 sm:flex sm:items-end sm:justify-between sm:gap-4"
					>
						<div>
							<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Massive instrument directory
							</p>
							<h2 id="market-results-heading" class="mt-1 text-base font-semibold">
								Results for “{data.query}”
							</h2>
						</div>
						<p class="mt-1 text-xs text-muted-foreground sm:mt-0">
							{data.items.length}
							{data.items.length === 1 ? 'instrument' : 'instruments'}
						</p>
					</header>

					<ul class="divide-y divide-border">
						{#each data.items as instrument (instrument.symbol)}
							<li>
								<article class="px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-6">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<h3 class="font-semibold tracking-tight">{instrument.symbol}</h3>
											<Badge variant="outline" class="rounded-none">Active US stock</Badge>
										</div>
										<p class="mt-1 text-sm text-foreground">{instrument.name}</p>
										<dl class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
											<div class="flex gap-1.5">
												<dt>Exchange</dt>
												<dd class="font-medium text-foreground">
													{instrument.primaryExchange ?? 'Not reported'}
												</dd>
											</div>
											<div class="flex gap-1.5">
												<dt>Currency</dt>
												<dd class="font-medium text-foreground">{instrument.currency}</dd>
											</div>
											<div class="flex gap-1.5">
												<dt>Round lot</dt>
												<dd class="font-medium text-foreground tabular-nums">
													{instrument.roundLot}
												</dd>
											</div>
										</dl>
									</div>
									<div class="mt-4 grid w-full gap-2 sm:mt-0 sm:flex sm:w-auto">
										<form method="POST" action="?/addWatchlistItem" onsubmit={addSymbol}>
											<input type="hidden" name="symbol" value={instrument.symbol} />
											<Button
												type="submit"
												variant="outline"
												disabled={savedSymbols.has(instrument.symbol.toUpperCase()) ||
													pendingOperation !== null}
												class="h-10 w-full rounded-none px-4 shadow-none transition-none sm:w-auto"
											>
												{#if savedSymbols.has(instrument.symbol.toUpperCase())}
													<CircleCheckIcon aria-hidden="true" />
													Saved
												{:else}
													<BookmarkPlusIcon aria-hidden="true" />
													{pendingOperation === `add:${instrument.symbol}` ? 'Saving…' : 'Save'}
												{/if}
											</Button>
										</form>
										<Button
											href={tradeHref(instrument.symbol)}
											variant="outline"
											class="h-10 w-full rounded-none px-4 shadow-none transition-none sm:w-auto"
										>
											Open ticket
											<ArrowRightIcon aria-hidden="true" />
										</Button>
									</div>
								</article>
							</li>
						{/each}
					</ul>
				</section>
			{:else if data.searchStatus === 'success'}
				<EmptyState
					title={`No active US stocks matched “${data.query}”`}
					description="Try a ticker, company name, or a shorter search term. Massive returned no matching instruments."
					icon={SearchIcon}
				/>
			{:else}
				<EmptyState
					title="Search the US stock directory"
					description="Find active stocks by company name or ticker. Results come from Massive reference data; prices are never invented."
					icon={SearchIcon}
				/>
			{/if}
		</div>

		<aside class="h-fit border border-border" aria-labelledby="stock-feed-heading">
			<header class="border-b border-border px-4 py-3">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Provider capability
						</p>
						<h2 id="stock-feed-heading" class="mt-1 text-base font-semibold">Stocks feed</h2>
					</div>
					{#if data.feed}
						<Badge
							variant={data.feed.executionMode === 'realtime' ? 'default' : 'outline'}
							class="rounded-none"
						>
							{#if data.feed.executionMode === 'realtime'}
								<RadioTowerIcon aria-hidden="true" />
							{:else}
								<Clock3Icon aria-hidden="true" />
							{/if}
							{data.feed.label}
						</Badge>
					{/if}
				</div>
			</header>

			{#if data.feed}
				<div class="space-y-4 px-4 py-4">
					<p class="text-sm text-muted-foreground">
						{#if data.feed.executionMode === 'realtime'}
							The configured stock plan supports real-time data. Each quote still carries its own
							provider timestamp.
						{:else if data.feed.executionMode === 'delayed'}
							Stock prices are delayed by {data.feed.delayMinutes} minutes under the configured plan.
						{/if}
					</p>
					{#if !data.feed.quotes && !data.feed.trades && (data.feed.minuteBars || data.feed.secondBars)}
						<p class="text-sm text-muted-foreground">
							Aggregate bars power simulated stock pricing when raw quotes and trades are not
							included in the plan.
						</p>
					{/if}

					<dl class="divide-y divide-border border border-border text-sm">
						<div class="flex items-center justify-between gap-4 px-3 py-2.5">
							<dt>Snapshot endpoint</dt>
							<dd class="font-medium">{data.feed.snapshots ? 'Available' : 'Unavailable'}</dd>
						</div>
						<div class="flex items-center justify-between gap-4 px-3 py-2.5">
							<dt>WebSocket transport</dt>
							<dd class="font-medium">{data.feed.websocket ? 'Available' : 'Unavailable'}</dd>
						</div>
						<div class="flex items-center justify-between gap-4 px-3 py-2.5">
							<dt>Minute aggregates</dt>
							<dd class="font-medium">{data.feed.minuteBars ? 'Available' : 'Unavailable'}</dd>
						</div>
						<div class="flex items-center justify-between gap-4 px-3 py-2.5">
							<dt>Second aggregates</dt>
							<dd class="font-medium">{data.feed.secondBars ? 'Available' : 'Unavailable'}</dd>
						</div>
						<div class="flex items-center justify-between gap-4 px-3 py-2.5">
							<dt>Trade events</dt>
							<dd class="font-medium">{data.feed.trades ? 'Available' : 'Unavailable'}</dd>
						</div>
						<div class="flex items-center justify-between gap-4 px-3 py-2.5">
							<dt>Quote events</dt>
							<dd class="font-medium">{data.feed.quotes ? 'Available' : 'Unavailable'}</dd>
						</div>
					</dl>

					<div class="flex gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
						<DatabaseIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
						<p>
							{#if data.retrievedAt}
								Reference results retrieved
								<time datetime={data.retrievedAt}>{retrievedAtLabel(data.retrievedAt)}</time>. They
								do not contain a current price.
							{:else}
								No reference search has been retrieved yet. Price freshness appears only with
								provider-backed market data.
							{/if}
						</p>
					</div>
				</div>
			{:else}
				<div class="px-4 py-4">
					<Alert variant="destructive" class="rounded-none shadow-none">
						<CircleAlertIcon aria-hidden="true" />
						<AlertTitle>Feed capability unavailable</AlertTitle>
						<AlertDescription>{data.feedError}</AlertDescription>
					</Alert>
				</div>
			{/if}
		</aside>
	</div>
</div>
