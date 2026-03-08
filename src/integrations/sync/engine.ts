import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";

const SQLITE_FILE_EXCLUSION_PATTERNS = ["*.sqlite", "*.sqlite3", "*.db", "*-wal", "*-shm"] as const;
const SQLITE_FILE_EXCLUSION_REGEXES = [
	/\.(sqlite|sqlite3|db)$/i,
	/\.(sqlite|sqlite3|db)-(wal|shm)$/i,
	/-wal$/i,
	/-shm$/i,
] as const;

const SYNC_DIRECTORIES = {
	artifacts: "artifacts",
	snapshots: "snapshots",
	packets: "packets",
} as const;

let packetTablesReadyForSync = false;

type SyncedArtifactRecord = {
	id: string;
	userId: string;
	name: string;
	slug: string;
	tags: string[];
	data: unknown;
	createdAt: string;
	updatedAt: string;
};

type SyncedSnapshotRecord = {
	id: string;
	userId: string;
	resumeId: string;
	resumeName: string;
	sourceResumeUpdatedAt: string;
	data: unknown;
	createdAt: string;
};

type SyncedPacketRecord = {
	id: string;
	userId: string;
	resumeId: string;
	snapshotId: string;
	title: string;
	status: string;
	createdAt: string;
	updatedAt: string;
};

type SyncCollectionResult = {
	count: number;
	filesWritten: number;
};

export interface ArtifactSyncResult {
	syncDirectory: string;
	generatedAt: string;
	artifacts: SyncCollectionResult;
	snapshots: SyncCollectionResult;
	packets: SyncCollectionResult;
	excludedDbPatterns: string[];
}

interface SyncCollectionInput<T extends { id: string }> {
	directory: string;
	collectionName: "artifacts" | "snapshots" | "packets";
	generatedAt: string;
	records: T[];
}

function isExplicitlyExcludedDatabaseFile(filename: string): boolean {
	return SQLITE_FILE_EXCLUSION_REGEXES.some((pattern) => pattern.test(filename));
}

function hashRecord(value: unknown): string {
	const serialized = JSON.stringify(value);
	return createHash("sha256").update(serialized).digest("hex");
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	const contents = `${JSON.stringify(payload, null, 2)}\n`;

	await writeFile(tempPath, contents, "utf8");
	await rename(tempPath, filePath);
}

async function ensurePacketLifecycleTablesForSync() {
	if (packetTablesReadyForSync) return;

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "resume_snapshot" (
			"id" text PRIMARY KEY NOT NULL,
			"resume_id" text NOT NULL,
			"user_id" text NOT NULL,
			"resume_name" text NOT NULL,
			"source_resume_updated_at" integer NOT NULL,
			"data" text NOT NULL,
			"created_at" integer DEFAULT (unixepoch()) NOT NULL,
			FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE cascade,
			FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade
		);
	`);

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "packet" (
			"id" text PRIMARY KEY NOT NULL,
			"user_id" text NOT NULL,
			"resume_id" text NOT NULL,
			"snapshot_id" text NOT NULL,
			"title" text NOT NULL,
			"status" text DEFAULT 'draft' NOT NULL,
			"created_at" integer DEFAULT (unixepoch()) NOT NULL,
			"updated_at" integer DEFAULT (unixepoch()) NOT NULL,
			FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade,
			FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE cascade,
			FOREIGN KEY ("snapshot_id") REFERENCES "resume_snapshot"("id") ON DELETE cascade
		);
	`);

	await Promise.all([
		db.execute(sql`CREATE INDEX IF NOT EXISTS "resume_snapshot_user_id_index" ON "resume_snapshot" ("user_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "resume_snapshot_resume_id_index" ON "resume_snapshot" ("resume_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "resume_snapshot_created_at_index" ON "resume_snapshot" ("created_at");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "packet_user_id_index" ON "packet" ("user_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "packet_resume_id_index" ON "packet" ("resume_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "packet_snapshot_id_index" ON "packet" ("snapshot_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "packet_status_user_id_index" ON "packet" ("status", "user_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "packet_updated_at_index" ON "packet" ("updated_at");`),
	]);

	packetTablesReadyForSync = true;
}

async function syncCollection<T extends { id: string }>(input: SyncCollectionInput<T>): Promise<SyncCollectionResult> {
	await mkdir(input.directory, { recursive: true });

	const filesToKeep = new Set(input.records.map((record) => `${record.id}.json`));
	filesToKeep.add("index.json");

	const existingFiles = await readdir(input.directory, { withFileTypes: true });
	await Promise.all(
		existingFiles.map(async (entry) => {
			if (!entry.isFile()) return;

			// Never touch SQLite database files, even if they appear in a sync directory.
			if (isExplicitlyExcludedDatabaseFile(entry.name)) return;

			if (extname(entry.name).toLowerCase() !== ".json") return;
			if (filesToKeep.has(entry.name)) return;

			await rm(join(input.directory, entry.name), { force: true });
		}),
	);

	await Promise.all(
		input.records.map(async (record) => {
			const filePath = join(input.directory, `${record.id}.json`);
			await writeJsonAtomic(filePath, record);
		}),
	);

	await writeJsonAtomic(join(input.directory, "index.json"), {
		collection: input.collectionName,
		generatedAt: input.generatedAt,
		count: input.records.length,
		records: input.records.map((record) => ({
			id: record.id,
			hash: hashRecord(record),
		})),
	});

	return {
		count: input.records.length,
		filesWritten: input.records.length + 1,
	};
}

function toIsoTimestamp(value: Date): string {
	return value.toISOString();
}

export async function syncUserArtifactsToDirectory(input: {
	userId: string;
	syncDirectory: string;
}): Promise<ArtifactSyncResult> {
	await ensurePacketLifecycleTablesForSync();

	const [artifacts, snapshots, packets] = await Promise.all([
		db
			.select({
				id: schema.resume.id,
				userId: schema.resume.userId,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(eq(schema.resume.userId, input.userId))
			.orderBy(asc(schema.resume.updatedAt), asc(schema.resume.id)),
		db
			.select({
				id: schema.resumeSnapshot.id,
				userId: schema.resumeSnapshot.userId,
				resumeId: schema.resumeSnapshot.resumeId,
				resumeName: schema.resumeSnapshot.resumeName,
				sourceResumeUpdatedAt: schema.resumeSnapshot.sourceResumeUpdatedAt,
				data: schema.resumeSnapshot.data,
				createdAt: schema.resumeSnapshot.createdAt,
			})
			.from(schema.resumeSnapshot)
			.where(eq(schema.resumeSnapshot.userId, input.userId))
			.orderBy(asc(schema.resumeSnapshot.createdAt), asc(schema.resumeSnapshot.id)),
		db
			.select({
				id: schema.packet.id,
				userId: schema.packet.userId,
				resumeId: schema.packet.resumeId,
				snapshotId: schema.packet.snapshotId,
				title: schema.packet.title,
				status: schema.packet.status,
				createdAt: schema.packet.createdAt,
				updatedAt: schema.packet.updatedAt,
			})
			.from(schema.packet)
			.where(eq(schema.packet.userId, input.userId))
			.orderBy(asc(schema.packet.updatedAt), asc(schema.packet.id)),
	]);

	const serializedArtifacts: SyncedArtifactRecord[] = artifacts.map((record) => ({
		id: record.id,
		userId: record.userId,
		name: record.name,
		slug: record.slug,
		tags: record.tags,
		data: record.data,
		createdAt: toIsoTimestamp(record.createdAt),
		updatedAt: toIsoTimestamp(record.updatedAt),
	}));

	const serializedSnapshots: SyncedSnapshotRecord[] = snapshots.map((record) => ({
		id: record.id,
		userId: record.userId,
		resumeId: record.resumeId,
		resumeName: record.resumeName,
		sourceResumeUpdatedAt: toIsoTimestamp(record.sourceResumeUpdatedAt),
		data: record.data,
		createdAt: toIsoTimestamp(record.createdAt),
	}));

	const serializedPackets: SyncedPacketRecord[] = packets.map((record) => ({
		id: record.id,
		userId: record.userId,
		resumeId: record.resumeId,
		snapshotId: record.snapshotId,
		title: record.title,
		status: record.status,
		createdAt: toIsoTimestamp(record.createdAt),
		updatedAt: toIsoTimestamp(record.updatedAt),
	}));

	const generatedAt = new Date().toISOString();

	const [artifactResult, snapshotResult, packetResult] = await Promise.all([
		syncCollection({
			collectionName: "artifacts",
			directory: join(input.syncDirectory, SYNC_DIRECTORIES.artifacts),
			generatedAt,
			records: serializedArtifacts,
		}),
		syncCollection({
			collectionName: "snapshots",
			directory: join(input.syncDirectory, SYNC_DIRECTORIES.snapshots),
			generatedAt,
			records: serializedSnapshots,
		}),
		syncCollection({
			collectionName: "packets",
			directory: join(input.syncDirectory, SYNC_DIRECTORIES.packets),
			generatedAt,
			records: serializedPackets,
		}),
	]);

	return {
		syncDirectory: input.syncDirectory,
		generatedAt,
		artifacts: artifactResult,
		snapshots: snapshotResult,
		packets: packetResult,
		excludedDbPatterns: [...SQLITE_FILE_EXCLUSION_PATTERNS],
	};
}
