import type { MassiveMarketHoliday } from '$lib/server/market-data';
import { getMarketDataProvider } from '$lib/server/market';

export type UsEquitySession = 'regular' | 'extended' | 'closed';

const newYorkDateTime = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'America/New_York',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

const CALENDAR_CACHE_MILLISECONDS = 6 * 60 * 60 * 1000;
let calendarCache: { loadedAt: number; holidays: readonly MassiveMarketHoliday[] } | undefined;

interface NewYorkDateTimeParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function newYorkParts(value: Date): NewYorkDateTimeParts {
	if (Number.isNaN(value.getTime())) throw new Error('Market time is invalid');
	const parts = new Map(
		newYorkDateTime
			.formatToParts(value)
			.filter((part) => part.type !== 'literal')
			.map((part) => [part.type, Number(part.value)] as const)
	);
	const part = (name: Intl.DateTimeFormatPartTypes): number => {
		const result = parts.get(name);
		if (result === undefined) throw new Error(`Could not resolve New York ${name}`);
		return result;
	};
	return {
		year: part('year'),
		month: part('month'),
		day: part('day'),
		hour: part('hour'),
		minute: part('minute'),
		second: part('second')
	};
}

function dateKey(parts: Pick<NewYorkDateTimeParts, 'year' | 'month' | 'day'>): string {
	return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function newYorkLocalToUtc(input: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}): Date {
	const desiredAsUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
	let estimate = desiredAsUtc;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const actual = newYorkParts(new Date(estimate));
		const actualAsUtc = Date.UTC(
			actual.year,
			actual.month - 1,
			actual.day,
			actual.hour,
			actual.minute,
			actual.second
		);
		const correction = desiredAsUtc - actualAsUtc;
		if (correction === 0) return new Date(estimate);
		estimate += correction;
	}
	throw new Error('Could not resolve New York market time');
}

function holidayForDate(
	date: string,
	holidays: readonly MassiveMarketHoliday[]
): MassiveMarketHoliday | undefined {
	const matches = holidays.filter((holiday) => holiday.date === date);
	return matches.find((holiday) => holiday.status === 'closed') ?? matches[0];
}

function isWeekend(parts: Pick<NewYorkDateTimeParts, 'year' | 'month' | 'day'>): boolean {
	const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
	return weekday === 0 || weekday === 6;
}

function sessionMinute(parts: Pick<NewYorkDateTimeParts, 'hour' | 'minute'>): number {
	return parts.hour * 60 + parts.minute;
}

export function logicalMarketTime(attemptAt: Date, delayMilliseconds: number): Date {
	if (!Number.isFinite(delayMilliseconds) || delayMilliseconds < 0) {
		throw new Error('Market-data delay must be non-negative');
	}
	return new Date(attemptAt.getTime() - delayMilliseconds);
}

export function usEquityMarketDate(at: Date): string {
	return dateKey(newYorkParts(at));
}

export function usEquitySessionAt(
	at: Date,
	holidays: readonly MassiveMarketHoliday[]
): UsEquitySession {
	const parts = newYorkParts(at);
	if (isWeekend(parts)) return 'closed';
	const holiday = holidayForDate(dateKey(parts), holidays);
	if (holiday?.status === 'closed') return 'closed';

	const minute = sessionMinute(parts);
	const regularOpen = 9 * 60 + 30;
	if (holiday?.status === 'early-close') {
		if (!holiday.open || !holiday.close) return 'closed';
		if (at >= holiday.open && at < holiday.close) return 'regular';
		return minute >= 4 * 60 && at < holiday.open ? 'extended' : 'closed';
	}
	if (minute >= regularOpen && minute < 16 * 60) return 'regular';
	if (minute >= 4 * 60 && minute < 20 * 60) return 'extended';
	return 'closed';
}

export function orderAllowsSession(input: {
	session: UsEquitySession;
	extendedHours: boolean;
	orderType: string;
	allStockLegs: boolean;
}): boolean {
	if (input.session === 'regular') return true;
	return (
		input.session === 'extended' &&
		input.extendedHours &&
		input.orderType === 'limit' &&
		input.allStockLegs
	);
}

function nextCalendarDate(parts: NewYorkDateTimeParts, offset: number) {
	const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate()
	};
}

/** Returns the wall-clock instant when a DAY order's logical Massive session ends. */
export function dayOrderExpiration(input: {
	acceptedAt: Date;
	delayMilliseconds: number;
	extendedHours: boolean;
	holidays: readonly MassiveMarketHoliday[];
}): Date {
	const logicalAcceptedAt = logicalMarketTime(input.acceptedAt, input.delayMilliseconds);
	const acceptedParts = newYorkParts(logicalAcceptedAt);
	for (let offset = 0; offset < 15; offset += 1) {
		const candidate = nextCalendarDate(acceptedParts, offset);
		if (isWeekend({ ...candidate })) continue;
		const holiday = holidayForDate(dateKey(candidate), input.holidays);
		if (holiday?.status === 'closed') continue;
		const logicalClose =
			holiday?.status === 'early-close'
				? holiday.close
				: newYorkLocalToUtc({
						year: candidate.year,
						month: candidate.month,
						day: candidate.day,
						hour: input.extendedHours ? 20 : 16,
						minute: 0
					});
		if (!logicalClose) continue;
		if (offset === 0 && logicalAcceptedAt >= logicalClose) continue;
		return new Date(logicalClose.getTime() + input.delayMilliseconds);
	}
	throw new Error('Could not find a market-session boundary for the DAY order');
}

/** Returns the New York trading date of the session assigned to a DAY order. */
export function dayOrderMarketDate(input: {
	acceptedAt: Date;
	delayMilliseconds: number;
	extendedHours: boolean;
	holidays: readonly MassiveMarketHoliday[];
}): string {
	const expiresAt = dayOrderExpiration(input);
	return usEquityMarketDate(logicalMarketTime(expiresAt, input.delayMilliseconds));
}

export async function getMassiveMarketHolidays(
	now = new Date()
): Promise<readonly MassiveMarketHoliday[]> {
	if (calendarCache && now.getTime() - calendarCache.loadedAt < CALENDAR_CACHE_MILLISECONDS) {
		return calendarCache.holidays;
	}
	const holidays = await getMarketDataProvider().getUpcomingMarketHolidays();
	calendarCache = { loadedAt: now.getTime(), holidays };
	return holidays;
}

export function resetMarketHolidayCacheForTests(): void {
	calendarCache = undefined;
}
