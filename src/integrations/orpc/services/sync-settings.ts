import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { ORPCError } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import * as sqlite from "drizzle-orm/sqlite-core";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";

const timestamp = () =>
	sqlite
		.integer({ mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`)
		.$onUpdate(() => /* @__PURE__ */ new Date());

const syncSettings = sqlite.sqliteTable(
	"sync_settings",
	{
		userId: sqlite
			.text("user_id")
			.notNull()
			.primaryKey()
			.references(() => schema.user.id, { onDelete: "cascade" }),
		syncDirectory: sqlite.text("sync_directory").notNull(),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(table) => [sqlite.index("sync_settings_updated_at_index").on(table.updatedAt)],
);

let syncSettingsTableReady = false;

const ensureSyncSettingsTable = async () => {
	if (syncSettingsTableReady) return;

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "sync_settings" (
			"user_id" text PRIMARY KEY NOT NULL,
			"sync_directory" text NOT NULL,
			"created_at" integer DEFAULT (unixepoch()) NOT NULL,
			"updated_at" integer DEFAULT (unixepoch()) NOT NULL,
			FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade
		);
	`);

	await db.execute(sql`CREATE INDEX IF NOT EXISTS "sync_settings_updated_at_index" ON "sync_settings" ("updated_at");`);

	syncSettingsTableReady = true;
};

const MAX_SYNC_DIRECTORY_LENGTH = 2048;
const WINDOWS_DRIVE_ROOT_REGEX = /^[A-Za-z]:[/\\]?$/;

function expandHomeDirectory(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) {
		return resolve(homedir(), path.slice(2));
	}

	return path;
}

async function normalizeAndValidateSyncDirectory(syncDirectory: string): Promise<string> {
	const trimmedPath = syncDirectory.trim();

	if (!trimmedPath) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Sync directory is required.",
		});
	}

	if (trimmedPath.length > MAX_SYNC_DIRECTORY_LENGTH) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Sync directory path is too long.",
		});
	}

	if (trimmedPath.includes("\0")) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Sync directory path is invalid.",
		});
	}

	const expandedPath = expandHomeDirectory(trimmedPath);

	if (!isAbsolute(expandedPath)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Sync directory must be an absolute path.",
		});
	}

	const normalizedPath = resolve(expandedPath);

	if (normalizedPath === "/" || WINDOWS_DRIVE_ROOT_REGEX.test(normalizedPath)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Sync directory cannot be the system root directory.",
		});
	}

	try {
		await mkdir(normalizedPath, { recursive: true });

		const syncDirectoryStats = await stat(normalizedPath);
		if (!syncDirectoryStats.isDirectory()) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Sync directory path must point to a directory.",
			});
		}

		await access(normalizedPath, constants.R_OK | constants.W_OK);
	} catch (error) {
		if (error instanceof ORPCError) throw error;

		throw new ORPCError("BAD_REQUEST", {
			message: "Sync directory must be accessible and writable.",
		});
	}

	return normalizedPath;
}

export const syncSettingsService = {
	getSyncDirectory: async (input: { userId: string }): Promise<string | null> => {
		await ensureSyncSettingsTable();

		const [record] = await db
			.select({
				syncDirectory: syncSettings.syncDirectory,
			})
			.from(syncSettings)
			.where(eq(syncSettings.userId, input.userId))
			.limit(1);

		return record?.syncDirectory ?? null;
	},

	setSyncDirectory: async (input: { userId: string; syncDirectory: string }): Promise<string> => {
		await ensureSyncSettingsTable();

		const normalizedPath = await normalizeAndValidateSyncDirectory(input.syncDirectory);

		await db
			.insert(syncSettings)
			.values({
				userId: input.userId,
				syncDirectory: normalizedPath,
			})
			.onConflictDoUpdate({
				target: syncSettings.userId,
				set: {
					syncDirectory: normalizedPath,
					updatedAt: new Date(),
				},
			});

		return normalizedPath;
	},
};
