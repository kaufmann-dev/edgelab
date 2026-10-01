<script lang="ts">
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { EmptyState } from '#lib/components/trading/index.js';
</script>

<svelte:head><title>Settings · EdgeLab</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Identity is managed by the configured OpenID Connect provider.
		</p>
	</header>
	<EmptyState
		title="Security is centrally managed"
		description="Profile details, sign-in policy, and multi-factor authentication are controlled by your identity provider. Market data credentials remain server-side."
		icon={ShieldCheckIcon}
	/>
</div>
