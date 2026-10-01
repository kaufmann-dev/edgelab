<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChartCandlestickIcon from '@lucide/svelte/icons/chart-candlestick';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ModeWatcher } from 'mode-watcher';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Sign in · EdgeLab</title>
	<meta name="description" content="Sign in to EdgeLab to access your paper-trading portfolios." />
</svelte:head>

<ModeWatcher disableTransitions />

<main class="grid min-h-svh place-items-center bg-background px-4 py-10 text-foreground sm:px-6">
	<section class="w-full max-w-md border border-border bg-card" aria-labelledby="login-title">
		<header class="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5">
			<div class="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
				<ChartCandlestickIcon class="size-5 shrink-0" aria-hidden="true" />
				<span class="truncate">EdgeLab</span>
			</div>
			<span class="shrink-0 text-xs text-muted-foreground">Paper trading</span>
		</header>

		<div class="p-6 sm:p-8">
			<div class="grid size-11 place-items-center border border-border bg-muted">
				<ShieldCheckIcon class="size-5 text-muted-foreground" aria-hidden="true" />
			</div>

			<h1 id="login-title" class="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
				Sign in to EdgeLab
			</h1>

			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				Continue through the configured identity provider to access your paper-trading workspace.
			</p>

			<form method="GET" action={resolve('auth/login/start')} class="mt-7">
				<input type="hidden" name="returnTo" value={data.returnTo} />

				<Button type="submit" class="h-11 w-full rounded-none px-4 shadow-none transition-none">
					Sign in
					<ArrowRightIcon class="size-4" aria-hidden="true" />
				</Button>
			</form>
		</div>

		<footer class="border-t border-border px-5 py-4 text-xs text-muted-foreground">
			Simulation only · No real money
		</footer>
	</section>
</main>
