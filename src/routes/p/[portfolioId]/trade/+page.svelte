<script lang="ts">
	import Decimal from 'decimal.js';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import LayersIcon from '@lucide/svelte/icons/layers';
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
		side: 'buy' | 'sell';
		positionEffect: 'open' | 'close';
		ratioQuantity: number;
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
	let stockDraft = $state<StockOrderDraft>({ ...EMPTY_DRAFT });
	let optionLegs = $state<OptionLegSelection[]>([]);
	let optionQuantity = $state('1');
	let optionOrderType = $state<'market' | 'limit'>('limit');
	let optionLimitPrice = $state('');
	let optionNetEffect = $state<'debit' | 'credit'>('debit');
	let optionTimeInForce = $state<'day' | 'gtc' | 'ioc'>('day');
	let selectedTradePlanId = $state('');
	let preview = $state<SerializedPreview | null>(null);
	let ticketError = $state<string | null>(null);
	let reviewing = $state(false);
	let placing = $state(false);
	let reviewedPayload = $state<string | null>(null);
	let receipt = $state<{
		id: string;
		status: string;
		filledQuantity: string;
		quantity: string;
	} | null>(null);
	let clientOrderId = $state(crypto.randomUUID());
	let streamedQuote = $state<StockQuote | null>(null);
	let streamedFeed = $state<{ symbol: string; state: MarketFeedState } | null>(null);

	const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
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
	let stockTabPath = $derived(
		`${tradeRoute}?symbol=${encodeURIComponent(data.requestedSymbol)}&asset=stock` as Pathname
	);
	let optionsTabPath = $derived(
		`${tradeRoute}?symbol=${encodeURIComponent(data.requestedSymbol)}&asset=options` as Pathname
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
					detail: 'Buying power, permissions, quote freshness, and configured limits passed.'
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
		if (!displayedQuote) throw new Error('A provider quote is required.');
		let enteredQuantity: Decimal;
		try {
			enteredQuantity = new Decimal(stockDraft.quantity);
		} catch {
			throw new Error('Enter a quantity greater than zero.');
		}
		if (!enteredQuantity.isFinite() || !enteredQuantity.greaterThan(0)) {
			throw new Error('Enter a quantity greater than zero.');
		}
		const referencePrice = new Decimal(displayedQuote.ask ?? displayedQuote.last);
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
		if (optionLegs.length === 0) throw new Error('Add at least one option contract.');
		let quantity: Decimal;
		try {
			quantity = new Decimal(optionQuantity);
		} catch {
			throw new Error('Strategy quantity must be a positive whole number.');
		}
		if (!quantity.isInteger() || !quantity.greaterThan(0)) {
			throw new Error('Strategy quantity must be a positive whole number.');
		}
		if (optionOrderType === 'limit' && !(Number(optionLimitPrice) > 0)) {
			throw new Error('Enter a positive net limit price.');
		}
		return {
			portfolioId: data.portfolio.id,
			tradePlanId: selectedTradePlanId || undefined,
			clientOrderId,
			type: optionOrderType,
			timeInForce: optionTimeInForce,
			quantity: quantity.toString(),
			limitPrice: optionOrderType === 'limit' ? optionLimitPrice : undefined,
			netPriceEffect: optionNetEffect,
			extendedHours: false,
			legs: optionLegs.map((leg) => ({
				symbol: leg.contract.symbol,
				side: leg.side,
				positionEffect: leg.positionEffect,
				ratioQuantity: String(leg.ratioQuantity)
			}))
		};
	}

	function currentPayload() {
		return data.assetView === 'options' ? optionPayload() : stockPayload();
	}

	async function requestPreview() {
		reviewing = true;
		ticketError = null;
		let submittedPayload: string | null = null;
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
			if (currentPayloadKey !== submittedPayload) return;
			preview = result.preview;
			reviewedPayload = submittedPayload;
		} catch (cause) {
			if (submittedPayload === null || currentPayloadKey === submittedPayload) {
				ticketError = cause instanceof Error ? cause.message : 'Preview failed.';
			}
		} finally {
			reviewing = false;
		}
	}

	async function placeOrder() {
		if (!canPlace || currentPayloadKey === null) return;
		const submittedPayload = JSON.stringify(currentPayload());
		if (submittedPayload !== reviewedPayload) return;
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
				if (result.preview && currentPayloadKey === submittedPayload) {
					preview = result.preview;
					reviewedPayload = submittedPayload;
				}
				throw new Error(result.error ?? 'Order placement failed.');
			}
			receipt = result.order;
		} catch (cause) {
			if (currentPayloadKey === submittedPayload) {
				ticketError = cause instanceof Error ? cause.message : 'Order placement failed.';
			}
		} finally {
			placing = false;
		}
	}

	function toggleContract(contract: OptionContractQuote) {
		const existing = optionLegs.findIndex((leg) => leg.contract.id === contract.id);
		if (existing >= 0) optionLegs.splice(existing, 1);
		else if (optionLegs.length < 4) {
			optionLegs.push({ contract, side: 'buy', positionEffect: 'open', ratioQuantity: 1 });
		}
		resetReview();
	}

	function updateOptionLeg(index: number, patch: Partial<Omit<OptionLegSelection, 'contract'>>) {
		optionLegs[index] = { ...optionLegs[index], ...patch };
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

	{#if data.requestedSymbol && data.symbolValid}
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

	{#if ticketError || data.marketError}
		<Alert variant="destructive" class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Order ticket unavailable</AlertTitle>
			<AlertDescription>{ticketError ?? data.marketError}</AlertDescription>
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
					availableSides={data.policy?.allowShortEquity
						? ['buy', 'sell', 'sell-short', 'buy-to-cover']
						: ['buy', 'sell']}
					{previewItems}
					{riskChecks}
					errorMessage={ticketError ?? undefined}
					feedState={displayedFeedState}
					marketSession={data.marketFeed?.modeLabel}
					feedUpdatedLabel="Provider timestamp"
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
						<dd class="font-medium">{data.portfolio.dataMode}</dd>
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
	{:else if data.assetView === 'options' && data.requestedSymbol}
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
					Up to four legs. Naked options are always blocked; portfolio permissions and collateral
					are checked server-side.
				</p>
			</div>

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
						selectedContractIds={optionLegs.map((leg) => leg.contract.id)}
						onSelect={toggleContract}
					/>
				</div>
			{/if}

			<section class="border border-border" aria-labelledby="strategy-ticket-heading">
				<header class="border-b border-border px-4 py-3">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Strategy</p>
					<h2 id="strategy-ticket-heading" class="mt-1 font-semibold">Selected option legs</h2>
				</header>
				{#if optionLegs.length === 0}
					<div class="p-4">
						<EmptyState
							title="Add contracts from the chain"
							description="Choose calls or puts, then set each leg’s side, position effect, and ratio."
							icon={LayersIcon}
							compact
						/>
					</div>
				{:else}
					<div class="divide-y divide-border">
						{#each optionLegs as leg, index (leg.contract.id)}
							<div
								class="grid gap-3 p-4 md:grid-cols-[minmax(14rem,1fr)_10rem_10rem_7rem_auto] md:items-end"
							>
								<div class="min-w-0">
									<p class="truncate font-medium">{leg.contract.symbol}</p>
									<p class="text-xs text-muted-foreground">
										{leg.contract.type} · {money.format(leg.contract.strike)} strike
									</p>
								</div>
								<div>
									<Label for={`option-side-${index}`}>Side</Label>
									<select
										id={`option-side-${index}`}
										value={leg.side}
										onchange={(event) =>
											updateOptionLeg(index, {
												side: event.currentTarget.value as 'buy' | 'sell'
											})}
										class="mt-2 h-10 w-full rounded-none border border-input bg-background px-2 text-sm"
									>
										<option value="buy">Buy</option><option value="sell">Sell</option>
									</select>
								</div>
								<div>
									<Label for={`option-effect-${index}`}>Effect</Label>
									<select
										id={`option-effect-${index}`}
										value={leg.positionEffect}
										onchange={(event) =>
											updateOptionLeg(index, {
												positionEffect: event.currentTarget.value as 'open' | 'close'
											})}
										class="mt-2 h-10 w-full rounded-none border border-input bg-background px-2 text-sm"
									>
										<option value="open">Open</option><option value="close">Close</option>
									</select>
								</div>
								<div>
									<Label for={`option-ratio-${index}`}>Ratio</Label>
									<Input
										id={`option-ratio-${index}`}
										type="number"
										min="1"
										max="100"
										value={leg.ratioQuantity}
										oninput={(event) =>
											updateOptionLeg(index, { ratioQuantity: Number(event.currentTarget.value) })}
										class="mt-2 h-10 rounded-none shadow-none"
									/>
								</div>
								<Button
									type="button"
									variant="ghost"
									class="h-10 rounded-none text-destructive shadow-none"
									onclick={() => toggleContract(leg.contract)}>Remove</Button
								>
							</div>
						{/each}
					</div>

					<div class="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
						<div>
							<Label for="option-quantity">Strategies</Label>
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
							<Label for="option-order-type">Order type</Label>
							<select
								id="option-order-type"
								value={optionOrderType}
								onchange={(event) => {
									optionOrderType = event.currentTarget.value as 'market' | 'limit';
									if (optionOrderType === 'market' && optionTimeInForce === 'gtc') {
										optionTimeInForce = 'day';
									}
									resetReview();
								}}
								class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm"
							>
								<option value="limit">Net limit</option><option value="market">Market</option>
							</select>
						</div>
						{#if optionOrderType === 'limit'}
							<div>
								<Label for="option-limit">Net price</Label>
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
							<div>
								<Label for="option-effect">Net effect</Label>
								<select
									id="option-effect"
									value={optionNetEffect}
									onchange={(event) => {
										optionNetEffect = event.currentTarget.value as 'debit' | 'credit';
										resetReview();
									}}
									class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm"
								>
									<option value="debit">Debit</option><option value="credit">Credit</option>
								</select>
							</div>
						{/if}
						<div>
							<Label for="option-tif">Time in force</Label>
							<select
								id="option-tif"
								value={optionTimeInForce}
								onchange={(event) => {
									optionTimeInForce = event.currentTarget.value as 'day' | 'gtc' | 'ioc';
									resetReview();
								}}
								class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm"
							>
								<option value="day">Day</option>
								{#if optionOrderType === 'limit'}<option value="gtc">GTC</option>{/if}
								<option value="ioc">IOC</option>
							</select>
						</div>
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
									Preview uses current leg quotes, collateral, buying power, and permissions.
								</p>
							{/if}
						</div>
						<div class="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								class="h-11 rounded-none shadow-none"
								disabled={reviewing || Boolean(receipt)}
								onclick={requestPreview}>{reviewing ? 'Reviewing…' : 'Review strategy'}</Button
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
