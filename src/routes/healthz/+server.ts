import type { RequestHandler } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';

export const GET: RequestHandler = async () => {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			db.execute(sql`select 1`),
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error('Database health check timed out')), 3_000);
			})
		]);
		return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
	} catch {
		return Response.json(
			{ status: 'unavailable' },
			{ status: 503, headers: { 'cache-control': 'no-store' } }
		);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
};
