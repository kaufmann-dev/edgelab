export function signedNumber(value: number, formatted: string) {
	if (value > 0) return `+${formatted}`;
	return formatted;
}

export function signedCurrency(formatter: Intl.NumberFormat, value: number) {
	return signedNumber(value, formatter.format(value));
}

export function formatPercent(value: number, maximumFractionDigits = 2, signed = false) {
	const formatted = `${Math.abs(value).toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits
	})}%`;
	if (value < 0) return `−${formatted}`;
	if (signed && value > 0) return `+${formatted}`;
	return formatted;
}

export function humanize(value: string) {
	return value
		.split('-')
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(' ');
}

export function toneForNumber(value: number) {
	if (value > 0) return 'text-emerald-700 dark:text-emerald-300';
	if (value < 0) return 'text-destructive';
	return 'text-foreground';
}
