export interface AuthUser {
	id: string;
	issuer: string;
	subject: string;
	email: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}

export interface AuthSession {
	createdAt: Date;
	lastActiveAt: Date;
	idleExpiresAt: Date;
	absoluteExpiresAt: Date;
}

export interface AuthenticatedSession {
	user: AuthUser;
	session: AuthSession;
}

export interface OidcIdentity {
	issuer: string;
	subject: string;
	email: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}

export interface LoginRequest {
	state: string;
	nonce: string;
	codeVerifierCiphertext: string;
	returnTo: string;
	createdAt: Date;
	expiresAt: Date;
}
