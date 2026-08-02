import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestampWithTimezone = (name: string) =>
	timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
	'app_users',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		issuer: text('issuer').notNull(),
		subject: text('subject').notNull(),
		email: text('email'),
		displayName: text('display_name'),
		avatarUrl: text('avatar_url'),
		createdAt: timestampWithTimezone('created_at').notNull().defaultNow(),
		updatedAt: timestampWithTimezone('updated_at').notNull().defaultNow(),
		lastLoginAt: timestampWithTimezone('last_login_at').notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('app_users_issuer_subject_uidx').on(table.issuer, table.subject),
		index('app_users_last_login_at_idx').on(table.lastLoginAt)
	]
);

export const authSessions = pgTable(
	'auth_sessions',
	{
		tokenHash: text('token_hash').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		idTokenCiphertext: text('id_token_ciphertext').notNull(),
		createdAt: timestampWithTimezone('created_at').notNull(),
		lastActiveAt: timestampWithTimezone('last_active_at').notNull(),
		idleExpiresAt: timestampWithTimezone('idle_expires_at').notNull(),
		absoluteExpiresAt: timestampWithTimezone('absolute_expires_at').notNull()
	},
	(table) => [
		index('auth_sessions_user_id_idx').on(table.userId),
		index('auth_sessions_idle_expires_at_idx').on(table.idleExpiresAt),
		index('auth_sessions_absolute_expires_at_idx').on(table.absoluteExpiresAt),
		check(
			'auth_sessions_idle_not_after_absolute_check',
			sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`
		),
		check('auth_sessions_activity_order_check', sql`${table.createdAt} <= ${table.lastActiveAt}`)
	]
);

export const oidcLoginRequests = pgTable(
	'oidc_login_requests',
	{
		tokenHash: text('token_hash').primaryKey(),
		state: text('state').notNull(),
		nonce: text('nonce').notNull(),
		codeVerifierCiphertext: text('code_verifier_ciphertext').notNull(),
		returnTo: text('return_to').notNull(),
		createdAt: timestampWithTimezone('created_at').notNull(),
		expiresAt: timestampWithTimezone('expires_at').notNull()
	},
	(table) => [
		uniqueIndex('oidc_login_requests_state_uidx').on(table.state),
		index('oidc_login_requests_expires_at_idx').on(table.expiresAt),
		check('oidc_login_requests_expiry_order_check', sql`${table.createdAt} < ${table.expiresAt}`)
	]
);
