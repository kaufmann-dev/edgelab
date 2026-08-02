<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import MarketFeedStatus from './MarketFeedStatus.svelte';
	import RiskCheckList from './RiskCheckList.svelte';
	import { formatPercent, humanize, signedCurrency, toneForNumber } from './format.js';
	import type {
		MarketFeedState,
		OrderPreviewItem,
		OrderSide,
		RiskCheck,
		StockOrderDraft,
		StockOrderDraftPatch,
		StockOrderType,
		StockQuote,
		ValueTone
	} from './types.js';

	type DraftField = keyof StockOrderDraft;

	interface Props {
		quote: StockQuote;
		draft: StockOrderDraft;
		onDraftChange: (patch: StockOrderDraftPatch) => void;
		onReview: () => void | Promise<void>;
		availableSides?: OrderSide[];
		availableOrderTypes?: StockOrderType[];
		previewItems?: OrderPreviewItem[];
		riskChecks?: RiskCheck[];
		fieldErrors?: Partial<Record<DraftField, string>>;
		errorMessage?: string;
		feedState?: MarketFeedState;
		marketSession?: string;
		feedUpdatedLabel?: string;
		currency?: string;
		locale?: string;
		reviewDisabled?: boolean;
		reviewing?: boolean;
		showBracketOrders?: boolean;
		simulationLabel?: string;
	}

	let {
		quote,
		draft,
		onDraftChange,
		onReview,
		availableSides = ['buy', 'sell', 'sell-short', 'buy-to-cover'],
		availableOrderTypes = ['market', 'limit', 'stop', 'stop-limit', 'trailing-stop'],
		previewItems = [],
		riskChecks = [],
		fieldErrors = {},
		errorMessage,
		feedState,
		marketSession,
		feedUpdatedLabel,
		currency = 'USD',
		locale = 'en-US',
		reviewDisabled = false,
		reviewing = false,
		showBracketOrders = false,
		simulationLabel = 'Simulation only · No real money'
	}: Props = $props();

	const uid = $props.id();
	let money = $derived(
		new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		})
	);

	function eventValue(event: Event) {
		return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
	}

	function describedBy(field: DraftField) {
		return fieldErrors[field] ? `${uid}-${field}-error` : undefined;
	}

	function previewToneClass(tone: ValueTone | undefined) {
		if (tone === 'positive') return 'text-emerald-700 dark:text-emerald-300';
		if (tone === 'negative') return 'text-destructive';
		if (tone === 'warning') return 'text-amber-800 dark:text-amber-300';
		if (tone === 'info') return 'text-blue-700 dark:text-blue-300';
		return 'text-foreground';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		await onReview();
	}
</script>

{#snippet fieldError(field: DraftField)}
	{#if fieldErrors[field]}
		<p id={`${uid}-${field}-error`} class="mt-1 text-xs text-destructive" role="alert">
			{fieldErrors[field]}
		</p>
	{/if}
{/snippet}

<section class="bg-background" aria-labelledby={`${uid}-heading`}>
	<header class="border-b border-border px-4 py-4">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<h2 id={`${uid}-heading`} class="truncate text-base font-semibold">{quote.symbol}</h2>
				{#if quote.name}<p class="truncate text-xs text-muted-foreground">{quote.name}</p>{/if}
			</div>
			<div class="shrink-0 text-right">
				<p class="font-semibold tabular-nums">{money.format(quote.last)}</p>
				{#if quote.change !== undefined}
					<p class={['text-xs tabular-nums', toneForNumber(quote.change)]}>
						{signedCurrency(money, quote.change)}{#if quote.changePercent !== undefined}
							({formatPercent(quote.changePercent, 2, true)}){/if}
					</p>
				{/if}
			</div>
		</div>
		<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-muted-foreground tabular-nums">
				Bid {quote.bid === undefined ? '—' : money.format(quote.bid)} · Ask {quote.ask === undefined
					? '—'
					: money.format(quote.ask)}
			</p>
			{#if feedState}
				<MarketFeedStatus
					state={feedState}
					{marketSession}
					updatedLabel={feedUpdatedLabel}
					asOf={quote.asOf}
					compact
				/>
			{:else}
				<p class="text-xs text-muted-foreground">As of {quote.asOf}</p>
			{/if}
		</div>
	</header>

	<form onsubmit={submit} class="space-y-5 px-4 py-5" novalidate>
		{#if errorMessage}
			<Alert variant="destructive" class="rounded-none shadow-none">
				<CircleAlertIcon aria-hidden="true" />
				<AlertTitle>Order cannot be reviewed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		<fieldset>
			<legend class="mb-2 text-sm font-medium">Action</legend>
			<div class="grid grid-cols-2 border-t border-l border-border" role="group">
				{#each availableSides as side (side)}
					<button
						type="button"
						class={[
							'min-h-11 border-r border-b border-border px-2 text-sm font-medium focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
							draft.side === side ? 'bg-foreground text-background' : 'bg-background hover:bg-muted'
						]}
						onclick={() => onDraftChange({ side })}
						aria-pressed={draft.side === side}
					>
						{humanize(side)}
					</button>
				{/each}
			</div>
			{@render fieldError('side')}
		</fieldset>

		<div>
			<Label for={`${uid}-order-type`}>Order type</Label>
			<select
				id={`${uid}-order-type`}
				value={draft.orderType}
				onchange={(event) => {
					const orderType = eventValue(event) as StockOrderType;
					onDraftChange({
						orderType,
						...(orderType === 'market' && draft.timeInForce === 'gtc'
							? { timeInForce: 'day' as const }
							: {}),
						...(!['market', 'limit'].includes(orderType) && draft.timeInForce === 'ioc'
							? { timeInForce: 'day' as const }
							: {}),
						...(orderType !== 'limit' && draft.session === 'extended'
							? { session: 'regular' as const }
							: {})
					});
				}}
				aria-invalid={fieldErrors.orderType ? 'true' : undefined}
				aria-describedby={describedBy('orderType')}
				class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
			>
				{#each availableOrderTypes as type (type)}
					<option value={type}>{humanize(type)}</option>
				{/each}
			</select>
			{@render fieldError('orderType')}
		</div>

		<fieldset>
			<legend class="mb-2 text-sm font-medium">Quantity type</legend>
			<div class="grid grid-cols-2">
				<button
					type="button"
					class={[
						'min-h-11 border border-border px-3 text-sm font-medium focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
						draft.quantityMode === 'shares'
							? 'bg-foreground text-background'
							: 'bg-background hover:bg-muted'
					]}
					onclick={() => onDraftChange({ quantityMode: 'shares' })}
					aria-pressed={draft.quantityMode === 'shares'}
				>
					Shares
				</button>
				<button
					type="button"
					class={[
						'min-h-11 border border-l-0 border-border px-3 text-sm font-medium focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
						draft.quantityMode === 'notional'
							? 'bg-foreground text-background'
							: 'bg-background hover:bg-muted'
					]}
					onclick={() => onDraftChange({ quantityMode: 'notional' })}
					aria-pressed={draft.quantityMode === 'notional'}
				>
					Amount
				</button>
			</div>
		</fieldset>

		<div>
			<Label for={`${uid}-quantity`}
				>{draft.quantityMode === 'shares' ? 'Shares' : 'Order amount'}</Label
			>
			<Input
				id={`${uid}-quantity`}
				name="quantity"
				type="text"
				inputmode="decimal"
				value={draft.quantity}
				oninput={(event: Event) => onDraftChange({ quantity: eventValue(event) })}
				aria-invalid={fieldErrors.quantity ? 'true' : undefined}
				aria-describedby={describedBy('quantity')}
				class="mt-2 h-11 rounded-none border-input bg-background text-right tabular-nums shadow-none transition-none"
			/>
			{@render fieldError('quantity')}
		</div>

		{#if draft.orderType === 'limit' || draft.orderType === 'stop-limit'}
			<div>
				<Label for={`${uid}-limit-price`}>Limit price</Label>
				<Input
					id={`${uid}-limit-price`}
					name="limitPrice"
					type="text"
					inputmode="decimal"
					value={draft.limitPrice}
					oninput={(event: Event) => onDraftChange({ limitPrice: eventValue(event) })}
					aria-invalid={fieldErrors.limitPrice ? 'true' : undefined}
					aria-describedby={describedBy('limitPrice')}
					class="mt-2 h-11 rounded-none border-input bg-background text-right tabular-nums shadow-none transition-none"
				/>
				{@render fieldError('limitPrice')}
			</div>
		{/if}

		{#if draft.orderType === 'stop' || draft.orderType === 'stop-limit'}
			<div>
				<Label for={`${uid}-stop-price`}>Stop price</Label>
				<Input
					id={`${uid}-stop-price`}
					name="stopPrice"
					type="text"
					inputmode="decimal"
					value={draft.stopPrice}
					oninput={(event: Event) => onDraftChange({ stopPrice: eventValue(event) })}
					aria-invalid={fieldErrors.stopPrice ? 'true' : undefined}
					aria-describedby={describedBy('stopPrice')}
					class="mt-2 h-11 rounded-none border-input bg-background text-right tabular-nums shadow-none transition-none"
				/>
				{@render fieldError('stopPrice')}
			</div>
		{/if}

		{#if draft.orderType === 'trailing-stop'}
			<div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
				<div>
					<Label for={`${uid}-trail-value`}>Trail value</Label>
					<Input
						id={`${uid}-trail-value`}
						name="trailValue"
						type="text"
						inputmode="decimal"
						value={draft.trailValue}
						oninput={(event: Event) => onDraftChange({ trailValue: eventValue(event) })}
						aria-invalid={fieldErrors.trailValue ? 'true' : undefined}
						aria-describedby={describedBy('trailValue')}
						class="mt-2 h-11 rounded-none border-input bg-background text-right tabular-nums shadow-none transition-none"
					/>
					{@render fieldError('trailValue')}
				</div>
				<div>
					<Label for={`${uid}-trail-unit`}>Unit</Label>
					<select
						id={`${uid}-trail-unit`}
						value={draft.trailUnit}
						onchange={(event) =>
							onDraftChange({ trailUnit: eventValue(event) as StockOrderDraft['trailUnit'] })}
						class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
					>
						<option value="amount">{currency}</option>
						<option value="percent">Percent</option>
					</select>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-2">
			<div>
				<Label for={`${uid}-tif`}>Time in force</Label>
				<select
					id={`${uid}-tif`}
					value={draft.timeInForce}
					onchange={(event) =>
						onDraftChange({ timeInForce: eventValue(event) as StockOrderDraft['timeInForce'] })}
					class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm uppercase outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
				>
					<option value="day">Day</option>
					{#if draft.orderType !== 'market'}<option value="gtc">GTC</option>{/if}
					{#if draft.orderType === 'market' || draft.orderType === 'limit'}
						<option value="ioc">IOC</option>
					{/if}
				</select>
			</div>
			<div>
				<Label for={`${uid}-session`}>Session</Label>
				<select
					id={`${uid}-session`}
					value={draft.session}
					onchange={(event) =>
						onDraftChange({ session: eventValue(event) as StockOrderDraft['session'] })}
					class="mt-2 h-11 w-full rounded-none border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
				>
					<option value="regular">Regular</option>
					{#if draft.orderType === 'limit'}<option value="extended">Extended</option>{/if}
				</select>
			</div>
		</div>

		{#if showBracketOrders}<details class="border border-border">
				<summary
					class="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
					>Bracket exit</summary
				>
				<div class="space-y-4 border-t border-border p-3">
					<label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
						<input
							type="checkbox"
							checked={draft.bracketEnabled}
							onchange={(event) =>
								onDraftChange({
									bracketEnabled: (event.currentTarget as HTMLInputElement).checked
								})}
							class="size-4 rounded-none border-border accent-foreground"
						/>
						Add take-profit and stop-loss exits
					</label>
					{#if draft.bracketEnabled}
						<div class="grid grid-cols-2 gap-2">
							<div>
								<Label for={`${uid}-take-profit`}>Take profit</Label>
								<Input
									id={`${uid}-take-profit`}
									name="takeProfitPrice"
									type="text"
									inputmode="decimal"
									value={draft.takeProfitPrice}
									oninput={(event: Event) => onDraftChange({ takeProfitPrice: eventValue(event) })}
									aria-invalid={fieldErrors.takeProfitPrice ? 'true' : undefined}
									aria-describedby={describedBy('takeProfitPrice')}
									class="mt-2 h-11 rounded-none border-input bg-background text-right tabular-nums shadow-none transition-none"
								/>
								{@render fieldError('takeProfitPrice')}
							</div>
							<div>
								<Label for={`${uid}-stop-loss`}>Stop loss</Label>
								<Input
									id={`${uid}-stop-loss`}
									name="stopLossPrice"
									type="text"
									inputmode="decimal"
									value={draft.stopLossPrice}
									oninput={(event: Event) => onDraftChange({ stopLossPrice: eventValue(event) })}
									aria-invalid={fieldErrors.stopLossPrice ? 'true' : undefined}
									aria-describedby={describedBy('stopLossPrice')}
									class="mt-2 h-11 rounded-none border-input bg-background text-right tabular-nums shadow-none transition-none"
								/>
								{@render fieldError('stopLossPrice')}
							</div>
						</div>
					{/if}
				</div>
			</details>{/if}

		{#if previewItems.length > 0}
			<dl class="divide-y divide-border border border-border">
				{#each previewItems as item (item.id)}
					<div class="flex items-baseline justify-between gap-4 px-3 py-2.5 text-sm">
						<dt class="text-muted-foreground">{item.label}</dt>
						<dd class={['text-right font-medium tabular-nums', previewToneClass(item.tone)]}>
							{item.value}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}

		{#if riskChecks.length > 0}<RiskCheckList checks={riskChecks} compact />{/if}

		<div class="space-y-2 border-t border-border pt-4">
			<Button
				type="submit"
				size="lg"
				class="h-11 w-full rounded-none shadow-none transition-none"
				disabled={reviewDisabled || reviewing}
			>
				{reviewing ? 'Preparing review…' : 'Review order'}
			</Button>
			<p class="text-center text-xs text-muted-foreground">{simulationLabel}</p>
		</div>
	</form>
</section>
