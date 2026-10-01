import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (input: string | undefined) => input;

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'PostgreSQL connection string', schema: optional },
	ORIGIN: { description: 'Canonical public origin of EdgeLab', schema: optional },
	OIDC_ISSUER_URL: { description: 'OIDC issuer URL', schema: optional },
	OIDC_CLIENT_ID: { description: 'OIDC client ID', schema: optional },
	OIDC_CLIENT_SECRET: { description: 'OIDC client secret', schema: optional },
	OIDC_DATA_ENCRYPTION_KEY: {
		description: 'Base64 key encrypting stored OIDC session data',
		schema: optional
	},
	MASSIVE_API_KEY: { description: 'Massive market data API key', schema: optional },
	MASSIVE_STOCKS_PLAN: { description: 'Massive stocks plan tier', schema: optional },
	MASSIVE_OPTIONS_PLAN: {
		description: 'Massive options plan tier (defaults to none)',
		schema: optional
	}
});
