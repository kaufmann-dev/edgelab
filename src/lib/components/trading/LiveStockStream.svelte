<script lang="ts">
	import Decimal from 'decimal.js';
	import { onMount } from 'svelte';
	import type { MarketFeedState, StockQuote } from './types.js';

	interface Props {
		initialQuote: StockQuote;
		delayed: boolean;
		events: readonly string[];
		onQuote: (quote: StockQuote) => void;
		onFeedState: (state: MarketFeedState) => void;
	}

	let { initialQuote, delayed, events, onQuote, onFeedState }: Props = $props();

	onMount(() => {
		let current = initialQuote;
		const source = new EventSource(
			`/api/market/stream?assetClass=stocks&symbols=${encodeURIComponent(initialQuote.symbol)}&events=${encodeURIComponent(events.join(','))}`
		);
		onFeedState('connecting');

		source.addEventListener('status', (event) => {
			try {
				const status = JSON.parse((event as MessageEvent<string>).data) as { state?: string };
				if (status.state === 'authenticated') onFeedState(delayed ? 'delayed' : 'live');
				else if (status.state === 'closed' || status.state === 'error') {
					onFeedState('reconnecting');
				} else if (status.state === 'connecting' || status.state === 'connected') {
					onFeedState('connecting');
				}
			} catch {
				onFeedState('offline');
			}
		});

		source.addEventListener('market', (event) => {
			try {
				const marketEvent = JSON.parse((event as MessageEvent<string>).data) as {
					kind?: string;
					symbol?: string;
					bidPrice?: string;
					askPrice?: string;
					price?: string;
					close?: string;
					sourceTime?: string;
					endTime?: string;
				};
				if (marketEvent.symbol !== initialQuote.symbol) return;
				if (marketEvent.kind === 'quote' && marketEvent.bidPrice && marketEvent.askPrice) {
					const bid = new Decimal(marketEvent.bidPrice);
					const ask = new Decimal(marketEvent.askPrice);
					current = {
						...current,
						bid: bid.toNumber(),
						ask: ask.toNumber(),
						last: bid.plus(ask).div(2).toNumber(),
						asOf: marketEvent.sourceTime ?? current.asOf
					};
				} else if (marketEvent.kind === 'trade' && marketEvent.price) {
					current = {
						...current,
						last: new Decimal(marketEvent.price).toNumber(),
						asOf: marketEvent.sourceTime ?? current.asOf
					};
				} else if (marketEvent.kind === 'bar' && marketEvent.close) {
					current = {
						...current,
						last: new Decimal(marketEvent.close).toNumber(),
						bid: undefined,
						ask: undefined,
						asOf: marketEvent.endTime ?? marketEvent.sourceTime ?? current.asOf
					};
				} else {
					return;
				}
				onQuote(current);
				onFeedState(delayed ? 'delayed' : 'live');
			} catch {
				onFeedState('stale');
			}
		});

		source.onerror = () => onFeedState('reconnecting');
		return () => source.close();
	});
</script>
