import { ORPCError } from "@orpc/client";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";
import { packetStatuses, type PacketStatus } from "@/integrations/drizzle/schema";
import { generateId } from "@/utils/string";

const packetStatusSet = new Set<PacketStatus>(packetStatuses);
let packetTablesReady = false;

const ensurePacketLifecycleTables = async () => {
	if (packetTablesReady) return;

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

	packetTablesReady = true;
};

const normalizePacketStatus = (status: string): PacketStatus => {
	if (packetStatusSet.has(status as PacketStatus)) return status as PacketStatus;
	return "draft";
};

const selectPacket = {
	id: schema.packet.id,
	title: schema.packet.title,
	status: schema.packet.status,
	resumeId: schema.packet.resumeId,
	resumeName: schema.resumeSnapshot.resumeName,
	snapshotId: schema.packet.snapshotId,
	snapshotCreatedAt: schema.resumeSnapshot.createdAt,
	sourceResumeUpdatedAt: schema.resumeSnapshot.sourceResumeUpdatedAt,
	createdAt: schema.packet.createdAt,
	updatedAt: schema.packet.updatedAt,
};

type PacketListItem = {
	id: string;
	title: string;
	status: PacketStatus;
	resumeId: string;
	resumeName: string;
	snapshotId: string;
	snapshotCreatedAt: Date;
	sourceResumeUpdatedAt: Date;
	createdAt: Date;
	updatedAt: Date;
};

const list = async (input: { userId: string }): Promise<PacketListItem[]> => {
	await ensurePacketLifecycleTables();

	const packets = await db
		.select(selectPacket)
		.from(schema.packet)
		.innerJoin(schema.resumeSnapshot, eq(schema.packet.snapshotId, schema.resumeSnapshot.id))
		.where(eq(schema.packet.userId, input.userId))
		.orderBy(desc(schema.packet.updatedAt));

	return packets.map((packet) => ({ ...packet, status: normalizePacketStatus(packet.status) }));
};

const getById = async (input: { id: string; userId: string }): Promise<PacketListItem> => {
	await ensurePacketLifecycleTables();

	const [packet] = await db
		.select(selectPacket)
		.from(schema.packet)
		.innerJoin(schema.resumeSnapshot, eq(schema.packet.snapshotId, schema.resumeSnapshot.id))
		.where(and(eq(schema.packet.id, input.id), eq(schema.packet.userId, input.userId)))
		.limit(1);

	if (!packet) throw new ORPCError("NOT_FOUND");

	return { ...packet, status: normalizePacketStatus(packet.status) };
};

const createFromResume = async (input: {
	userId: string;
	resumeId: string;
	title?: string;
}): Promise<PacketListItem> => {
	await ensurePacketLifecycleTables();

	const [resume] = await db
		.select({
			id: schema.resume.id,
			name: schema.resume.name,
			data: schema.resume.data,
			updatedAt: schema.resume.updatedAt,
		})
		.from(schema.resume)
		.where(and(eq(schema.resume.id, input.resumeId), eq(schema.resume.userId, input.userId)))
		.limit(1);

	if (!resume) throw new ORPCError("NOT_FOUND");

	const snapshotId = generateId();
	const packetId = generateId();

	await db.transaction(async (tx) => {
		await tx.insert(schema.resumeSnapshot).values({
			id: snapshotId,
			resumeId: resume.id,
			userId: input.userId,
			resumeName: resume.name,
			sourceResumeUpdatedAt: resume.updatedAt,
			data: resume.data,
		});

		await tx.insert(schema.packet).values({
			id: packetId,
			userId: input.userId,
			resumeId: resume.id,
			snapshotId,
			title: input.title?.trim() || resume.name,
			status: "draft",
		});
	});

	return getById({ id: packetId, userId: input.userId });
};

const setStatus = async (input: { id: string; userId: string; status: PacketStatus }): Promise<PacketListItem> => {
	await ensurePacketLifecycleTables();

	const [updated] = await db
		.update(schema.packet)
		.set({ status: input.status, updatedAt: new Date() })
		.where(and(eq(schema.packet.id, input.id), eq(schema.packet.userId, input.userId)))
		.returning({ id: schema.packet.id });

	if (!updated) throw new ORPCError("NOT_FOUND");

	return getById({ id: input.id, userId: input.userId });
};

export const packetService = {
	list,
	createFromResume,
	setStatus,
};
