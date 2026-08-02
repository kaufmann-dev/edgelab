<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChartCandlestickIcon from '@lucide/svelte/icons/chart-candlestick';
	import CircleDollarSignIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import { resolve } from '$app/paths';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { createPortfolioSchema } from '$lib/domain/forms';
	import { Control, Description, Field, FieldErrors, Label } from 'formsnap';
	import { untrack } from 'svelte';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const form = superForm(
		untrack(() => data.form),
		{
			validators: zod4Client(createPortfolioSchema),
			resetForm: false
		}
	);
	const { form: formData, enhance, submitting } = form;
	let acknowledged = $state(false);

	function attachEnhance(formElement: HTMLFormElement) {
		const action = enhance(formElement);
		return action?.destroy;
	}

	function dataModeLabel(mode: string): string {
		return mode === 'realtime' ? 'Real-time' : '15-minute delayed';
	}

	function accountTypeLabel(accountType: string): string {
		return accountType === 'margin' ? 'Margin' : 'Cash';
	}

	function riskBehaviorLabel(behavior: string): string {
		return behavior === 'warn' ? 'Warn only' : 'Block the order';
	}
</script>

<svelte:head>
	<title>New portfolio · EdgeLab</title>
	<meta
		name="description"
		content="Configure an isolated paper-trading portfolio with explicit permissions and risk controls."
	/>
</svelte:head>

<main class="min-h-svh bg-background text-foreground">
	<header class="border-b border-border">
		<div class="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
			<a href={resolve('/')} class="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
				<ChartCandlestickIcon class="size-5 shrink-0" aria-hidden="true" />
				<span class="truncate">EdgeLab</span>
			</a>
			<span class="text-xs text-muted-foreground">Simulation only · No real money</span>
		</div>
	</header>

	<div class="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-10">
		<a
			href={resolve('/portfolios')}
			class="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		>
			<ArrowLeftIcon class="size-4" aria-hidden="true" />
			All portfolios
		</a>

		<div class="mt-4 border-b border-border pb-7">
			<p class="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
				New simulation
			</p>
			<h1 class="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Set your trading rules</h1>
			<p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
				Capital, permissions, and risk limits stay isolated to this portfolio. You can create
				another portfolio later for a different strategy.
			</p>
		</div>

		<div class="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:gap-12">
			<form method="POST" {@attach attachEnhance} class="min-w-0 space-y-8">
				<section class="border border-border bg-card" aria-labelledby="portfolio-basics-title">
					<div class="flex items-start gap-3 border-b border-border p-5">
						<CircleDollarSignIcon class="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
						<div>
							<h2 id="portfolio-basics-title" class="text-base font-semibold">Portfolio setup</h2>
							<p class="mt-1 text-sm text-muted-foreground">
								Name the account and choose its market-data clock.
							</p>
						</div>
					</div>

					<div class="grid gap-6 p-5 sm:grid-cols-2">
						<Field {form} name="name">
							<div class="space-y-2 sm:col-span-2">
								<Control>
									{#snippet children({ props })}
										<Label>Portfolio name</Label>
										<Input
											{...props}
											bind:value={$formData.name}
											placeholder="Growth practice"
											autocomplete="off"
											class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<Description class="text-xs text-muted-foreground"
									>Use a name that identifies the strategy or goal.</Description
								>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="startingCapital">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Starting capital</Label>
										<div class="relative mt-2">
											<span
												class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
												>$</span
											>
											<Input
												{...props}
												type="number"
												bind:value={$formData.startingCapital}
												min="1000"
												max="100000000"
												step="100"
												class="h-11 rounded-none border-border bg-background pl-7 shadow-none transition-none"
											/>
										</div>
									{/snippet}
								</Control>
								<Description class="text-xs text-muted-foreground"
									>Between $1,000 and $100 million.</Description
								>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="benchmarkSymbol">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Benchmark</Label>
										<Input
											{...props}
											bind:value={$formData.benchmarkSymbol}
											placeholder="SPY"
											autocomplete="off"
											class="mt-2 h-11 rounded-none border-border bg-background uppercase shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<Description class="text-xs text-muted-foreground"
									>Used to compare portfolio performance.</Description
								>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="accountType">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Account type</Label>
										<Select.Root type="single" name={props.name} bind:value={$formData.accountType}>
											<Select.Trigger
												{...props}
												class="mt-2 h-11 w-full rounded-none border-border bg-background shadow-none transition-none"
											>
												{accountTypeLabel($formData.accountType)}
											</Select.Trigger>
											<Select.Content class="rounded-none shadow-none">
												<Select.Item value="cash" class="rounded-none">Cash</Select.Item>
												<Select.Item value="margin" class="rounded-none">Margin</Select.Item>
											</Select.Content>
										</Select.Root>
									{/snippet}
								</Control>
								<Description class="text-xs text-muted-foreground"
									>Margin is required to practice short selling.</Description
								>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="dataMode">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Market data</Label>
										<input {...props} type="hidden" bind:value={$formData.dataMode} />
										<div
											class="mt-2 flex h-11 w-full items-center border border-border bg-muted px-3 text-sm font-medium"
										>
											{dataModeLabel(data.supportedDataMode)}
										</div>
									{/snippet}
								</Control>
								<Description class="text-xs text-muted-foreground"
									>This clock is fixed by the connected Massive stock {data.optionsTradingEnabled
										? 'and option plans'
										: 'plan'}.</Description
								>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>
					</div>
				</section>

				<section class="border border-border bg-card" aria-labelledby="permissions-title">
					<div class="flex items-start gap-3 border-b border-border p-5">
						<ShieldCheckIcon class="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
						<div>
							<h2 id="permissions-title" class="text-base font-semibold">Trading permissions</h2>
							<p class="mt-1 text-sm text-muted-foreground">
								Enable only the instruments and sessions you intend to practice.
							</p>
						</div>
					</div>

					<div class="grid gap-px bg-border sm:grid-cols-2">
						<Field {form} name="allowShortEquity">
							<div class="bg-card p-5">
								<div class="flex items-start gap-3">
									<Control>
										{#snippet children({ props })}
											<Checkbox
												{...props}
												bind:checked={$formData.allowShortEquity}
												class="mt-0.5 rounded-none transition-none"
											/>
											<div>
												<Label>Short equities</Label>
												<Description class="mt-1 text-xs leading-5 text-muted-foreground"
													>Practice opening short stock positions. Requires margin.</Description
												>
											</div>
										{/snippet}
									</Control>
								</div>
								<FieldErrors class="mt-2 text-xs text-destructive" />
							</div>
						</Field>

						{#if data.optionsTradingEnabled}
							<Field {form} name="allowLongOptions">
								<div class="bg-card p-5">
									<div class="flex items-start gap-3">
										<Control>
											{#snippet children({ props })}
												<Checkbox
													{...props}
													bind:checked={$formData.allowLongOptions}
													class="mt-0.5 rounded-none transition-none"
												/>
												<div>
													<Label>Long options</Label>
													<Description class="mt-1 text-xs leading-5 text-muted-foreground"
														>Buy one standard call or put to open and sell an existing long contract
														to close. Expiration-day orders are unavailable.</Description
													>
												</div>
											{/snippet}
										</Control>
									</div>
									<FieldErrors class="mt-2 text-xs text-destructive" />
								</div>
							</Field>
						{/if}

						<Field {form} name="allowExtendedHours">
							<div class="bg-card p-5">
								<div class="flex items-start gap-3">
									<Control>
										{#snippet children({ props })}
											<Checkbox
												{...props}
												bind:checked={$formData.allowExtendedHours}
												class="mt-0.5 rounded-none transition-none"
											/>
											<div>
												<Label>Extended hours</Label>
												<Description class="mt-1 text-xs leading-5 text-muted-foreground"
													>Allow eligible stock limit orders outside the regular session.</Description
												>
											</div>
										{/snippet}
									</Control>
								</div>
								<FieldErrors class="mt-2 text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="requireTradePlan">
							<div class="bg-card p-5">
								<div class="flex items-start gap-3">
									<Control>
										{#snippet children({ props })}
											<Checkbox
												{...props}
												bind:checked={$formData.requireTradePlan}
												class="mt-0.5 rounded-none transition-none"
											/>
											<div>
												<Label>Require a trade plan</Label>
												<Description class="mt-1 text-xs leading-5 text-muted-foreground"
													>Require a written thesis before an opening order.</Description
												>
											</div>
										{/snippet}
									</Control>
								</div>
								<FieldErrors class="mt-2 text-xs text-destructive" />
							</div>
						</Field>
					</div>
				</section>

				<section class="border border-border bg-card" aria-labelledby="risk-limits-title">
					<div class="flex items-start gap-3 border-b border-border p-5">
						<GaugeIcon class="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
						<div>
							<h2 id="risk-limits-title" class="text-base font-semibold">Risk limits</h2>
							<p class="mt-1 text-sm text-muted-foreground">
								Leave a limit blank when you do not want that rule applied.
							</p>
						</div>
					</div>

					<div class="grid gap-6 p-5 sm:grid-cols-2">
						<Field {form} name="maxOrderNotional">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Max order notional</Label>
										<Input
											{...props}
											type="number"
											bind:value={$formData.maxOrderNotional}
											min="0"
											step="1"
											placeholder="No limit"
											class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="maxPositionPercent">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Max position size (%)</Label>
										<Input
											{...props}
											type="number"
											bind:value={$formData.maxPositionPercent}
											min="0"
											max="100"
											step="0.1"
											placeholder="No limit"
											class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="maxGrossExposurePercent">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Max gross exposure (%)</Label>
										<Input
											{...props}
											type="number"
											bind:value={$formData.maxGrossExposurePercent}
											min="0"
											max="100"
											step="0.1"
											placeholder="No limit"
											class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="maxDailyLoss">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Max daily loss</Label>
										<Input
											{...props}
											type="number"
											bind:value={$formData.maxDailyLoss}
											min="0"
											step="1"
											placeholder="No limit"
											class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						<Field {form} name="maxDrawdownPercent">
							<div class="space-y-2">
								<Control>
									{#snippet children({ props })}
										<Label>Max drawdown (%)</Label>
										<Input
											{...props}
											type="number"
											bind:value={$formData.maxDrawdownPercent}
											min="0"
											max="100"
											step="0.1"
											placeholder="No limit"
											class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
										/>
									{/snippet}
								</Control>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>

						{#if data.optionsTradingEnabled}
							<Field {form} name="maxOptionPremium">
								<div class="space-y-2">
									<Control>
										{#snippet children({ props })}
											<Label>Max option premium</Label>
											<Input
												{...props}
												type="number"
												bind:value={$formData.maxOptionPremium}
												min="0"
												step="1"
												placeholder="No limit"
												class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
											/>
										{/snippet}
									</Control>
									<FieldErrors class="text-xs text-destructive" />
								</div>
							</Field>
						{/if}

						<Field {form} name="riskBehavior">
							<div class="space-y-2 sm:col-span-2">
								<Control>
									{#snippet children({ props })}
										<Label>When a limit is reached</Label>
										<Select.Root
											type="single"
											name={props.name}
											bind:value={$formData.riskBehavior}
										>
											<Select.Trigger
												{...props}
												class="mt-2 h-11 w-full rounded-none border-border bg-background shadow-none transition-none"
											>
												{riskBehaviorLabel($formData.riskBehavior)}
											</Select.Trigger>
											<Select.Content class="rounded-none shadow-none">
												<Select.Item value="block" class="rounded-none">Block the order</Select.Item
												>
												<Select.Item value="warn" class="rounded-none">Warn only</Select.Item>
											</Select.Content>
										</Select.Root>
									{/snippet}
								</Control>
								<Description class="text-xs text-muted-foreground"
									>Blocking prevents submission; warning keeps the violation visible.</Description
								>
								<FieldErrors class="text-xs text-destructive" />
							</div>
						</Field>
					</div>
				</section>

				<section class="border border-border bg-card p-5" aria-labelledby="confirmation-title">
					<Field {form} name="acknowledgeSimulation">
						<div>
							<div class="flex items-start gap-3">
								<Control>
									{#snippet children({ props })}
										<Checkbox
											{...props}
											bind:checked={acknowledged}
											class="mt-0.5 rounded-none transition-none"
										/>
										<div>
											<Label id="confirmation-title">I understand this is a simulation</Label>
											<Description class="mt-1 text-sm leading-6 text-muted-foreground"
												>Orders use simulated funds and cannot buy or sell real securities.</Description
											>
										</div>
									{/snippet}
								</Control>
							</div>
							<FieldErrors class="mt-2 text-xs text-destructive" />
						</div>
					</Field>
				</section>

				<div
					class="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-end"
				>
					<Button
						href={resolve('/portfolios')}
						variant="outline"
						class="h-11 rounded-none px-5 shadow-none transition-none">Cancel</Button
					>
					<Button
						type="submit"
						disabled={$submitting}
						class="h-11 rounded-none px-5 shadow-none transition-none"
					>
						{$submitting ? 'Creating portfolio…' : 'Create portfolio'}
						<ArrowRightIcon class="size-4" aria-hidden="true" />
					</Button>
				</div>
			</form>

			<aside
				class="border border-border bg-card lg:sticky lg:top-6"
				aria-labelledby="configuration-summary-title"
			>
				<div class="border-b border-border p-5">
					<div class="flex items-center gap-2">
						<SlidersHorizontalIcon class="size-4 text-muted-foreground" aria-hidden="true" />
						<h2 id="configuration-summary-title" class="text-sm font-semibold">How setup works</h2>
					</div>
				</div>
				<ol class="divide-y divide-border text-sm">
					<li class="grid grid-cols-[1.5rem_1fr] gap-3 p-5">
						<span class="font-mono text-xs text-muted-foreground">01</span>
						<div>
							<p class="font-medium">Capital is journaled</p>
							<p class="mt-1 leading-5 text-muted-foreground">
								Your opening cash is recorded as the first immutable ledger entry.
							</p>
						</div>
					</li>
					<li class="grid grid-cols-[1.5rem_1fr] gap-3 p-5">
						<span class="font-mono text-xs text-muted-foreground">02</span>
						<div>
							<p class="font-medium">Rules stay attached</p>
							<p class="mt-1 leading-5 text-muted-foreground">
								Permissions and risk limits are stored with this portfolio.
							</p>
						</div>
					</li>
					<li class="grid grid-cols-[1.5rem_1fr] gap-3 p-5">
						<span class="font-mono text-xs text-muted-foreground">03</span>
						<div>
							<p class="font-medium">Nothing reaches a broker</p>
							<p class="mt-1 leading-5 text-muted-foreground">
								Every fill, position, and P&amp;L figure belongs to the simulator.
							</p>
						</div>
					</li>
				</ol>
			</aside>
		</div>
	</div>
</main>
