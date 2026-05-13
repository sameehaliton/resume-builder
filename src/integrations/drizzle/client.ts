import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServerOnlyFn } from "@tanstack/react-start";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { schema } from "@/integrations/drizzle";
import { env } from "@/utils/env";

type QueryMethod = "run" | "all" | "get" | "values";

// During hot reload (i.e., in development), global assignment ensures the DB/client persist across reloads.

declare global {
	var __sqlite: DatabaseSync | undefined;
	var __drizzle: SqliteRemoteDatabase<typeof schema> | undefined;
}

function resolveSqlitePath(databaseUrl: string) {
	if (databaseUrl.startsWith("file:")) {
		const normalized = databaseUrl.replace(/^file:\/\//, "file:");
		const pathname = normalized.slice("file:".length);

		if (pathname.startsWith("/")) return pathname;
		return resolve(process.cwd(), pathname);
	}

	if (databaseUrl.startsWith("sqlite:")) {
		const pathname = databaseUrl.slice("sqlite:".length);
		if (pathname.startsWith("/")) return pathname;
		return resolve(process.cwd(), pathname);
	}

	if (databaseUrl.startsWith("/") || databaseUrl.startsWith("./")) {
		return resolve(process.cwd(), databaseUrl);
	}

	return resolve(process.cwd(), "reactive-resume.sqlite");
}

function getSqlite() {
	if (!globalThis.__sqlite) {
		const sqlitePath = resolveSqlitePath(env.DATABASE_URL);
		mkdirSync(dirname(sqlitePath), { recursive: true });

		globalThis.__sqlite = new DatabaseSync(sqlitePath);
		globalThis.__sqlite.exec("PRAGMA foreign_keys = ON;");
	}

	return globalThis.__sqlite;
}

function makeDrizzleClient() {
	const sqlite = getSqlite();

	return drizzle(
		async (query, params, method: QueryMethod) => {
			const statement = sqlite.prepare(query);
			const boundParams = Array.isArray(params) ? params : [];

			if (method === "run") {
				statement.run(...boundParams);
				return { rows: [] };
			}

			// drizzle-orm/sqlite-proxy expects each row as an array of column values in
			// the order they appear in the query, not as an object keyed by column name.
			statement.setReturnArrays(true);

			if (method === "get") {
				const row = statement.get(...boundParams) as unknown[] | undefined;
				return { rows: row ?? [] };
			}

			const rows = statement.all(...boundParams) as unknown[];
			return { rows };
		},
		{ schema, casing: "snake_case" },
	);
}

const getDatabaseServerFn = createServerOnlyFn(() => {
	if (!globalThis.__drizzle) {
		globalThis.__drizzle = makeDrizzleClient();
	}

	return globalThis.__drizzle;
});

export const db = getDatabaseServerFn();
