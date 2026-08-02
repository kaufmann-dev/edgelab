import Decimal from 'decimal.js';
import { z } from 'zod';

const decimalInputSchema = z.union([
	z.instanceof(Decimal),
	z.string().trim().min(1),
	z.number().finite(),
	z.bigint()
]);

export const decimalSchema = decimalInputSchema.transform((value, context): Decimal => {
	try {
		const decimal = value instanceof Decimal ? value : new Decimal(value.toString());
		if (!decimal.isFinite()) throw new Error('Value must be finite');
		return decimal;
	} catch {
		context.addIssue({ code: 'custom', message: 'Value must be a valid decimal' });
		return z.NEVER;
	}
});

export type DecimalInput = z.input<typeof decimalSchema>;

export function decimal(value: DecimalInput): Decimal {
	return decimalSchema.parse(value);
}

export function money(value: DecimalInput, scale = 8): Decimal {
	return decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
}

export function decimalString(value: Decimal): string {
	return value.toFixed();
}
