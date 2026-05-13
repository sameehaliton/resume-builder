import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { definePlugin } from "nitro";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

function resolveSqlitePath(databaseUrl: string | undefined): string {
	if (!databaseUrl) return resolve(process.cwd(), "reactive-resume.sqlite");

	if (databaseUrl.startsWith("file:")) {
		const pathname = databaseUrl.replace(/^file:\/\//, "file:").slice("file:".length);
		return pathname.startsWith("/") ? pathname : resolve(process.cwd(), pathname);
	}

	if (databaseUrl.startsWith("sqlite:")) {
		const pathname = databaseUrl.slice("sqlite:".length);
		return pathname.startsWith("/") ? pathname : resolve(process.cwd(), pathname);
	}

	if (databaseUrl.startsWith("/") || databaseUrl.startsWith("./")) {
		return resolve(process.cwd(), databaseUrl);
	}

	return resolve(process.cwd(), "reactive-resume.sqlite");
}

function listMigrationFiles(): { name: string; path: string }[] {
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({ name: entry.name, path: join(MIGRATIONS_DIR, entry.name, "migration.sql") }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function splitStatements(sql: string): string[] {
	return sql
		.split(/--> statement-breakpoint/g)
		.map((statement) => statement.trim())
		.filter(Boolean);
}

async function migrateDatabase() {
	console.log("⌛ Running database migrations...");

	const sqlitePath = resolveSqlitePath(process.env.DATABASE_URL);
	mkdirSync(dirname(sqlitePath), { recursive: true });

	const database = new DatabaseSync(sqlitePath);

	try {
		database.exec("PRAGMA foreign_keys = ON;");
		database.exec(
			'CREATE TABLE IF NOT EXISTS "_migrations" ("name" text PRIMARY KEY NOT NULL, "applied_at" integer DEFAULT (unixepoch()) NOT NULL);',
		);

		const appliedStatement = database.prepare('SELECT "name" FROM "_migrations";');
		const applied = new Set(appliedStatement.all().map((row) => (row as { name: string }).name));

		const recordStatement = database.prepare('INSERT INTO "_migrations" ("name") VALUES (?);');

		for (const migration of listMigrationFiles()) {
			if (applied.has(migration.name)) continue;

			const sql = readFileSync(migration.path, "utf8");
			const statements = splitStatements(sql);

			database.exec("BEGIN;");
			try {
				for (const statement of statements) {
					database.exec(statement);
				}
				recordStatement.run(migration.name);
				database.exec("COMMIT;");
			} catch (error) {
				database.exec("ROLLBACK;");
				throw error;
			}

			console.log(`  • applied ${migration.name}`);
		}

		console.log("✅ Database migrations completed");
	} catch (error) {
		console.error("🚨 Database migrations failed:", error);
		throw error;
	} finally {
		database.close();
	}
}

export default definePlugin(async () => {
	await migrateDatabase();
});
