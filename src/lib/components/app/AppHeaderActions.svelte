<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SunIcon from '@lucide/svelte/icons/sun';
	import UserIcon from '@lucide/svelte/icons/user';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { mode, toggleMode } from 'mode-watcher';

	interface HeaderUser {
		email: string | null;
		displayName: string | null;
	}

	interface Props {
		user: HeaderUser;
		searchHref: string;
	}

	let { user, searchHref }: Props = $props();

	let isDark = $derived(mode.current === 'dark');
	let displayName = $derived(user.displayName ?? user.email ?? 'Account');
	let secondaryIdentity = $derived(
		user.displayName && user.email && user.displayName !== user.email ? user.email : undefined
	);
	let initial = $derived(displayName.trim().charAt(0).toLocaleUpperCase() || 'A');
	let themeLabel = $derived(isDark ? 'Switch to light theme' : 'Switch to dark theme');
</script>

<Button
	href={searchHref}
	variant="ghost"
	class="h-10 rounded-none px-2 shadow-none transition-none sm:px-3"
	aria-label="Search stocks and options"
>
	<SearchIcon class="size-4" aria-hidden="true" />
	<span class="hidden sm:inline">Search</span>
</Button>

<Button
	type="button"
	variant="ghost"
	size="icon"
	class="size-10 rounded-none shadow-none transition-none"
	onclick={toggleMode}
	aria-label={themeLabel}
	title={themeLabel}
>
	{#if isDark}
		<SunIcon class="size-4" aria-hidden="true" />
	{:else}
		<MoonIcon class="size-4" aria-hidden="true" />
	{/if}
</Button>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				class="h-10 min-w-10 rounded-none px-1.5 shadow-none transition-none sm:px-2"
				aria-label={`Open account menu for ${displayName}`}
			>
				<span
					class="grid size-7 shrink-0 place-items-center border border-border bg-muted text-xs font-semibold"
					aria-hidden="true"
				>
					{initial}
				</span>
				<span class="hidden max-w-36 truncate text-sm xl:inline">{displayName}</span>
				<ChevronDownIcon
					class="hidden size-3.5 text-muted-foreground xl:block"
					aria-hidden="true"
				/>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content
		align="end"
		sideOffset={6}
		class="w-64 rounded-none border border-border bg-popover p-0 shadow-none"
	>
		<div class="border-b border-border px-3 py-3">
			<div class="flex items-start gap-3">
				<span
					class="grid size-8 shrink-0 place-items-center border border-border bg-muted"
					aria-hidden="true"
				>
					<UserIcon class="size-4" />
				</span>
				<div class="min-w-0">
					<p class="truncate text-sm font-medium">{displayName}</p>
					{#if secondaryIdentity}
						<p class="mt-0.5 truncate text-xs text-muted-foreground">{secondaryIdentity}</p>
					{/if}
				</div>
			</div>
		</div>
		<form method="POST" action={resolve('/auth/logout')}>
			<button
				type="submit"
				class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
			>
				<LogOutIcon class="size-4" aria-hidden="true" />
				Log out
			</button>
		</form>
	</DropdownMenu.Content>
</DropdownMenu.Root>
