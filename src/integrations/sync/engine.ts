import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
	conflictsDetected: number;
	conflictCopiesCreated: number;
};

export interface ArtifactSyncResult {
	syncDirectory: string;
	generatedAt: string;
	artifacts: SyncCollectionResult;
	snapshots: SyncCollectionResult;
	packets: SyncCollectionResult;
	conflicts: {
		totalDetected: number;
		totalCopiesCreated: number;
		byCollection: {
			artifacts: number;
			snapshots: number;
			packets: number;
		};
	};
	excludedDbPatterns: string[];
}

interface SyncCollectionInput<T extends { id: string }> {
	directory: string;
	collectionName: "artifacts" | "snapshots" | "packets";
	generatedAt: string;
	records: T[];
}

type SyncIndexRecord = {
	id: string;
	hash: string;
};

type SyncConflictRecord = {
	id: string;
	file: string;
	conflictCopy: string;
	reason: "hash-mismatch" | "timestamp-newer" | "hash-and-timestamp";
};

type SyncIndexPayload = {
	collection: "artifacts" | "snapshots" | "packets";
	generatedAt: string;
	count: number;
	records: SyncIndexRecord[];
	conflicts?: SyncConflictRecord[];
};

type ParsedSyncIndex = {
	generatedAt: Date | null;
	recordHashes: Map<string, string>;
};

type ExistingRecordState = {
	exists: boolean;
	hash: string | null;
	modifiedAt: Date | null;
};

function isExplicitlyExcludedDatabaseFile(filename: string): boolean {
	return SQLITE_FILE_EXCLUSION_REGEXES.some((pattern) => pattern.test(filename));
}

function isMissingFileError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	return "code" in error && error.code === "ENOENT";
}

function isConflictCopyFile(filename: string): boolean {
	return /\.conflict-[^.]+(?:-\d+)?\.json$/i.test(filename);
}

function sanitizeTimestampForFilename(timestamp: string): string {
	return timestamp.replaceAll(":", "-").replaceAll(".", "-");
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

function parseSyncIndex(raw: string): ParsedSyncIndex {
	const parsed = JSON.parse(raw) as {
		generatedAt?: unknown;
		records?: unknown;
	};

	const generatedAt =
		typeof parsed.generatedAt === "string" && !Number.isNaN(Date.parse(parsed.generatedAt))
			? new Date(parsed.generatedAt)
			: null;

	const recordHashes = new Map<string, string>();

	if (Array.isArray(parsed.records)) {
		for (const entry of parsed.records) {
			if (typeof entry !== "object" || entry === null) continue;

			const id = "id" in entry ? entry.id : null;
			const hash = "hash" in entry ? entry.hash : null;

			if (typeof id === "string" && typeof hash === "string") {
				recordHashes.set(id, hash);
			}
		}
	}

	return { generatedAt, recordHashes };
}

async function readExistingSyncIndex(directory: string): Promise<ParsedSyncIndex> {
	const indexPath = join(directory, "index.json");

	try {
		const content = await readFile(indexPath, "utf8");
		return parseSyncIndex(content);
	} catch (error) {
		if (isMissingFileError(error)) {
			return { generatedAt: null, recordHashes: new Map() };
		}

		return { generatedAt: null, recordHashes: new Map() };
	}
}

async function readExistingRecordState(filePath: string): Promise<ExistingRecordState> {
	let fileStats;
	try {
		fileStats = await stat(filePath);
	} catch (error) {
		if (isMissingFileError(error)) {
			return { exists: false, hash: null, modifiedAt: null };
		}

		throw error;
	}

	if (!fileStats.isFile()) {
		return { exists: false, hash: null, modifiedAt: null };
	}

	const content = await readFile(filePath, "utf8");

	try {
		const parsed = JSON.parse(content);
		return {
			exists: true,
			hash: hashRecord(parsed),
			modifiedAt: fileStats.mtime,
		};
	} catch {
		return {
			exists: true,
			hash: null,
			modifiedAt: fileStats.mtime,
		};
	}
}

async function getUniqueConflictCopyPath(filePath: string, generatedAt: string): Promise<string> {
	const extension = extname(filePath) || ".json";
	const filePathWithoutExtension = extension.length > 0 ? filePath.slice(0, -extension.length) : filePath;
	const timestamp = sanitizeTimestampForFilename(generatedAt);

	let attempt = 0;
	while (true) {
		const suffix = attempt === 0 ? "" : `-${attempt}`;
		const candidatePath = `${filePathWithoutExtension}.conflict-${timestamp}${suffix}${extension}`;

		try {
			await access(candidatePath);
			attempt += 1;
		} catch (error) {
			if (isMissingFileError(error)) return candidatePath;
			throw error;
		}
	}
}

function getConflictReason(input: { hashSignal: boolean; timestampSignal: boolean }): SyncConflictRecord["reason"] {
	if (input.hashSignal && input.timestampSignal) return "hash-and-timestamp";
	if (input.timestampSignal) return "timestamp-newer";
	return "hash-mismatch";
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
	const existingSyncIndex = await readExistingSyncIndex(input.directory);

	const filesToKeep = new Set(input.records.map((record) => `${record.id}.json`));
	filesToKeep.add("index.json");

	const existingFiles = await readdir(input.directory, { withFileTypes: true });
	await Promise.all(
		existingFiles.map(async (entry) => {
			if (!entry.isFile()) return;

			// Never touch SQLite database files, even if they appear in a sync directory.
			if (isExplicitlyExcludedDatabaseFile(entry.name)) return;
			if (isConflictCopyFile(entry.name)) return;

			if (extname(entry.name).toLowerCase() !== ".json") return;
			if (filesToKeep.has(entry.name)) return;

			await rm(join(input.directory, entry.name), { force: true });
		}),
	);

	const conflictRecords: SyncConflictRecord[] = [];
	const indexRecords: SyncIndexRecord[] = [];

	for (const record of input.records) {
		const filePath = join(input.directory, `${record.id}.json`);
		const incomingHash = hashRecord(record);
		indexRecords.push({ id: record.id, hash: incomingHash });

		const existingRecord = await readExistingRecordState(filePath);
		if (existingRecord.exists && existingRecord.hash !== incomingHash) {
			const previousIndexHash = existingSyncIndex.recordHashes.get(record.id) ?? null;
			const hashSignal = previousIndexHash === null || existingRecord.hash === null || existingRecord.hash !== previousIndexHash;
			const timestampSignal =
				existingRecord.modifiedAt !== null &&
				existingSyncIndex.generatedAt !== null &&
				existingRecord.modifiedAt.getTime() > existingSyncIndex.generatedAt.getTime();

			if (hashSignal || timestampSignal) {
				const conflictCopyPath = await getUniqueConflictCopyPath(filePath, input.generatedAt);
				await rename(filePath, conflictCopyPath);

				conflictRecords.push({
					id: record.id,
					file: filePath,
					conflictCopy: conflictCopyPath,
					reason: getConflictReason({ hashSignal, timestampSignal }),
				});
			}
		}

		await writeJsonAtomic(filePath, record);
	}

	const indexPayload: SyncIndexPayload = {
		collection: input.collectionName,
		generatedAt: input.generatedAt,
		count: input.records.length,
		records: indexRecords,
	};

	if (conflictRecords.length > 0) {
		indexPayload.conflicts = conflictRecords;
	}

	await writeJsonAtomic(join(input.directory, "index.json"), indexPayload);

	return {
		count: input.records.length,
		filesWritten: input.records.length + 1,
		conflictsDetected: conflictRecords.length,
		conflictCopiesCreated: conflictRecords.length,
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
		conflicts: {
			totalDetected:
				artifactResult.conflictsDetected + snapshotResult.conflictsDetected + packetResult.conflictsDetected,
			totalCopiesCreated:
				artifactResult.conflictCopiesCreated +
				snapshotResult.conflictCopiesCreated +
				packetResult.conflictCopiesCreated,
			byCollection: {
				artifacts: artifactResult.conflictsDetected,
				snapshots: snapshotResult.conflictsDetected,
				packets: packetResult.conflictsDetected,
			},
		},
		excludedDbPatterns: [...SQLITE_FILE_EXCLUSION_PATTERNS],
	};
}
