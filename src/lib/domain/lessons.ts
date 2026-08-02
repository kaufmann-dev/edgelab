export interface LearningLesson {
	slug: string;
	title: string;
	summary: string;
	takeaways: string[];
	check: {
		question: string;
		answer: string;
	};
}

export const learningLessons: LearningLesson[] = [
	{
		slug: 'orders-and-fills',
		title: 'Orders and realistic fills',
		summary:
			'An order is an instruction, not a guaranteed price. Spread, liquidity, session, and order type determine whether and where a simulated fill can occur.',
		takeaways: [
			'Market orders prioritize execution; limit orders prioritize price.',
			'A quote touching a resting limit does not prove that enough volume traded there.',
			'Stop orders become active only after their trigger condition is observed.'
		],
		check: {
			question: 'Why can a market buy fill above the last trade?',
			answer:
				'A buy executes against available asks, while the last trade may be older or on the other side.'
		}
	},
	{
		slug: 'position-sizing',
		title: 'Position sizing',
		summary:
			'Position size connects a trade idea to portfolio survival. Start with an invalidation point and a maximum acceptable loss, then calculate quantity.',
		takeaways: [
			'Risk per share is entry minus invalidation for a long trade.',
			'Concentration and correlated positions can make several small trades one large bet.',
			'A calculated size is a ceiling, not a recommendation.'
		],
		check: {
			question: 'What should change first when the stop is farther from entry?',
			answer: 'Quantity should fall if the maximum planned loss is unchanged.'
		}
	},
	{
		slug: 'short-selling',
		title: 'Short selling',
		summary:
			'A short position profits when the security falls and loses when it rises. Loss is theoretically unbounded, and real accounts also face borrow constraints.',
		takeaways: [
			'Selling held shares and selling short are separate position effects.',
			'A buy-to-cover order reduces or closes a short position.',
			'Simulated borrow assumptions must be labeled because market data does not prove availability.'
		],
		check: {
			question: 'Why is short risk not symmetric with long risk?',
			answer: 'A long can fall only to zero, while a short can keep losing as price rises.'
		}
	},
	{
		slug: 'options-contracts',
		title: 'Options contracts',
		summary:
			'An equity option represents a contract with a strike, expiration, call or put right, and a deliverable multiplier.',
		takeaways: [
			'Premium is quoted per share, so cash premium equals price × multiplier × contracts.',
			'Long options can expire worthless even when the directional thesis was partly right.',
			'Nonstandard deliverables require special handling and are not safe to assume are 100 shares.'
		],
		check: {
			question: 'What is the cash premium for two $1.25 contracts with a 100 multiplier?',
			answer: '$250 before fees and slippage.'
		}
	},
	{
		slug: 'defined-risk-spreads',
		title: 'Defined-risk option spreads',
		summary:
			'Multi-leg spreads combine options into one strategy. A useful simulator fills the complete combination atomically rather than inventing orphan legs.',
		takeaways: [
			'Debit spreads risk the debit paid.',
			'Credit-spread maximum loss is spread width less credit, adjusted for multiplier and contracts.',
			'Wide synthetic bid/ask spreads indicate weak executable liquidity.'
		],
		check: {
			question: 'Why should a four-leg order not fill one leg at a time in this simulator?',
			answer: 'The requested strategy and its bounded risk depend on all legs executing together.'
		}
	},
	{
		slug: 'greeks-and-volatility',
		title: 'Greeks and implied volatility',
		summary:
			'Greeks describe modeled sensitivities, not promises. Delta, gamma, theta, and vega change as the underlying, time, and implied volatility change.',
		takeaways: [
			'Missing Greeks are unknown—not zero.',
			'Theta is not a fixed daily debit and often accelerates near expiration.',
			'Aggregate exposure uses signed contracts and each contract multiplier.'
		],
		check: {
			question: 'Does a 0.50 delta guarantee a 50-cent move for a $1 stock move?',
			answer: 'No. Delta is a local model sensitivity and changes with market inputs.'
		}
	},
	{
		slug: 'liquidity-and-market-data',
		title: 'Liquidity and market-data freshness',
		summary:
			'Prices are meaningful only with source time and entitlement. Real-time, delayed, stale, and historical data support different conclusions.',
		takeaways: [
			'Never submit a quote-dependent order when the feed is stale or disconnected.',
			'Open interest is prior-day context, not current executable size.',
			'Delayed simulation must use delayed source time to prevent lookahead.'
		],
		check: {
			question: 'Why must delayed fills use the delayed clock?',
			answer:
				'Using wall time could let an order act on market events the simulated trader had not seen.'
		}
	},
	{
		slug: 'measuring-an-edge',
		title: 'Measuring a trading edge',
		summary:
			'Return alone cannot separate skill from risk or luck. Compare outcomes with a benchmark and inspect drawdown, consistency, execution, and adherence separately.',
		takeaways: [
			'Use a meaningful sample before drawing a conclusion.',
			'Expectancy combines win rate with average win and loss.',
			'Journal findings should link to the trades that support them.'
		],
		check: {
			question: 'Why does EdgeLab avoid one talent score?',
			answer:
				'A composite can hide whether results came from risk, execution, consistency, or process.'
		}
	}
];
