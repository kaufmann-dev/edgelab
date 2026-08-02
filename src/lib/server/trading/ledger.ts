import Decimal from 'decimal.js';
import { money } from '../market-data/numeric';
import type { Instrument } from '../market-data/types';
import { fillGrossAmount } from './execution';
import { positionSchema, type Position, type StrategyFill } from './types';

export type CashLedgerEntryType = 'initial_capital' | 'trade' | 'fee' | 'dividend' | 'adjustment';

export interface CashLedgerEntry {
	id: string;
	portfolioId: string;
	fillId?: string;
	type: CashLedgerEntryType;
	amount: Decimal;
	currency: 'USD';
	occurredAt: Date;
	description: string;
}

export interface LedgerAccountState {
	portfolioId: string;
	cashBalance: Decimal;
	positions: ReadonlyMap<string, Position>;
}

export interface AppliedFill {
	fill: StrategyFill;
	fillId: string;
	nextAccount: LedgerAccountState;
	entries: CashLedgerEntry[];
	positionChanges: ReadonlyMap<string, Position>;
}

export class LedgerInvariantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LedgerInvariantError';
	}
}

function instrumentMultiplier(instrument: Instrument): Decimal {
	return instrument.assetClass === 'options' ? instrument.multiplier : new Decimal(1);
}

function signedFillQuantity(side: 'buy' | 'sell', quantity: Decimal): Decimal {
	return side === 'buy' ? quantity : quantity.negated();
}

function openingAveragePrice(input: {
	price: Decimal;
	fee: Decimal;
	quantity: Decimal;
	multiplier: Decimal;
	side: 'buy' | 'sell';
}): Decimal {
	const feePerUnit = input.fee.dividedBy(input.quantity.times(input.multiplier));
	return money(input.side === 'buy' ? input.price.plus(feePerUnit) : input.price.minus(feePerUnit));
}

function applyPositionLeg(
	current: Position | undefined,
	input: {
		instrument: Instrument;
		side: 'buy' | 'sell';
		positionEffect: 'open' | 'close';
		quantity: Decimal;
		price: Decimal;
		fee: Decimal;
	}
): Position {
	const existing =
		current ??
		positionSchema.parse({
			instrument: input.instrument,
			quantity: 0,
			averageCost: 0,
			realizedPnl: 0
		});
	const delta = signedFillQuantity(input.side, input.quantity);
	const multiplier = instrumentMultiplier(input.instrument);

	if (input.positionEffect === 'open') {
		if (!existing.quantity.isZero() && existing.quantity.greaterThan(0) !== delta.greaterThan(0)) {
			throw new LedgerInvariantError('An opening fill cannot reduce or cross an existing position');
		}
		const effectivePrice = openingAveragePrice({
			price: input.price,
			fee: input.fee,
			quantity: input.quantity,
			multiplier,
			side: input.side
		});
		const nextQuantity = existing.quantity.plus(delta);
		const weightedCost = existing.averageCost
			.times(existing.quantity.abs())
			.plus(effectivePrice.times(input.quantity));
		return positionSchema.parse({
			...existing,
			quantity: nextQuantity,
			averageCost: weightedCost.dividedBy(nextQuantity.abs()),
			realizedPnl: existing.realizedPnl
		});
	}

	const closesLong = existing.quantity.greaterThan(0) && input.side === 'sell';
	const closesShort = existing.quantity.isNegative() && input.side === 'buy';
	if (!closesLong && !closesShort) {
		throw new LedgerInvariantError('A closing fill must reduce an existing opposite-side position');
	}
	if (input.quantity.greaterThan(existing.quantity.abs())) {
		throw new LedgerInvariantError('A closing fill cannot cross through zero');
	}
	const grossRealized = closesLong
		? input.price.minus(existing.averageCost).times(input.quantity).times(multiplier)
		: existing.averageCost.minus(input.price).times(input.quantity).times(multiplier);
	const nextQuantity = existing.quantity.plus(delta);
	return positionSchema.parse({
		...existing,
		quantity: nextQuantity,
		averageCost: nextQuantity.isZero() ? 0 : existing.averageCost,
		realizedPnl: existing.realizedPnl.plus(grossRealized).minus(input.fee)
	});
}

export function createInitialCapitalEntry(input: {
	id: string;
	portfolioId: string;
	amount: Decimal;
	occurredAt: Date;
}): CashLedgerEntry {
	if (!input.amount.greaterThan(0))
		throw new LedgerInvariantError('Initial capital must be positive');
	return {
		id: input.id,
		portfolioId: input.portfolioId,
		type: 'initial_capital',
		amount: money(input.amount),
		currency: 'USD',
		occurredAt: input.occurredAt,
		description: 'Portfolio starting capital'
	};
}

export function applyFillToLedger(input: {
	account: LedgerAccountState;
	fill: StrategyFill;
	fillId: string;
	entryId: () => string;
}): AppliedFill {
	if (input.fill.portfolioId !== input.account.portfolioId) {
		throw new LedgerInvariantError('Fill portfolio does not match the ledger account');
	}
	const nextPositions = new Map(input.account.positions);
	const positionChanges = new Map<string, Position>();
	const entries: CashLedgerEntry[] = [];

	for (const fillLeg of input.fill.legs) {
		if (
			!fillLeg.quantity.greaterThan(0) ||
			!fillLeg.price.greaterThan(0) ||
			fillLeg.fee.isNegative()
		) {
			throw new LedgerInvariantError('Fill price, quantity, and fee are invalid');
		}
		const symbol = fillLeg.leg.symbol;
		const nextPosition = applyPositionLeg(nextPositions.get(symbol), {
			instrument: fillLeg.leg.instrument,
			side: fillLeg.leg.side,
			positionEffect: fillLeg.leg.positionEffect,
			quantity: fillLeg.quantity,
			price: fillLeg.price,
			fee: fillLeg.fee
		});
		nextPositions.set(symbol, nextPosition);
		positionChanges.set(symbol, nextPosition);

		const grossAmount = fillGrossAmount(fillLeg);
		entries.push({
			id: input.entryId(),
			portfolioId: input.account.portfolioId,
			fillId: input.fillId,
			type: 'trade',
			amount: fillLeg.leg.side === 'buy' ? grossAmount.negated() : grossAmount,
			currency: 'USD',
			occurredAt: input.fill.receivedAt,
			description: `${fillLeg.leg.side} ${fillLeg.quantity.toFixed()} ${symbol}`
		});
		if (fillLeg.fee.greaterThan(0)) {
			entries.push({
				id: input.entryId(),
				portfolioId: input.account.portfolioId,
				fillId: input.fillId,
				type: 'fee',
				amount: fillLeg.fee.negated(),
				currency: 'USD',
				occurredAt: input.fill.receivedAt,
				description: `Execution fee for ${symbol}`
			});
		}
	}

	const cashChange = entries.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
	const cashBalance = money(input.account.cashBalance.plus(cashChange));
	if (cashBalance.isNegative()) {
		throw new LedgerInvariantError('Fill would create a negative cash balance');
	}

	return {
		fill: input.fill,
		fillId: input.fillId,
		nextAccount: {
			portfolioId: input.account.portfolioId,
			cashBalance,
			positions: nextPositions
		},
		entries,
		positionChanges
	};
}

export function assertCashLedgerInvariant(input: {
	openingCash: Decimal;
	entries: readonly CashLedgerEntry[];
	closingCash: Decimal;
}): void {
	const expected = money(
		input.entries.reduce((cash, entry) => cash.plus(entry.amount), input.openingCash)
	);
	if (!expected.equals(money(input.closingCash))) {
		throw new LedgerInvariantError(
			`Cash ledger mismatch: expected ${expected.toFixed()}, received ${input.closingCash.toFixed()}`
		);
	}
}
