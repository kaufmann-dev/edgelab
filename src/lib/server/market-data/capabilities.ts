import { z } from 'zod';
import { assetClassSchema, marketDataModeSchema, type AssetClass } from './types';

export const massivePlanTierSchema = z.enum(['basic', 'starter', 'developer', 'advanced']);
export type MassivePlanTier = z.infer<typeof massivePlanTierSchema>;

export const massivePlanSelectionSchema = z.enum([
	'none',
	'basic',
	'starter',
	'developer',
	'advanced'
]);
export type MassivePlanSelection = z.infer<typeof massivePlanSelectionSchema>;

export const MARKET_DATA_MODE_LABELS = {
	realtime: 'REAL-TIME',
	delayed: '15 MIN DELAYED'
} as const satisfies Record<z.infer<typeof marketDataModeSchema>, string>;

export const marketDataRecencySchema = z.enum(['unavailable', 'end_of_day', 'delayed', 'realtime']);

export const assetCapabilitiesSchema = z
	.object({
		assetClass: assetClassSchema,
		available: z.boolean(),
		recency: marketDataRecencySchema,
		executionMode: marketDataModeSchema.nullable(),
		label: z.string(),
		websocket: z.boolean(),
		snapshots: z.boolean(),
		secondBars: z.boolean(),
		minuteBars: z.boolean(),
		trades: z.boolean(),
		quotes: z.boolean(),
		luld: z.boolean(),
		delayMinutes: z.number().int().nonnegative().nullable()
	})
	.strict();

export type AssetCapabilities = z.infer<typeof assetCapabilitiesSchema>;
export type ExecutableAssetCapabilities = AssetCapabilities & {
	executionMode: z.infer<typeof marketDataModeSchema>;
	delayMinutes: number;
};

export interface MassiveCapabilitySet {
	stocks: AssetCapabilities;
	options: AssetCapabilities;
}

export function capabilitiesForPlan(
	assetClass: AssetClass,
	tier: MassivePlanSelection
): AssetCapabilities {
	const available = tier !== 'none';
	const paid = available && tier !== 'basic';
	const advanced = tier === 'advanced';
	const developerOrBetter = tier === 'developer' || advanced;
	const executionMode = paid ? (advanced ? 'realtime' : 'delayed') : null;
	const recency = !available
		? 'unavailable'
		: tier === 'basic'
			? 'end_of_day'
			: advanced
				? 'realtime'
				: 'delayed';
	const label =
		recency === 'unavailable'
			? 'UNAVAILABLE'
			: recency === 'end_of_day'
				? 'END OF DAY'
				: MARKET_DATA_MODE_LABELS[executionMode ?? 'delayed'];

	return assetCapabilitiesSchema.parse({
		assetClass,
		available,
		recency,
		executionMode,
		label,
		websocket: paid,
		snapshots: paid,
		secondBars: paid,
		minuteBars: available,
		trades: developerOrBetter,
		quotes: advanced,
		luld: assetClass === 'stocks' && advanced,
		delayMinutes: executionMode === null ? null : recency === 'delayed' ? 15 : 0
	});
}

export function resolveMassiveCapabilities(input: {
	stocksTier: MassivePlanTier;
	optionsTier?: MassivePlanSelection;
}): MassiveCapabilitySet {
	return {
		stocks: capabilitiesForPlan('stocks', input.stocksTier),
		options: capabilitiesForPlan('options', input.optionsTier ?? 'none')
	};
}

export function supportsStockSimulation(
	capability: AssetCapabilities
): capability is ExecutableAssetCapabilities {
	return (
		capability.assetClass === 'stocks' &&
		capability.available &&
		capability.executionMode !== null &&
		capability.delayMinutes !== null &&
		capability.snapshots &&
		capability.websocket &&
		capability.secondBars &&
		capability.minuteBars
	);
}

export function supportsOptionsExecution(capabilities: MassiveCapabilitySet): boolean {
	const { stocks, options } = capabilities;
	return (
		stocks.available &&
		stocks.executionMode !== null &&
		options.assetClass === 'options' &&
		options.available &&
		options.executionMode === stocks.executionMode &&
		options.snapshots &&
		options.websocket &&
		options.quotes &&
		options.trades
	);
}
