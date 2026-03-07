import { sql } from "drizzle-orm";
import * as sqlite from "drizzle-orm/sqlite-core";
import { defaultResumeData, type ResumeData } from "../../schema/resume/data";
import { generateId } from "../../utils/string";

const timestamp = () =>
	sqlite
		.integer({ mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`)
		.$onUpdate(() => /* @__PURE__ */ new Date());

export const user = sqlite.sqliteTable(
	"user",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		image: sqlite.text("image"),
		name: sqlite.text("name").notNull(),
		email: sqlite.text("email").notNull().unique(),
		emailVerified: sqlite.integer("email_verified", { mode: "boolean" }).notNull().default(false),
		username: sqlite.text("username").notNull().unique(),
		displayUsername: sqlite.text("display_username").notNull().unique(),
		twoFactorEnabled: sqlite.integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(t) => [sqlite.index("user_created_at_index").on(t.createdAt)],
);

export const session = sqlite.sqliteTable(
	"session",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		token: sqlite.text("token").notNull().unique(),
		ipAddress: sqlite.text("ip_address"),
		userAgent: sqlite.text("user_agent"),
		userId: sqlite
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: sqlite.integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(t) => [sqlite.index("session_token_user_id_index").on(t.token, t.userId), sqlite.index("session_expires_at_index").on(t.expiresAt)],
);

export const account = sqlite.sqliteTable(
	"account",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		accountId: sqlite.text("account_id").notNull(),
		providerId: sqlite.text("provider_id").notNull().default("credential"),
		userId: sqlite
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		scope: sqlite.text("scope"),
		idToken: sqlite.text("id_token"),
		password: sqlite.text("password"),
		accessToken: sqlite.text("access_token"),
		refreshToken: sqlite.text("refresh_token"),
		accessTokenExpiresAt: sqlite.integer("access_token_expires_at", { mode: "timestamp" }),
		refreshTokenExpiresAt: sqlite.integer("refresh_token_expires_at", { mode: "timestamp" }),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(t) => [sqlite.index("account_user_id_index").on(t.userId)],
);

export const verification = sqlite.sqliteTable("verification", {
	id: sqlite
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	identifier: sqlite.text("identifier").notNull().unique(),
	value: sqlite.text("value").notNull(),
	expiresAt: sqlite.integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
	updatedAt: timestamp(),
});

export const twoFactor = sqlite.sqliteTable(
	"two_factor",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: sqlite
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		secret: sqlite.text("secret"),
		backupCodes: sqlite.text("backup_codes"),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(t) => [sqlite.index("two_factor_user_id_index").on(t.userId), sqlite.index("two_factor_secret_index").on(t.secret)],
);

export const passkey = sqlite.sqliteTable(
	"passkey",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: sqlite.text("name"),
		aaguid: sqlite.text("aaguid"),
		publicKey: sqlite.text("public_key").notNull(),
		credentialID: sqlite.text("credential_id").notNull(),
		counter: sqlite.integer("counter").notNull(),
		deviceType: sqlite.text("device_type").notNull(),
		backedUp: sqlite.integer("backed_up", { mode: "boolean" }).notNull().default(false),
		transports: sqlite.text("transports").notNull(),
		userId: sqlite
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(t) => [sqlite.index("passkey_user_id_index").on(t.userId)],
);

export const resume = sqlite.sqliteTable(
	"resume",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: sqlite.text("name").notNull(),
		slug: sqlite.text("slug").notNull(),
		tags: sqlite.text("tags", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
		isPublic: sqlite.integer("is_public", { mode: "boolean" }).notNull().default(false),
		isLocked: sqlite.integer("is_locked", { mode: "boolean" }).notNull().default(false),
		password: sqlite.text("password"),
		data: sqlite
			.text("data", { mode: "json" })
			.notNull()
			.$type<ResumeData>()
			.$defaultFn(() => defaultResumeData),
		userId: sqlite
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(t) => [
		sqlite.unique("resume_slug_user_id_unique").on(t.slug, t.userId),
		sqlite.index("resume_user_id_index").on(t.userId),
		sqlite.index("resume_created_at_index").on(t.createdAt),
		sqlite.index("resume_user_id_updated_at_index").on(t.userId, t.updatedAt),
		sqlite.index("resume_is_public_slug_user_id_index").on(t.isPublic, t.slug, t.userId),
	],
);

export const resumeStatistics = sqlite.sqliteTable("resume_statistics", {
	id: sqlite
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	views: sqlite.integer("views").notNull().default(0),
	downloads: sqlite.integer("downloads").notNull().default(0),
	lastViewedAt: sqlite.integer("last_viewed_at", { mode: "timestamp" }),
	lastDownloadedAt: sqlite.integer("last_downloaded_at", { mode: "timestamp" }),
	resumeId: sqlite
		.text("resume_id")
		.unique()
		.notNull()
		.references(() => resume.id, { onDelete: "cascade" }),
	createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
	updatedAt: timestamp(),
});

export const apikey = sqlite.sqliteTable(
	"apikey",
	{
		id: sqlite
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: sqlite.text("name"),
		start: sqlite.text("start"),
		prefix: sqlite.text("prefix"),
		key: sqlite.text("key").notNull(),
		configId: sqlite.text("config_id").notNull().default("default"),
		referenceId: sqlite
			.text("reference_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		refillInterval: sqlite.integer("refill_interval"),
		refillAmount: sqlite.integer("refill_amount"),
		lastRefillAt: sqlite.integer("last_refill_at", { mode: "timestamp" }),
		enabled: sqlite.integer("enabled", { mode: "boolean" }).notNull().default(true),
		rateLimitEnabled: sqlite.integer("rate_limit_enabled", { mode: "boolean" }).notNull().default(false),
		rateLimitTimeWindow: sqlite.integer("rate_limit_time_window"),
		rateLimitMax: sqlite.integer("rate_limit_max"),
		requestCount: sqlite.integer("request_count").notNull().default(0),
		remaining: sqlite.integer("remaining"),
		lastRequest: sqlite.integer("last_request", { mode: "timestamp" }),
		expiresAt: sqlite.integer("expires_at", { mode: "timestamp" }),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
		permissions: sqlite.text("permissions"),
		metadata: sqlite.text("metadata", { mode: "json" }),
	},
	(t) => [
		sqlite.index("apikey_user_id_index").on(t.referenceId),
		sqlite.index("apikey_key_index").on(t.key),
		sqlite.index("apikey_enabled_user_id_index").on(t.enabled, t.referenceId),
	],
);
