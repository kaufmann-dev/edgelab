<script lang="ts">
	import { ArrowLeft, CircleAlert, RefreshCw } from '@lucide/svelte';
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
</script>

<svelte:head>
	<title>{page.status} · EdgeLab</title>
</svelte:head>

<main class="grid min-h-svh place-items-center bg-background px-4 py-12 text-foreground">
	<section
		class="w-full max-w-xl border border-border bg-card p-6 sm:p-8"
		aria-labelledby="error-title"
	>
		<div class="flex items-start gap-4">
			<div
				class="grid size-11 shrink-0 place-items-center border border-negative/50 bg-negative/5 text-negative"
			>
				<CircleAlert class="size-5" aria-hidden="true" />
			</div>
			<div>
				<p class="text-sm font-medium text-muted-foreground">Error {page.status}</p>
				<h1 id="error-title" class="mt-1 text-2xl font-semibold tracking-tight">
					{page.status === 404
						? 'That page does not exist'
						: 'EdgeLab could not complete this request'}
				</h1>
				<p class="mt-3 leading-7 text-muted-foreground">
					{page.error?.message ??
						'Try the request again. If it keeps failing, check the service logs.'}
				</p>
			</div>
		</div>

		<div class="mt-8 flex flex-wrap gap-3 border-t border-border pt-5">
			<Button href="/" variant="outline" class="h-11 rounded-none">
				<ArrowLeft class="size-4" aria-hidden="true" />
				Return home
			</Button>
			<Button type="button" class="h-11 rounded-none" onclick={() => window.location.reload()}>
				<RefreshCw class="size-4" aria-hidden="true" />
				Try again
			</Button>
		</div>
	</section>
</main>
