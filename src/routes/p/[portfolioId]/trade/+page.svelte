<script lang="ts">
	import Decimal from 'decimal.js';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import {
		EmptyState,
		LiveStockStream,
		OptionsChain,
		StockOrderTicket,
		type OptionContractQuote,
		type MarketFeedState,
		type OrderPreviewItem,
		type RiskCheck,
		type StockOrderDraft,
		type StockOrderDraftPatch,
		type StockOrderType,
		type StockQuote
	} from '$lib/components/trading';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { PageProps } from './$types';

	interface SerializedPreview {
		accepted: boolean;
		estimatedNetCashChange: string;
		cashRequired: string;
		optionCollateral: string;
		orderNotional: string;
		fees: string;
		legs: Array<{
			symbol: string;
			quantity: string;
			referencePrice: string;
			grossAmount: string;
			fee: string;
		}>;
		violations: Array<{
			code: string;
			message: string;
			symbol?: string;
			severity: 'warning' | 'blocked';
		}>;
	}

	interface OptionLegSelection {
		contract: OptionContractQuote;
		action: 'buy_to_open' | 'sell_to_close';
	}

	const EMPTY_DRAFT: StockOrderDraft = {
		side: 'buy',
		orderType: 'market',
		quantityMode: 'shares',
		quantity: '',
		limitPrice: '',
		stopPrice: '',
		trailValue: '',
		trailUnit: 'percent',
		timeInForce: 'day',
		session: 'regular',
		bracketEnabled: false,
		takeProfitPrice: '',
		stopLossPrice: ''
	};

	let { data }: PageProps = $props();
	let optionContractIds = $derived(
		data.options.rows
			.flatMap((row) => [row.call?.id, row.put?.id])
			.filter((id): id is string => id !== undefined)
			.toSorted()
	);
	let availableOptionContractIds = $derived(new Set(optionContractIds));
	let loadedTicketContext = $derived(
		[
			data.portfolio.id,
			data.requestedSymbol,
			data.assetView,
			data.options.expiration ?? '',
			optionContractIds.join(',')
		].join(':')
	);
	let stockDraft = $derived.by<StockOrderDraft>(() => {
		void loadedTicketContext;
		return { ...EMPTY_DRAFT };
	});
	let optionLeg = $derived.by<OptionLegSelection | null>(() => {
		void loadedTicketContext;
		return null;
	});
	let optionQuantity = $derived.by(() => {
		void loadedTicketContext;
		return '1';
	});
	let optionLimitPrice = $derived.by(() => {
		void loadedTicketContext;
		return '';
	});
	let selectedTradePlanId = $derived.by(() => {
		void loadedTicketContext;
		return '';
	});
	let preview = $derived.by<SerializedPreview | null>(() => {
		void loadedTicketContext;
		return null;
	});
	let ticketError = $derived.by<string | null>(() => {
		void loadedTicketContext;
		return null;
	});
	let reviewing = $derived.by(() => {
		void loadedTicketContext;
		return false;
	});
	let placing = $derived.by(() => {
		void loadedTicketContext;
		return false;
	});
	let reviewedPayload = $derived.by<string | null>(() => {
		void loadedTicketContext;
		return null;
	});
	let receipt = $derived.by<{
		id: string;
		status: string;
		filledQuantity: string;
		quantity: string;
	} | null>(() => {
		void loadedTicketContext;
		return null;
	});
	let clientOrderId = $derived.by(() => {
		void loadedTicketContext;
		return crypto.randomUUID();
	});
	let streamedQuote = $derived.by<StockQuote | null>(() => {
		void loadedTicketContext;
		return null;
	});
	let streamedFeed = $derived.by<{ symbol: string; state: MarketFeedState } | null>(() => {
		void loadedTicketContext;
		return null;
	});

	const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
	const referenceTime = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function formatReferenceTime(timestamp: string): string {
		const value = new Date(timestamp);
		return Number.isNaN(value.valueOf()) ? timestamp : referenceTime.format(value);
	}

	let marketsRoute = $derived(
		resolve('/p/[portfolioId]/markets', { portfolioId: data.portfolio.id })
	);
	let ordersRoute = $derived(
		resolve('/p/[portfolioId]/orders', { portfolioId: data.portfolio.id })
	);
	let tradeRoute = $derived(resolve('/p/[portfolioId]/trade', { portfolioId: data.portfolio.id }));
	let displayedQuote = $derived(
		streamedQuote?.symbol === data.quote?.symbol ? streamedQuote : data.quote
	);
	let displayedFeedState = $derived.by(() => {
		const feed = streamedFeed;
		if (feed && feed.symbol === data.quote?.symbol) return feed.state;
		return data.marketFeed?.state;
	});
	let aggregatePricing = $derived(data.marketFeed?.priceSource === 'aggregate');
	let availableStockOrderTypes = $derived<StockOrderType[]>(
		aggregatePricing
			? ['market', 'limit', 'stop', 'stop-limit']
			: ['market', 'limit', 'stop', 'stop-limit', 'trailing-stop']
	);
	let stockTabPath = $derived(
		`${tradeRoute}?symbol=${encodeURIComponent(data.requestedSymbol)}&asset=stock` as Pathname
	);
	let optionsTabPath = $derived(
		`${tradeRoute}?symbol=${encodeURIComponent(data.requestedSymbol)}&asset=options` as Pathname
	);
	let selectedOptionContractIds = $derived(
		optionLeg && availableOptionContractIds.has(optionLeg.contract.id)
			? [optionLeg.contract.id]
			: []
	);
	let optionPriceEffect = $derived<'debit' | 'credit'>(
		optionLeg?.action === 'sell_to_close' ? 'credit' : 'debit'
	);
	let previewItems = $derived.by<OrderPreviewItem[]>(() =>
		preview
			? [
					{
						id: 'notional',
						label: 'Order notional',
						value: money.format(Number(preview.orderNotional))
					},
					{
						id: 'cash',
						label: 'Cash required',
						value: money.format(Number(preview.cashRequired))
					},
					{ id: 'fees', label: 'Estimated fees', value: money.format(Number(preview.fees)) }
				]
			: []
	);
	let riskChecks = $derived.by<RiskCheck[]>(() => {
		if (!preview) return [];
		if (preview.violations.length === 0) {
			return [
				{
					id: 'portfolio-policy',
					label: 'Portfolio policy',
					status: 'pass',
					detail: 'Buying power, permissions, market-data freshness, and configured limits passed.'
				}
			];
		}
		return preview.violations.map((violation) => ({
			id: `${violation.code}-${violation.symbol ?? 'portfolio'}`,
			label: violation.symbol ? `${violation.symbol}: ${violation.code}` : violation.code,
			status: violation.severity === 'blocked' ? 'blocked' : 'warning',
			detail: violation.message
		}));
	});
	let currentPayloadKey = $derived.by(() => {
		try {
			return JSON.stringify(currentPayload());
		} catch {
			return null;
		}
	});
	let canPlace = $derived(
		Boolean(preview?.accepted && reviewedPayload && reviewedPayload === currentPayloadKey)
	);

	function resetReview() {
		preview = null;
		reviewedPayload = null;
		ticketError = null;
		receipt = null;
		clientOrderId = crypto.randomUUID();
	}

	function updateStockDraft(patch: StockOrderDraftPatch) {
		stockDraft = { ...stockDraft, ...patch };
		resetReview();
	}

	function stockPayload() {
		if (!displayedQuote) throw new Error('A provider market price is required.');
		let enteredQuantity: Decimal;
		try {
			enteredQuantity = new Decimal(stockDraft.quantity);
		} catch {
			throw new Error('Enter a quantity greater than zero.');
		}
		if (!enteredQuantity.isFinite() || !enteredQuantity.greaterThan(0)) {
			throw new Error('Enter a quantity greater than zero.');
		}
		const referencePrice = new Decimal(
			aggregatePricing ? displayedQuote.last : (displayedQuote.ask ?? displayedQuote.last)
		);
		const quantity =
			stockDraft.quantityMode === 'notional'
				? enteredQuantity.div(referencePrice).toDecimalPlaces(8, Decimal.ROUND_DOWN)
				: enteredQuantity;
		const side = stockDraft.side === 'buy' || stockDraft.side === 'buy-to-cover' ? 'buy' : 'sell';
		const positionEffect =
			stockDraft.side === 'sell' || stockDraft.side === 'buy-to-cover' ? 'close' : 'open';
		const trailPercent =
			stockDraft.orderType === 'trailing-stop'
				? stockDraft.trailUnit === 'percent'
					? new Decimal(stockDraft.trailValue)
					: new Decimal(stockDraft.trailValue).div(displayedQuote.last).times(100)
				: undefined;
		return {
			portfolioId: data.portfolio.id,
			tradePlanId: selectedTradePlanId || undefined,
			clientOrderId,
			type: stockDraft.orderType.replaceAll('-', '_'),
			timeInForce: stockDraft.timeInForce,
			quantity: quantity.toString(),
			limitPrice: stockDraft.limitPrice || undefined,
			stopPrice: stockDraft.stopPrice || undefined,
			trailingPercent: trailPercent?.toString(),
			netPriceEffect: 'debit',
			extendedHours: stockDraft.session === 'extended',
			legs: [
				{
					symbol: displayedQuote.symbol,
					side,
					positionEffect,
					ratioQuantity: '1'
				}
			]
		};
	}

	function optionPayload() {
		if (!optionLeg || !availableOptionContractIds.has(optionLeg.contract.id)) {
			throw new Error('Select one standard option contract.');
		}
		if (!optionLeg.contract.standardDeliverable) {
			throw new Error('Adjusted option contracts are not supported.');
		}
		let quantity: Decimal;
		try {
			quantity = new Decimal(optionQuantity);
		} catch {
			throw new Error('Contract quantity must be a positive whole number.');
		}
		if (!quantity.isInteger() || !quantity.greaterThan(0)) {
			throw new Error('Contract quantity must be a positive whole number.');
		}
		let limitPrice: Decimal;
		try {
			limitPrice = new Decimal(optionLimitPrice);
		} catch {
			throw new Error('Enter a positive limit price.');
		}
		if (!limitPrice.isFinite() || !limitPrice.greaterThan(0)) {
			throw new Error('Enter a positive limit price.');
		}
		return {
			portfolioId: data.portfolio.id,
			tradePlanId: selectedTradePlanId || undefined,
			clientOrderId,
			type: 'limit',
			timeInForce: 'day',
			quantity: quantity.toString(),
			limitPrice: limitPrice.toString(),
			netPriceEffect: optionPriceEffect,
			extendedHours: false,
			legs: [
				{
					symbol: optionLeg.contract.symbol,
					side: optionLeg.action === 'sell_to_close' ? 'sell' : 'buy',
					positionEffect: optionLeg.action === 'sell_to_close' ? 'close' : 'open',
					ratioQuantity: '1'
				}
			]
		};
	}

	function currentPayload() {
		return data.optionsTradingEnabled && data.assetView === 'options'
			? optionPayload()
			: stockPayload();
	}

	async function requestPreview() {
		reviewing = true;
		ticketError = null;
		let submittedPayload: string | null = null;
		const submittedContext = loadedTicketContext;
		try {
			submittedPayload = JSON.stringify(currentPayload());
			const response = await fetch(
				`/api/portfolios/${encodeURIComponent(data.portfolio.id)}/orders/preview`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: submittedPayload
				}
			);
			const result = (await response.json()) as { error?: string; preview?: SerializedPreview };
			if (!response.ok || !result.preview) throw new Error(result.error ?? 'Preview failed.');
			if (loadedTicketContext !== submittedContext || currentPayloadKey !== submittedPayload)
				return;
			preview = result.preview;
			reviewedPayload = submittedPayload;
		} catch (cause) {
			if (
				loadedTicketContext === submittedContext &&
				(submittedPayload === null || currentPayloadKey === submittedPayload)
			) {
				ticketError = cause instanceof Error ? cause.message : 'Preview failed.';
			}
		} finally {
			if (loadedTicketContext === submittedContext) reviewing = false;
		}
	}

	async function placeOrder() {
		if (!canPlace || currentPayloadKey === null) return;
		const submittedPayload = JSON.stringify(currentPayload());
		if (submittedPayload !== reviewedPayload) return;
		const submittedContext = loadedTicketContext;
		placing = true;
		ticketError = null;
		try {
			const response = await fetch(
				`/api/portfolios/${encodeURIComponent(data.portfolio.id)}/orders`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: submittedPayload
				}
			);
			const result = (await response.json()) as {
				error?: string;
				preview?: SerializedPreview;
				order?: { id: string; status: string; filledQuantity: string; quantity: string };
			};
			if (!response.ok || !result.order) {
				if (
					result.preview &&
					loadedTicketContext === submittedContext &&
					currentPayloadKey === submittedPayload
				) {
					preview = result.preview;
					reviewedPayload = submittedPayload;
				}
				throw new Error(result.error ?? 'Order placement failed.');
			}
			if (loadedTicketContext === submittedContext && currentPayloadKey === submittedPayload) {
				receipt = result.order;
			}
		} catch (cause) {
			if (loadedTicketContext === submittedContext && currentPayloadKey === submittedPayload) {
				ticketError = cause instanceof Error ? cause.message : 'Order placement failed.';
			}
		} finally {
			if (loadedTicketContext === submittedContext) placing = false;
		}
	}

	function selectContract(contract: OptionContractQuote) {
		if (!contract.standardDeliverable) return;
		if (optionLeg?.contract.id === contract.id) return;
		optionLeg = { contract, action: 'buy_to_open' };
		resetReview();
	}

	function updateOptionAction(action: OptionLegSelection['action']) {
		if (!optionLeg) return;
		optionLeg = { ...optionLeg, action };
		resetReview();
	}

	function clearOptionLeg() {
		optionLeg = null;
		resetReview();
	}
</script>

<svelte:head><title>Trade · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-[100rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
	<header>
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Simulation only</p>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">Order ticket</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Server-side risk checks and Massive market data determine whether an order can be accepted.
		</p>
	</header>

	<form method="GET" action={tradeRoute} class="flex max-w-2xl flex-col gap-2 sm:flex-row">
		<label for="trade-symbol" class="sr-only">Choose an underlying stock symbol</label>
		<Input
			id="trade-symbol"
			name="symbol"
			value={data.requestedSymbol}
			maxlength={15}
			pattern={'[A-Za-z][A-Za-z0-9.]{0,14}'}
			autocapitalize="characters"
			autocomplete="off"
			placeholder="Enter a US stock symbol"
			class="h-11 rounded-none font-medium uppercase shadow-none transition-none"
		/>
		<Button type="submit" class="h-11 rounded-none px-4 shadow-none transition-none">
			<SearchIcon aria-hidden="true" />
			Load market data
		</Button>
	</form>

	{#if data.requestedSymbol && data.symbolValid && data.optionsDataEnabled}
		<nav class="flex border-b border-border" aria-label="Asset ticket">
			<a
				href={resolve(stockTabPath)}
				aria-current={data.assetView === 'stock' ? 'page' : undefined}
				class={[
					'min-h-11 border border-b-0 border-border px-4 py-3 text-sm font-medium',
					data.assetView === 'stock' ? 'bg-foreground text-background' : 'bg-background'
				]}>Stock</a
			>
			<a
				href={resolve(optionsTabPath)}
				aria-current={data.assetView === 'options' ? 'page' : undefined}
				class={[
					'min-h-11 border-t border-r border-border px-4 py-3 text-sm font-medium',
					data.assetView === 'options' ? 'bg-foreground text-background' : 'bg-background'
				]}>Options</a
			>
		</nav>
	{/if}

	{#if ticketError || (data.assetView === 'stock' && data.marketError)}
		<Alert variant="destructive" class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Order ticket unavailable</AlertTitle>
			<AlertDescription>{ticketError ?? data.marketError}</AlertDescription>
		</Alert>
	{/if}

	{#if data.assetView === 'stock' && data.referenceQuote}
		<section
			class="max-w-2xl border border-border bg-muted/30"
			aria-labelledby="reference-quote-heading"
		>
			<header
				class="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between"
			>
				<div class="min-w-0">
					<h2 id="reference-quote-heading" class="text-sm font-semibold">
						Last available reference
					</h2>
					<p class="mt-1 truncate text-xs text-muted-foreground">
						{data.referenceQuote.symbol}{#if data.referenceQuote.name}
							· {data.referenceQuote.name}
						{/if}
					</p>
				</div>
				<div class="shrink-0 sm:text-right">
					<p class="text-lg font-semibold tabular-nums">{money.format(data.referenceQuote.last)}</p>
					<p class="text-xs text-muted-foreground">Massive snapshot minute close</p>
				</div>
			</header>
			<div class="space-y-3 p-4 text-sm">
				<dl class="grid gap-3 sm:grid-cols-2">
					<div>
						<dt class="sr-only">Source update time</dt>
						<dd class="mt-1 font-medium tabular-nums">
							<time datetime={data.referenceQuote.asOf}
								>Updated {formatReferenceTime(data.referenceQuote.asOf)}</time
							>
						</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Status</dt>
						<dd class="mt-1 font-medium">Stale · reference only</dd>
					</div>
				</dl>
				<p class="text-xs text-muted-foreground">
					This value is context only. It cannot be used to review or execute a simulated order.
				</p>
			</div>
		</section>
	{/if}

	{#if data.optionsViewRequested && !data.optionsDataEnabled}
		<Alert class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Options data unavailable</AlertTitle>
			<AlertDescription>
				Add a Massive Options plan to view option-chain data. Stock simulation remains available.
			</AlertDescription>
		</Alert>
	{/if}

	{#if receipt}
		<Alert class="rounded-none border-positive/50 bg-positive/5 text-positive shadow-none">
			<CircleCheckIcon aria-hidden="true" />
			<AlertTitle>Simulated order accepted</AlertTitle>
			<AlertDescription>
				Receipt {receipt.id}. Status: {receipt.status.replaceAll('_', ' ')}. Filled
				{receipt.filledQuantity} of {receipt.quantity}.
			</AlertDescription>
			<Button href={ordersRoute} variant="outline" class="mt-3 rounded-none shadow-none">
				View orders
			</Button>
		</Alert>
	{/if}

	{#if data.policy?.requireTradePlan || data.tradePlans.length > 0}
		<div class="max-w-2xl">
			<Label for="trade-plan"
				>Pre-trade plan{data.policy?.requireTradePlan ? ' (required)' : ''}</Label
			>
			<select
				id="trade-plan"
				value={selectedTradePlanId}
				onchange={(event) => {
					selectedTradePlanId = event.currentTarget.value;
					resetReview();
				}}
				class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm"
			>
				<option value="">No linked plan</option>
				{#each data.tradePlans as plan (plan.id)}
					<option value={plan.id}>{plan.symbol ? `${plan.symbol} · ` : ''}{plan.notes}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if data.assetView === 'stock' && displayedQuote}
		{#if data.marketFeed?.streaming}
			{#key displayedQuote.symbol}
				<LiveStockStream
					initialQuote={displayedQuote}
					delayed={data.marketFeed.state === 'delayed'}
					events={data.marketFeed.events}
					onQuote={(quote) => (streamedQuote = quote)}
					onFeedState={(state) => (streamedFeed = { symbol: displayedQuote.symbol, state })}
				/>
			{/key}
		{/if}
		<div class="grid gap-4 xl:grid-cols-[minmax(0,44rem)_minmax(18rem,1fr)]">
			<div class="border border-border">
				<StockOrderTicket
					quote={displayedQuote}
					draft={stockDraft}
					onDraftChange={updateStockDraft}
					onReview={requestPreview}
					availableOrderTypes={availableStockOrderTypes}
					availableSides={data.policy?.allowShortEquity
						? ['buy', 'sell', 'sell-short', 'buy-to-cover']
						: ['buy', 'sell']}
					{previewItems}
					{riskChecks}
					errorMessage={ticketError ?? undefined}
					feedState={displayedFeedState}
					marketSession={data.marketFeed?.modeLabel}
					feedUpdatedLabel="Provider timestamp"
					priceSource={data.marketFeed?.priceSource}
					allowIoc={!aggregatePricing}
					reviewDisabled={Boolean(receipt)}
					{reviewing}
				/>
			</div>

			<aside class="h-fit space-y-4 border border-border p-4" aria-labelledby="review-heading">
				<div>
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						Final review
					</p>
					<h2 id="review-heading" class="mt-1 text-base font-semibold">Submit simulation</h2>
				</div>
				<dl class="divide-y divide-border border-y border-border text-sm">
					<div class="flex justify-between gap-4 py-3">
						<dt class="text-muted-foreground">Cash balance</dt>
						<dd class="font-medium tabular-nums">
							{money.format(Number(data.balances.cashBalance))}
						</dd>
					</div>
					<div class="flex justify-between gap-4 py-3">
						<dt class="text-muted-foreground">Data mode</dt>
						<dd class="font-medium">{data.marketFeed?.modeLabel ?? data.portfolio.dataMode}</dd>
					</div>
				</dl>
				{#if preview}
					<Badge variant={preview.accepted ? 'outline' : 'destructive'} class="rounded-none">
						{preview.accepted ? 'Risk checks passed' : 'Order blocked'}
					</Badge>
				{/if}
				<Button
					type="button"
					class="h-11 w-full rounded-none shadow-none transition-none"
					disabled={!canPlace || placing || Boolean(receipt)}
					onclick={placeOrder}
				>
					{placing ? 'Submitting…' : 'Place simulated order'}
				</Button>
				<p class="text-xs text-muted-foreground">
					This never sends an order to a broker, exchange, or real-money account.
				</p>
			</aside>
		</div>
	{:else if data.optionsDataEnabled && data.assetView === 'options' && data.requestedSymbol}
		<div class="space-y-5">
			<div class="flex flex-col gap-3 border border-border p-4 lg:flex-row lg:items-end">
				<form method="GET" action={tradeRoute} class="flex flex-1 flex-wrap items-end gap-2">
					<input type="hidden" name="symbol" value={data.requestedSymbol} />
					<input type="hidden" name="asset" value="options" />
					<div class="min-w-52 flex-1">
						<Label for="option-expiration">Expiration</Label>
						<Input
							id="option-expiration"
							name="expiration"
							type="date"
							value={data.options.expiration ?? ''}
							required
							class="mt-2 h-11 rounded-none shadow-none"
						/>
					</div>
					<Button type="submit" variant="outline" class="h-11 rounded-none shadow-none"
						>Load chain</Button
					>
				</form>
				<p class="max-w-xl text-xs text-muted-foreground">
					{#if data.optionsTradingEnabled}
						Select one standard contract. A new selection replaces the current contract; portfolio
						permissions and long-option ownership are checked server-side.
					{:else}
						Chain data is available for research, but the configured plan clocks do not support
						option simulation.
					{/if}
				</p>
			</div>

			{#if !data.optionsTradingEnabled}
				<Alert class="rounded-none shadow-none">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>Options chain is view-only</AlertTitle>
					<AlertDescription>{data.optionsTradingReason}</AlertDescription>
				</Alert>
			{/if}

			{#if data.optionsTradingEnabled}
				<Alert class="rounded-none shadow-none">
					<CircleCheckIcon aria-hidden="true" />
					<AlertTitle>Aggregate-based simulated fills</AlertTitle>
					<AlertDescription>{data.optionsMarketData.executionDescription}</AlertDescription>
				</Alert>
			{/if}

			{#if data.options.error}
				<Alert variant="destructive" class="rounded-none shadow-none">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>Options chain unavailable</AlertTitle>
					<AlertDescription>{data.options.error}</AlertDescription>
				</Alert>
			{:else}
				<div class="overflow-x-auto">
					<OptionsChain
						rows={data.options.rows}
						expirationLabel={data.options.expiration ?? 'No expiration'}
						priceRecencyLabel={data.optionsMarketData.priceRecency}
						greeksRecencyLabel={data.optionsMarketData.greeksRecency}
						openInterestRecencyLabel={data.optionsMarketData.openInterestRecency}
						showBidAsk={data.optionsMarketData.showBidAsk}
						selectedContractIds={selectedOptionContractIds}
						onSelect={data.optionsTradingEnabled ? selectContract : undefined}
					/>
				</div>
			{/if}

			{#if data.optionsTradingEnabled}
				<section class="border border-border" aria-labelledby="option-ticket-heading">
					<header class="border-b border-border px-4 py-3">
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Options order
						</p>
						<h2 id="option-ticket-heading" class="mt-1 font-semibold">
							Single-contract limit ticket
						</h2>
					</header>
					{#if !optionLeg}
						<div class="p-4">
							<EmptyState
								title="Select a standard contract"
								description="Choose one call or put from the chain to prepare a limit order. Adjusted deliverables are view-only."
								icon={ReceiptTextIcon}
								compact
							/>
						</div>
					{:else}
						<div class="grid gap-3 p-4 md:grid-cols-[minmax(14rem,1fr)_12rem_auto] md:items-end">
							<div class="min-w-0">
								<p class="truncate font-medium">{optionLeg.contract.symbol}</p>
								<p class="text-xs text-muted-foreground">
									{optionLeg.contract.type} · {money.format(optionLeg.contract.strike)} strike · standard
									100-share deliverable
								</p>
							</div>
							<div>
								<Label for="option-action">Action</Label>
								<select
									id="option-action"
									value={optionLeg.action}
									onchange={(event) =>
										updateOptionAction(event.currentTarget.value as OptionLegSelection['action'])}
									class="mt-2 h-10 w-full rounded-none border border-input bg-background px-2 text-sm"
								>
									<option value="buy_to_open">Buy to open</option>
									<option value="sell_to_close">Sell to close</option>
								</select>
							</div>
							<Button
								type="button"
								variant="ghost"
								class="h-10 rounded-none text-destructive shadow-none"
								onclick={clearOptionLeg}>Remove</Button
							>
						</div>

						<div class="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
							<div>
								<Label for="option-quantity">Contracts</Label>
								<Input
									id="option-quantity"
									type="number"
									min="1"
									step="1"
									inputmode="numeric"
									value={optionQuantity}
									oninput={(event) => {
										optionQuantity = event.currentTarget.value;
										resetReview();
									}}
									class="mt-2 h-11 rounded-none"
								/>
							</div>
							<div>
								<Label for="option-limit">Limit price per share</Label>
								<Input
									id="option-limit"
									type="number"
									min="0.01"
									step="0.01"
									inputmode="decimal"
									value={optionLimitPrice}
									oninput={(event) => {
										optionLimitPrice = event.currentTarget.value;
										resetReview();
									}}
									class="mt-2 h-11 rounded-none"
								/>
							</div>
							<dl class="contents">
								<div>
									<dt class="text-sm font-medium">Order type</dt>
									<dd
										class="mt-2 flex h-11 items-center border border-border bg-muted px-3 text-sm"
									>
										Limit
									</dd>
								</div>
								<div>
									<dt class="text-sm font-medium">Time in force</dt>
									<dd
										class="mt-2 flex h-11 items-center border border-border bg-muted px-3 text-sm"
									>
										Day
									</dd>
								</div>
								<div>
									<dt class="text-sm font-medium">Price effect · Ratio</dt>
									<dd
										class="mt-2 flex h-11 items-center border border-border bg-muted px-3 text-sm capitalize"
									>
										{optionPriceEffect} · 1
									</dd>
								</div>
							</dl>
						</div>

						<div class="grid gap-4 border-t border-border p-4 lg:grid-cols-[1fr_auto] lg:items-end">
							<div>
								{#if preview}
									<p class="text-sm font-medium">
										{preview.accepted ? 'Risk checks passed' : 'Order blocked'} · Cash required
										{money.format(Number(preview.cashRequired))}
									</p>
									{#each preview.violations as violation (`${violation.code}-${violation.symbol ?? ''}`)}
										<p
											class={violation.severity === 'blocked'
												? 'text-sm text-destructive'
												: 'text-sm text-warning'}
										>
											{violation.message}
										</p>
									{/each}
								{:else}
									<p class="text-sm text-muted-foreground">
										Preview uses the submitted limit price, cash, buying power, long-position
										ownership, and portfolio permissions. A fill still requires a future eligible
										aggregate.
									</p>
								{/if}
							</div>
							<div class="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									class="h-11 rounded-none shadow-none"
									disabled={reviewing || Boolean(receipt)}
									onclick={requestPreview}>{reviewing ? 'Reviewing…' : 'Review order'}</Button
								>
								<Button
									type="button"
									class="h-11 rounded-none shadow-none"
									disabled={!canPlace || placing || Boolean(receipt)}
									onclick={placeOrder}>{placing ? 'Submitting…' : 'Place simulated order'}</Button
								>
							</div>
						</div>
					{/if}
				</section>
			{/if}
		</div>
	{:else if data.requestedSymbol && !data.symbolValid}
		<EmptyState
			title="Invalid US stock symbol"
			description="Use a leading letter followed by up to 14 letters, numbers, or periods."
			icon={CircleAlertIcon}
		/>
	{:else}
		<EmptyState
			title="Choose an instrument"
			description="Enter a stock symbol above or research the US market before preparing an order."
			icon={ReceiptTextIcon}
			actionLabel="Research a symbol"
			actionHref={marketsRoute}
		/>
	{/if}
</div>
