import { DEFAULT_EXECUTION_MODEL_VERSION, executionModelSchema, feeModelSchema } from './types';

export const SIMULATION_EXECUTION_MODEL = executionModelSchema.parse({
	version: DEFAULT_EXECUTION_MODEL_VERSION,
	latencyMilliseconds: 0,
	stockSlippageBps: '2',
	optionSlippageBps: '5',
	participationRate: '0.25'
});

export const SIMULATION_FEE_MODEL = feeModelSchema.parse({
	stockPerShare: '0',
	optionPerContract: '0.65',
	minimumPerOrder: '0'
});
