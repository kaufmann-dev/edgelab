<script lang="ts">
	import { BookOpen, CheckCircle2, GraduationCap, ShieldAlert } from '@lucide/svelte';
	import { learningLessons } from '$lib/domain/lessons';
</script>

<svelte:head>
	<title>Learn · EdgeLab</title>
	<meta
		name="description"
		content="Practical lessons for understanding orders, risk, options, market data, and trading performance."
	/>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
	<header class="max-w-3xl border-l-4 border-info pl-5">
		<div class="mb-3 flex items-center gap-2 text-sm font-medium text-info">
			<GraduationCap class="size-4" aria-hidden="true" />
			<span>Trading field guide</span>
		</div>
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Learn by doing</h1>
		<p class="mt-3 text-base leading-7 text-muted-foreground">
			Use these short modules when a risk check or order field is unfamiliar. Each concept is
			connected to a behavior you can practice in the simulator.
		</p>
	</header>

	<div class="mt-10 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
		<nav aria-label="Learning modules" class="lg:sticky lg:top-6 lg:self-start">
			<p class="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
				Modules
			</p>
			<ol class="border-y border-border">
				{#each learningLessons as lesson, index (lesson.slug)}
					<li class="border-b border-border last:border-b-0">
						<a
							href={`#${lesson.slug}`}
							class="flex min-h-11 items-center gap-3 px-2 py-2 text-sm hover:bg-muted focus-visible:outline-offset-[-2px]"
						>
							<span class="w-5 text-xs text-muted-foreground"
								>{String(index + 1).padStart(2, '0')}</span
							>
							<span>{lesson.title}</span>
						</a>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="space-y-6">
			{#each learningLessons as lesson, index (lesson.slug)}
				<article id={lesson.slug} class="scroll-mt-6 border border-border bg-card p-5 sm:p-7">
					<div class="flex items-start gap-4">
						<div
							class="flex size-10 shrink-0 items-center justify-center border border-border bg-muted text-sm font-semibold"
							aria-hidden="true"
						>
							{index + 1}
						</div>
						<div class="min-w-0">
							<h2 class="text-xl font-semibold tracking-tight">{lesson.title}</h2>
							<p class="mt-2 leading-7 text-muted-foreground">{lesson.summary}</p>
						</div>
					</div>

					<ul class="mt-6 space-y-3 border-t border-border pt-5">
						{#each lesson.takeaways as takeaway (takeaway)}
							<li class="flex gap-3 text-sm leading-6">
								<CheckCircle2 class="mt-1 size-4 shrink-0 text-positive" aria-hidden="true" />
								<span>{takeaway}</span>
							</li>
						{/each}
					</ul>

					<details class="mt-6 border border-border bg-muted/40">
						<summary class="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-3 font-medium">
							<BookOpen class="size-4" aria-hidden="true" />
							Check your understanding
						</summary>
						<div class="border-t border-border px-4 py-4 text-sm leading-6">
							<p class="font-medium">{lesson.check.question}</p>
							<p class="mt-2 text-muted-foreground">{lesson.check.answer}</p>
						</div>
					</details>
				</article>
			{/each}
		</div>
	</div>

	<aside class="mt-10 flex gap-3 border border-warning/50 bg-warning/5 p-4 text-sm leading-6">
		<ShieldAlert class="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
		<p>
			EdgeLab is an educational simulation. Lessons and calculations explain mechanics; they are not
			individualized investment advice or a promise of real-world results.
		</p>
	</aside>
</div>
