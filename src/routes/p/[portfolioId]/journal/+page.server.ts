import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { journalEntrySchema, type JournalEntryInput } from '#lib/domain/forms.js';
import { db } from '#lib/server/db/index.js';
import { tradingJournalEntries } from '#lib/server/db/schema/trading.js';
import { listPortfolioJournal, requirePortfolioReadAccess } from '#lib/server/portfolio-read.js';
import type { Actions, PageServerLoad } from './$types';

const journalEntryAdapter = zod4(journalEntrySchema);
const portfolioIdSchema = z.uuid();
const journalEntryIdSchema = z.uuid();

const JOURNAL_ENTRY_DEFAULTS = {
	phase: 'general',
	notes: '',
	tags: []
} satisfies JournalEntryInput;

function optionalText(value: string | undefined): string | null {
	return value || null;
}

async function validateJournalRequest(request: Request) {
	const formData = await request.formData();
	const tagsInput = formData.get('tagsInput');
	formData.delete('tagsInput');
	formData.delete('tags');

	if (typeof tagsInput === 'string') {
		for (const tag of tagsInput.split(',').map((value) => value.trim())) {
			if (tag) formData.append('tags', tag);
		}
	}

	return superValidate(formData, journalEntryAdapter);
}

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');

	const portfolioId = portfolioIdSchema.safeParse(params.portfolioId);
	if (!portfolioId.success) error(404, 'Portfolio not found.');

	const portfolio = await requirePortfolioReadAccess(locals.user.id, portfolioId.data);
	if (!portfolio) error(404, 'Portfolio not found.');

	locals.markSessionActive();
	const [form, entries] = await Promise.all([
		superValidate(journalEntryAdapter, { defaults: JOURNAL_ENTRY_DEFAULTS }),
		listPortfolioJournal(portfolio.id)
	]);

	return { form, entries };
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Authentication required.');
		locals.markSessionActive();

		const portfolioId = portfolioIdSchema.safeParse(params.portfolioId);
		if (!portfolioId.success) error(404, 'Portfolio not found.');

		const portfolio = await requirePortfolioReadAccess(locals.user.id, portfolioId.data);
		if (!portfolio) error(404, 'Portfolio not found.');

		const form = await validateJournalRequest(request);
		if (!form.valid) return fail(400, { form });

		const now = new Date();
		await db.insert(tradingJournalEntries).values({
			portfolioId: portfolio.id,
			symbol: optionalText(form.data.symbol),
			phase: form.data.phase,
			thesis: optionalText(form.data.thesis),
			invalidation: optionalText(form.data.invalidation),
			notes: form.data.notes,
			tags: form.data.tags,
			confidence: form.data.confidence ?? null,
			followedPlan: form.data.followedPlan ?? null,
			createdAt: now,
			updatedAt: now
		});

		return message(form, 'Journal entry saved.');
	},
	delete: async ({ locals, params, request }) => {
		if (!locals.user) return fail(401, { deleteError: 'Authentication required.' });
		locals.markSessionActive();

		const portfolioId = portfolioIdSchema.safeParse(params.portfolioId);
		if (!portfolioId.success) return fail(404, { deleteError: 'Journal entry not found.' });

		const portfolio = await requirePortfolioReadAccess(locals.user.id, portfolioId.data);
		if (!portfolio) return fail(404, { deleteError: 'Journal entry not found.' });

		const formData = await request.formData();
		const entryId = journalEntryIdSchema.safeParse(formData.get('entryId'));
		if (!entryId.success) return fail(400, { deleteError: 'Invalid journal entry identifier.' });

		const [deletedEntry] = await db
			.delete(tradingJournalEntries)
			.where(
				and(
					eq(tradingJournalEntries.id, entryId.data),
					eq(tradingJournalEntries.portfolioId, portfolio.id)
				)
			)
			.returning({ id: tradingJournalEntries.id });

		if (!deletedEntry) return fail(404, { deleteError: 'Journal entry not found.' });
		return { deletedEntryId: deletedEntry.id };
	}
};
