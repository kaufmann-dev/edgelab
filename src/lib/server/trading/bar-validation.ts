import { z } from 'zod';
import { marketDataModeSchema, type NormalizedBar } from '../market-data/types';

export const executableBarContextSchema = z
	.object({
		attemptAt: z.date(),
		expectedMode: marketDataModeSchema,
		expectedDelayMilliseconds: z.number().int().nonnegative(),
		maxTransportAgeMilliseconds: z.number().int().nonnegative(),
		maxSourceAgeMilliseconds: z.number().int().nonnegative(),
		futureToleranceMilliseconds: z.number().int().nonnegative()
	})
	.strict();

export type ExecutableBarContext = z.infer<typeof executableBarContextSchema>;

export type ExecutableBarIssueCode =
	| 'mode_mismatch'
	| 'interval_mismatch'
	| 'transport_stale'
	| 'receipt_in_future'
	| 'source_stale'
	| 'source_in_future'
	| 'receipt_before_eligibility'
	| 'source_before_eligibility';

export interface ExecutableBarIssue {
	code: ExecutableBarIssueCode;
	message: string;
	symbol?: string;
}

export interface ExecutableBarValidation {
	executable: boolean;
	logicalAt: Date;
	logicalEligibleAt: Date;
	issues: ExecutableBarIssue[];
}

const dateSchema = z.date();

export function validateExecutableBar(
	bar: NormalizedBar,
	input: ExecutableBarContext,
	eligibleAt: Date
): ExecutableBarValidation {
	const context = executableBarContextSchema.parse(input);
	const parsedEligibleAt = dateSchema.parse(eligibleAt);
	const attemptMilliseconds = context.attemptAt.getTime();
	const logicalAt = new Date(attemptMilliseconds - context.expectedDelayMilliseconds);
	const logicalEligibleAt = new Date(
		parsedEligibleAt.getTime() - context.expectedDelayMilliseconds
	);
	const issues: ExecutableBarIssue[] = [];

	if (bar.mode !== context.expectedMode) {
		issues.push({
			code: 'mode_mismatch',
			message: `${bar.symbol} is ${bar.mode}, but ${context.expectedMode} data is required`,
			symbol: bar.symbol
		});
	}

	if (
		bar.interval !== 'second' ||
		bar.endTime.getTime() - bar.startTime.getTime() !== 1_000 ||
		bar.sourceTime.getTime() !== bar.endTime.getTime()
	) {
		issues.push({
			code: 'interval_mismatch',
			message: `${bar.symbol} is not a complete one-second aggregate`,
			symbol: bar.symbol
		});
	}

	const transportAge = attemptMilliseconds - bar.receivedAt.getTime();
	if (transportAge > context.maxTransportAgeMilliseconds) {
		issues.push({
			code: 'transport_stale',
			message: `${bar.symbol} was received too long before this execution attempt`,
			symbol: bar.symbol
		});
	} else if (transportAge < -context.futureToleranceMilliseconds) {
		issues.push({
			code: 'receipt_in_future',
			message: `${bar.symbol} has a receipt time beyond the allowed future tolerance`,
			symbol: bar.symbol
		});
	}

	const sourceAge = logicalAt.getTime() - bar.endTime.getTime();
	if (sourceAge > context.maxSourceAgeMilliseconds) {
		issues.push({
			code: 'source_stale',
			message: `${bar.symbol} is stale relative to the portfolio's logical market time`,
			symbol: bar.symbol
		});
	} else if (sourceAge < -context.futureToleranceMilliseconds) {
		issues.push({
			code: 'source_in_future',
			message: `${bar.symbol} ends beyond the allowed logical future tolerance`,
			symbol: bar.symbol
		});
	}

	if (bar.receivedAt < parsedEligibleAt) {
		issues.push({
			code: 'receipt_before_eligibility',
			message: `${bar.symbol} was received before the order became eligible`,
			symbol: bar.symbol
		});
	}

	if (bar.startTime < logicalEligibleAt) {
		issues.push({
			code: 'source_before_eligibility',
			message: `${bar.symbol} began before the order's logical eligibility time`,
			symbol: bar.symbol
		});
	}

	return {
		executable: issues.length === 0,
		logicalAt,
		logicalEligibleAt,
		issues
	};
}
