import * as env from '$app/env/private';
import {
	MassiveRestClient,
	massivePlanSelectionSchema,
	massivePlanTierSchema,
	resolveMassiveCapabilities,
	type MassiveCapabilitySet,
	type MassivePlanSelection,
	type MassivePlanTier
} from '#lib/server/market-data/index.js';

export interface MarketEnvironment {
	apiKey: string;
	stocksPlan: MassivePlanTier;
	optionsPlan: MassivePlanSelection;
	capabilities: MassiveCapabilitySet;
}

type EnvironmentSource = Record<string, string | undefined>;

function required(source: EnvironmentSource, name: string): string {
	const value = source[name]?.trim();
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

export function getMarketEnvironment(source: EnvironmentSource = env): MarketEnvironment {
	const stocksPlan = massivePlanTierSchema.parse(required(source, 'MASSIVE_STOCKS_PLAN'));
	const configuredOptionsPlan = source.MASSIVE_OPTIONS_PLAN?.trim();
	const optionsPlan = massivePlanSelectionSchema.parse(configuredOptionsPlan || 'none');

	return {
		apiKey: required(source, 'MASSIVE_API_KEY'),
		stocksPlan,
		optionsPlan,
		capabilities: resolveMassiveCapabilities({ stocksTier: stocksPlan, optionsTier: optionsPlan })
	};
}

let cachedClient: MassiveRestClient | undefined;
let cachedSignature: string | undefined;

export function getMarketDataProvider(source: EnvironmentSource = env): MassiveRestClient {
	const environment = getMarketEnvironment(source);
	const signature = `${environment.apiKey}:${environment.stocksPlan}:${environment.optionsPlan}`;
	if (!cachedClient || cachedSignature !== signature) {
		cachedClient = new MassiveRestClient({
			apiKey: environment.apiKey,
			capabilities: environment.capabilities
		});
		cachedSignature = signature;
	}
	return cachedClient;
}

export function resetMarketDataProviderForTests(): void {
	cachedClient = undefined;
	cachedSignature = undefined;
}
