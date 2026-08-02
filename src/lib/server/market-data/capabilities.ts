import { z } from 'zod';
import { assetClassSchema, marketDataModeSchema, type AssetClass } from './types';

export const massivePlanTierSchema = z.enum(['basic', 'starter', 'developer', 'advanced']);
export type MassivePlanTier = z.infer<typeof massivePlanTierSchema>;

export const MARKET_DATA_MODE_LABELS = {
	realtime: 'REAL-TIME',
	delayed: '15 MIN DELAYED'
} as const satisfies Record<z.infer<typeof marketDataModeSchema>, string>;

export const assetCapabilitiesSchema = z
	.object({
		assetClass: assetClassSchema,
		mode: marketDataModeSchema,
		label: z.string(),
		websocket: z.boolean(),
		snapshots: z.boolean(),
		secondBars: z.boolean(),
		minuteBars: z.boolean(),
		trades: z.boolean(),
		quotes: z.boolean(),
		delayMinutes: z.number().int().nonnegative()
	})
	.strict();

export type AssetCapabilities = z.infer<typeof assetCapabilitiesSchema>;

export interface MassiveCapabilitySet {
	stocks: AssetCapabilities;
	options: AssetCapabilities;
}

export function capabilitiesForPlan(
	assetClass: AssetClass,
	tier: MassivePlanTier
): AssetCapabilities {
	const paid = tier !== 'basic';
	const advanced = tier === 'advanced';
	const developerOrBetter = tier === 'developer' || advanced;
	const mode = advanced ? 'realtime' : 'delayed';

	return assetCapabilitiesSchema.parse({
		assetClass,
		mode,
		label: MARKET_DATA_MODE_LABELS[mode],
		websocket: paid,
		snapshots: paid,
		secondBars: paid,
		minuteBars: true,
		trades: developerOrBetter,
		quotes: advanced,
		delayMinutes: advanced ? 0 : 15
	});
}

export function resolveMassiveCapabilities(input: {
	stocksTier: MassivePlanTier;
	optionsTier: MassivePlanTier;
}): MassiveCapabilitySet {
	return {
		stocks: capabilitiesForPlan('stocks', input.stocksTier),
		options: capabilitiesForPlan('options', input.optionsTier)
	};
}
