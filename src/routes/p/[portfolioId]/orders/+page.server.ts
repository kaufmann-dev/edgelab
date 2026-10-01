import { fail, error } from '@sveltejs/kit';
import { z } from 'zod';
import { cancelOwnedOrder } from '#lib/server/order-mutations.js';
import { listPortfolioOrders, requirePortfolioReadAccess } from '#lib/server/portfolio-read.js';
import { buildOrderRows } from '#lib/server/portfolio-view.js';
import type { Actions, PageServerLoad } from './$types';

const orderIdSchema = z.uuid();

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Authentication required.');
	const portfolio = await requirePortfolioReadAccess(locals.user.id, params.portfolioId);
	if (!portfolio) error(404, 'Portfolio not found.');
	return { orders: buildOrderRows(await listPortfolioOrders(portfolio.id)) };
};

export const actions: Actions = {
	cancel: async ({ locals, params, request }) => {
		if (!locals.user) return fail(401, { cancelError: 'Authentication required.' });
		const formData = await request.formData();
		const orderId = orderIdSchema.safeParse(formData.get('orderId'));
		if (!orderId.success) return fail(400, { cancelError: 'Invalid order identifier.' });
		locals.markSessionActive();
		const result = await cancelOwnedOrder({
			ownerUserId: locals.user.id,
			portfolioId: params.portfolioId,
			orderId: orderId.data
		});
		if (result === 'not_found') return fail(404, { cancelError: 'Order not found.' });
		if (result === 'already_terminal') {
			return fail(409, { cancelError: 'This order can no longer be canceled.' });
		}
		return { canceledOrderId: orderId.data };
	}
};
