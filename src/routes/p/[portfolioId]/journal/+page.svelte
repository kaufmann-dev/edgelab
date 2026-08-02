<script lang="ts">
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { EmptyState } from '$lib/components/trading';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { journalEntrySchema } from '$lib/domain/forms';
	import { Control, Description, Field, FieldErrors, Label } from 'formsnap';
	import { untrack } from 'svelte';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();
	let tagsText = $state(untrack(() => data.form.data.tags.join(', ')));

	const form = superForm(
		untrack(() => data.form),
		{
			validators: zod4Client(journalEntrySchema),
			resetForm: true,
			onUpdated({ form: updatedForm }) {
				if (updatedForm.valid && updatedForm.message) tagsText = '';
			}
		}
	);
	const { form: formData, enhance, message: formMessage, submitting } = form;

	const entryDateFormatter = new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC'
	});

	let deleteError = $derived(
		actionData && 'deleteError' in actionData ? actionData.deleteError : null
	);
	let deletedEntryId = $derived(
		actionData && 'deletedEntryId' in actionData ? actionData.deletedEntryId : null
	);

	function attachEnhance(formElement: HTMLFormElement) {
		const action = enhance(formElement);
		return action?.destroy;
	}

	function phaseLabel(phase: string) {
		if (phase === 'pre_trade') return 'Pre-trade';
		if (phase === 'post_trade') return 'Post-trade';
		return 'General';
	}

	function followedPlanValue(value: boolean | undefined) {
		if (value === true) return 'yes';
		if (value === false) return 'no';
		return 'not_recorded';
	}

	function followedPlanLabel(value: boolean | undefined) {
		if (value === true) return 'Yes';
		if (value === false) return 'No';
		return 'Not recorded';
	}

	function updateFollowedPlan(value: string) {
		$formData.followedPlan = value === 'yes' ? true : value === 'no' ? false : undefined;
	}

	function updateTags(event: Event) {
		tagsText = (event.currentTarget as HTMLInputElement).value;
		$formData.tags = tagsText
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	function formatEntryDate(value: Date) {
		return `${entryDateFormatter.format(value)} UTC`;
	}

	function deleteLabel(symbol: string | null, createdAt: Date) {
		return `Delete ${symbol ? `${symbol} ` : ''}journal entry from ${formatEntryDate(createdAt)}`;
	}
</script>

<svelte:head><title>Journal · EdgeLab</title></svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">Journal</h1>
		<p class="mt-1 max-w-3xl text-sm text-muted-foreground">
			Capture the thesis, invalidation level, confidence, and post-trade review behind each
			decision.
		</p>
	</header>

	{#if $formMessage}
		<Alert class="rounded-none shadow-none">
			<CircleCheckIcon aria-hidden="true" />
			<AlertTitle>Entry saved</AlertTitle>
			<AlertDescription>{$formMessage}</AlertDescription>
		</Alert>
	{/if}
	{#if deleteError}
		<Alert variant="destructive" class="rounded-none shadow-none">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Entry could not be deleted</AlertTitle>
			<AlertDescription>{deleteError}</AlertDescription>
		</Alert>
	{:else if deletedEntryId}
		<Alert class="rounded-none shadow-none">
			<CircleCheckIcon aria-hidden="true" />
			<AlertTitle>Entry deleted</AlertTitle>
			<AlertDescription>The journal entry was removed from this portfolio.</AlertDescription>
		</Alert>
	{/if}

	<div class="grid items-start gap-6 xl:grid-cols-[minmax(22rem,30rem)_minmax(0,1fr)]">
		<section id="journal-form" class="border border-border" aria-labelledby="journal-form-heading">
			<header class="border-b border-border px-4 py-4">
				<div class="flex items-start gap-3">
					<NotebookPenIcon class="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
					<div>
						<h2 id="journal-form-heading" class="text-base font-semibold">Write an entry</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							Only notes are required. Optional context can be added now or left unrecorded.
						</p>
					</div>
				</div>
			</header>

			<form method="POST" action="?/create" {@attach attachEnhance} class="space-y-5 px-4 py-5">
				<Field {form} name="symbol">
					<div class="space-y-2">
						<Control>
							{#snippet children({ props })}
								<Label>Symbol</Label>
								<Input
									{...props}
									bind:value={$formData.symbol}
									maxlength={20}
									autocapitalize="characters"
									autocomplete="off"
									placeholder="Optional ticker"
									class="mt-2 h-11 rounded-none border-border bg-background font-medium uppercase shadow-none transition-none"
								/>
							{/snippet}
						</Control>
						<Description class="text-xs text-muted-foreground">
							Use the stock or option symbol connected to this decision.
						</Description>
						<FieldErrors class="text-xs text-destructive" />
					</div>
				</Field>

				<Field {form} name="phase">
					<div class="space-y-2">
						<Control>
							{#snippet children({ props })}
								<Label>Decision phase</Label>
								<Select.Root type="single" name={props.name} bind:value={$formData.phase}>
									<Select.Trigger
										{...props}
										class="mt-2 h-11 w-full rounded-none border-border bg-background shadow-none transition-none"
									>
										{phaseLabel($formData.phase)}
									</Select.Trigger>
									<Select.Content class="rounded-none shadow-none transition-none">
										<Select.Item value="pre_trade" class="rounded-none">Pre-trade</Select.Item>
										<Select.Item value="post_trade" class="rounded-none">Post-trade</Select.Item>
										<Select.Item value="general" class="rounded-none">General</Select.Item>
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Control>
						<FieldErrors class="text-xs text-destructive" />
					</div>
				</Field>

				<Field {form} name="thesis">
					<div class="space-y-2">
						<Control>
							{#snippet children({ props })}
								<Label>Thesis</Label>
								<Textarea
									{...props}
									bind:value={$formData.thesis}
									maxlength={4000}
									placeholder="What do you expect, and why?"
									class="mt-2 min-h-24 rounded-none border-border bg-background shadow-none transition-none"
								/>
							{/snippet}
						</Control>
						<FieldErrors class="text-xs text-destructive" />
					</div>
				</Field>

				<Field {form} name="invalidation">
					<div class="space-y-2">
						<Control>
							{#snippet children({ props })}
								<Label>Invalidation</Label>
								<Textarea
									{...props}
									bind:value={$formData.invalidation}
									maxlength={1000}
									placeholder="What evidence would prove the thesis wrong?"
									class="mt-2 min-h-20 rounded-none border-border bg-background shadow-none transition-none"
								/>
							{/snippet}
						</Control>
						<FieldErrors class="text-xs text-destructive" />
					</div>
				</Field>

				<Field {form} name="notes">
					<div class="space-y-2">
						<Control>
							{#snippet children({ props })}
								<Label>Notes</Label>
								<Textarea
									{...props}
									bind:value={$formData.notes}
									maxlength={10000}
									required
									placeholder="Record the decision, observation, or review."
									class="mt-2 min-h-32 rounded-none border-border bg-background shadow-none transition-none"
								/>
							{/snippet}
						</Control>
						<Description class="text-xs text-muted-foreground">
							Describe what happened without relying on future price data.
						</Description>
						<FieldErrors class="text-xs text-destructive" />
					</div>
				</Field>

				<Field {form} name="tags">
					<div class="space-y-2">
						<Control>
							{#snippet children({ props })}
								<Label>Tags</Label>
								<Input
									{...props}
									name="tagsInput"
									value={tagsText}
									oninput={updateTags}
									autocomplete="off"
									placeholder="setup, earnings, risk"
									class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
								/>
							{/snippet}
						</Control>
						<Description class="text-xs text-muted-foreground">
							Separate up to 12 tags with commas; each tag can be up to 32 characters.
						</Description>
						<FieldErrors class="text-xs text-destructive" />
					</div>
				</Field>

				<div class="grid gap-5 sm:grid-cols-2">
					<Field {form} name="confidence">
						<div class="space-y-2">
							<Control>
								{#snippet children({ props })}
									<Label>Confidence</Label>
									<Input
										{...props}
										type="number"
										bind:value={$formData.confidence}
										min={1}
										max={5}
										step={1}
										placeholder="1–5"
										class="mt-2 h-11 rounded-none border-border bg-background shadow-none transition-none"
									/>
								{/snippet}
							</Control>
							<Description class="text-xs text-muted-foreground">Optional, from 1 to 5.</Description
							>
							<FieldErrors class="text-xs text-destructive" />
						</div>
					</Field>

					<Field {form} name="followedPlan">
						<div class="space-y-2">
							<Control>
								{#snippet children({ props })}
									<Label>Followed plan</Label>
									<Select.Root
										type="single"
										value={followedPlanValue($formData.followedPlan)}
										onValueChange={updateFollowedPlan}
									>
										<Select.Trigger
											{...props}
											class="mt-2 h-11 w-full rounded-none border-border bg-background shadow-none transition-none"
										>
											{followedPlanLabel($formData.followedPlan)}
										</Select.Trigger>
										<Select.Content class="rounded-none shadow-none transition-none">
											<Select.Item value="not_recorded" class="rounded-none">
												Not recorded
											</Select.Item>
											<Select.Item value="yes" class="rounded-none">Yes</Select.Item>
											<Select.Item value="no" class="rounded-none">No</Select.Item>
										</Select.Content>
									</Select.Root>
									{#if $formData.followedPlan !== undefined}
										<input
											type="hidden"
											name="followedPlan"
											value={$formData.followedPlan ? 'true' : 'false'}
										/>
									{/if}
								{/snippet}
							</Control>
							<FieldErrors class="text-xs text-destructive" />
						</div>
					</Field>
				</div>

				<div class="border-t border-border pt-4">
					<Button
						type="submit"
						disabled={$submitting}
						class="h-11 w-full rounded-none shadow-none transition-none"
					>
						<PlusIcon aria-hidden="true" />
						{$submitting ? 'Saving entry…' : 'Save journal entry'}
					</Button>
				</div>
			</form>
		</section>

		<section class="min-w-0" aria-labelledby="journal-entries-heading">
			<header class="mb-3 flex items-end justify-between gap-4 border-b border-border pb-3">
				<div>
					<h2 id="journal-entries-heading" class="text-base font-semibold">Entries</h2>
					<p class="mt-1 text-sm text-muted-foreground">Newest decisions appear first.</p>
				</div>
				<p class="text-sm font-medium tabular-nums">
					{data.entries.length}
					{data.entries.length === 1 ? 'entry' : 'entries'}
				</p>
			</header>

			{#if data.entries.length === 0}
				<EmptyState
					title="Start a decision journal"
					description="Record a decision, observation, or post-trade review. Entries remain scoped to this portfolio."
					icon={NotebookPenIcon}
					actionLabel="Write an entry"
					actionHref="#journal-form"
				/>
			{:else}
				<ol class="space-y-4">
					{#each data.entries as entry (entry.id)}
						<li>
							<article class="border border-border" aria-labelledby={`entry-${entry.id}-heading`}>
								<header
									class="border-b border-border px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
								>
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<h3 id={`entry-${entry.id}-heading`} class="font-semibold tracking-tight">
												{entry.symbol ?? 'Journal note'}
											</h3>
											<Badge variant="outline" class="rounded-none">{phaseLabel(entry.phase)}</Badge
											>
										</div>
										<p class="mt-1 text-xs text-muted-foreground">
											<time datetime={entry.createdAt.toISOString()}
												>{formatEntryDate(entry.createdAt)}</time
											>
										</p>
									</div>
									<form method="POST" action="?/delete" class="mt-3 shrink-0 sm:mt-0">
										<input type="hidden" name="entryId" value={entry.id} />
										<Button
											type="submit"
											variant="destructive"
											size="sm"
											aria-label={deleteLabel(entry.symbol, entry.createdAt)}
											class="h-9 rounded-none px-3 shadow-none transition-none"
										>
											<Trash2Icon aria-hidden="true" />
											Delete
										</Button>
									</form>
								</header>

								<div class="space-y-4 px-4 py-4">
									<div>
										<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
											Notes
										</h4>
										<p class="mt-1 text-sm leading-6 break-words whitespace-pre-wrap">
											{entry.notes}
										</p>
									</div>

									{#if entry.thesis || entry.invalidation}
										<div class="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
											{#if entry.thesis}
												<div>
													<h4
														class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
													>
														Thesis
													</h4>
													<p class="mt-1 text-sm leading-6 break-words whitespace-pre-wrap">
														{entry.thesis}
													</p>
												</div>
											{/if}
											{#if entry.invalidation}
												<div>
													<h4
														class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
													>
														Invalidation
													</h4>
													<p class="mt-1 text-sm leading-6 break-words whitespace-pre-wrap">
														{entry.invalidation}
													</p>
												</div>
											{/if}
										</div>
									{/if}

									<dl class="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-xs">
										<div class="flex gap-1.5">
											<dt class="text-muted-foreground">Confidence</dt>
											<dd class="font-medium tabular-nums">
												{entry.confidence ? `${entry.confidence} / 5` : 'Not recorded'}
											</dd>
										</div>
										<div class="flex gap-1.5">
											<dt class="text-muted-foreground">Followed plan</dt>
											<dd class="font-medium">
												{followedPlanLabel(entry.followedPlan ?? undefined)}
											</dd>
										</div>
									</dl>

									{#if entry.tags.length > 0}
										<ul class="flex flex-wrap gap-2" aria-label="Entry tags">
											{#each entry.tags as tag, index (`${entry.id}-${tag}-${index}`)}
												<li><Badge variant="secondary" class="rounded-none">{tag}</Badge></li>
											{/each}
										</ul>
									{/if}
								</div>
							</article>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	</div>
</div>
