export type PortfolioDataMode = 'realtime' | 'delayed';
export type PortfolioStatus = 'active' | 'archived';

export interface PortfolioSummary {
	id: string;
	name: string;
	baseCurrency: 'USD';
	startingCash: string;
	dataMode: PortfolioDataMode;
	status: PortfolioStatus;
	createdAt: Date;
	archivedAt: Date | null;
}

export interface OwnedPortfolio extends PortfolioSummary {
	ownerUserId: string;
	executionModelVersion: string;
	riskModelVersion: string;
}

export type ArchivePortfolioResult =
	| { status: 'archived'; portfolioId: string }
	| { status: 'not_found' }
	| { status: 'last_active' }
	| { status: 'open_orders' };
