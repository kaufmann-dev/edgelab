<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { applyAction, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { OrdersTable } from '$lib/components/trading';
	import type { OrderRow } from '$lib/components/trading';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import type { PageProps } from './$types';

	type CancelSuccess = { canceledOrderId: string };
	type CancelFailure = { cancelError: string };

	let { data }: PageProps = $props();
	let pendingOrderId = $state<string | undefined>();
	let cancelError = $state<string | null>(null);
	let cancelNotice = $state<string | null>(null);

	let tradeRoute = $derived(resolve('/p/[portfolioId]/trade', { portfolioId: data.portfolio.id }));

	async function cancelOrder(order: OrderRow): Promise<void> {
		if (pendingOrderId) return;

		pendingOrderId = order.id;
		cancelError = null;
		cancelNotice = null;

		const formData = new FormData();
		formData.set('orderId', order.id);

		try {
			const response = await fetch('?/cancel', { method: 'POST', body: formData });
			const result = deserialize<CancelSuccess, CancelFailure>(await response.text());

			if (result.type === 'failure') {
				cancelError = result.data?.cancelError ?? 'The order could not be canceled.';
			}

			await applyAction(result);
			if (result.type === 'success') {
				cancelNotice = 'The order was canceled.';
				await invalidateAll();
			}
		} catch {
			cancelError =
				'The cancellation request could not be completed. Check your connection and retry.';
		} finally {
			pendingOrderId = undefined;
		}
	}
</script>

<svelte:head><title>Orders · EdgeLab</title></svelte:head>

<div class="mx-auto w-full max-w-[100rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">Orders</h1>
		<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
			Track working, filled, canceled, expired, and rejected simulated orders.
		</p>
	</header>

	{#if cancelError}
		<Alert variant="destructive" class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Order not canceled</AlertTitle>
			<AlertDescription>{cancelError}</AlertDescription>
		</Alert>
	{:else if cancelNotice}
		<Alert class="rounded-none shadow-none">
			<ShieldCheckIcon aria-hidden="true" />
			<AlertTitle>Order updated</AlertTitle>
			<AlertDescription>{cancelNotice}</AlertDescription>
		</Alert>
	{:else if pendingOrderId}
		<div
			class="flex min-h-11 items-center gap-2 border border-border px-4 py-2 text-sm text-muted-foreground"
			role="status"
			aria-live="polite"
		>
			<Clock3Icon class="size-4" aria-hidden="true" />
			Cancellation in progress…
		</div>
	{/if}

	<OrdersTable
		orders={data.orders}
		onCancel={cancelOrder}
		{pendingOrderId}
		emptyActionLabel="Open an order ticket"
		emptyActionHref={tradeRoute}
	/>
</div>
