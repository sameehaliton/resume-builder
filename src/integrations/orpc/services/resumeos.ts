import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";
import { JSONResumeExporter } from "@/integrations/export/json-resume";
import { runQuality, type BulletScore, type QualityReport } from "@/integrations/resumeos/quality";
import { getStorageService } from "./storage";

type QualityProvider = "local-rule-engine";

export interface QualityBulletReport {
	bullets: BulletScore[];
}

export interface QualityScoreResult {
	resumeId: string;
	generatedAt: Date;
	score: number;
	bulletReport: QualityBulletReport;
	report: QualityReport;
	storageKey: string;
	provider: QualityProvider;
}

interface PersistedQualityScoreResult
	extends Omit<QualityScoreResult, "generatedAt"> {
	generatedAt: string;
}

const jsonEncoder = new TextEncoder();
const jsonDecoder = new TextDecoder();

const buildQualityReportStorageKey = (userId: string, resumeId: string) =>
	`resumeos/${userId}/quality/${resumeId}/latest.json`;

const toPersistedPayload = (result: QualityScoreResult): PersistedQualityScoreResult => ({
	...result,
	generatedAt: result.generatedAt.toISOString(),
});

const fromPersistedPayload = (value: unknown): QualityScoreResult | null => {
	if (!value || typeof value !== "object") return null;

	const payload = value as Partial<PersistedQualityScoreResult>;
	if (typeof payload.resumeId !== "string") return null;
	if (typeof payload.generatedAt !== "string") return null;
	if (typeof payload.score !== "number") return null;
	if (typeof payload.storageKey !== "string") return null;
	if (payload.provider !== "local-rule-engine") return null;
	if (!payload.report || typeof payload.report !== "object") return null;

	const generatedAt = new Date(payload.generatedAt);
	if (Number.isNaN(generatedAt.getTime())) return null;

	const report = payload.report as QualityReport;
	const bulletScores = Array.isArray(report.bulletScores) ? report.bulletScores : [];

	return {
		resumeId: payload.resumeId,
		generatedAt,
		score: payload.score,
		bulletReport: { bullets: bulletScores },
		report,
		storageKey: payload.storageKey,
		provider: payload.provider,
	};
};

const persistQualityScoreResult = async (input: { storageKey: string; result: QualityScoreResult }) => {
	await getStorageService().write({
		key: input.storageKey,
		contentType: "application/json",
		data: jsonEncoder.encode(JSON.stringify(toPersistedPayload(input.result), null, 2)),
	});
};

const getPersistedQualityScoreResult = async (input: {
	userId: string;
	resumeId: string;
}): Promise<QualityScoreResult | null> => {
	const storageKey = buildQualityReportStorageKey(input.userId, input.resumeId);
	const storageObject = await getStorageService().read(storageKey);
	if (!storageObject) return null;

	try {
		const raw = jsonDecoder.decode(storageObject.data);
		return fromPersistedPayload(JSON.parse(raw));
	} catch {
		return null;
	}
};

const score = async (input: {
	userId: string;
	resumeId: string;
	threshold?: number;
	targetKeywords?: string[];
}): Promise<QualityScoreResult> => {
	const [resume] = await db
		.select({
			id: schema.resume.id,
			data: schema.resume.data,
		})
import { and, desc, eq, sql } from "drizzle-orm";
import * as sqlite from "drizzle-orm/sqlite-core";
import { atsReportSchema, evaluateAtsReport, type AtsReport } from "@/integrations/resumeos";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";
import { generateId } from "@/utils/string";

const timestamp = () =>
	sqlite
		.integer({ mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`)
		.$onUpdate(() => /* @__PURE__ */ new Date());

const resumeAtsReport = sqlite.sqliteTable(
	"resume_ats_report",
	{
		id: sqlite.text("id").notNull().primaryKey(),
		userId: sqlite
			.text("user_id")
			.notNull()
			.references(() => schema.user.id, { onDelete: "cascade" }),
		resumeId: sqlite
			.text("resume_id")
			.notNull()
			.references(() => schema.resume.id, { onDelete: "cascade" }),
		report: sqlite.text("report").notNull(),
		score: sqlite.integer("score").notNull(),
		threshold: sqlite.integer("threshold").notNull(),
		isPassing: sqlite.integer("is_passing", { mode: "boolean" }).notNull(),
		jobDescription: sqlite.text("job_description"),
		keywords: sqlite.text("keywords").notNull().default("[]"),
		createdAt: sqlite.integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updatedAt: timestamp(),
	},
	(table) => [
		sqlite.unique("resume_ats_report_user_resume_unique").on(table.userId, table.resumeId),
		sqlite.index("resume_ats_report_user_id_index").on(table.userId),
		sqlite.index("resume_ats_report_resume_id_index").on(table.resumeId),
		sqlite.index("resume_ats_report_updated_at_index").on(table.updatedAt),
	],
);

let atsReportTableReady = false;

const ensureAtsReportTable = async () => {
	if (atsReportTableReady) return;

	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "resume_ats_report" (
			"id" text PRIMARY KEY NOT NULL,
			"user_id" text NOT NULL,
			"resume_id" text NOT NULL,
			"report" text NOT NULL,
			"score" integer NOT NULL,
			"threshold" integer NOT NULL,
			"is_passing" integer NOT NULL,
			"job_description" text,
			"keywords" text NOT NULL DEFAULT '[]',
			"created_at" integer DEFAULT (unixepoch()) NOT NULL,
			"updated_at" integer DEFAULT (unixepoch()) NOT NULL,
			FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade,
			FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE cascade,
			UNIQUE ("user_id", "resume_id")
		);
	`);

	await Promise.all([
		db.execute(sql`CREATE INDEX IF NOT EXISTS "resume_ats_report_user_id_index" ON "resume_ats_report" ("user_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "resume_ats_report_resume_id_index" ON "resume_ats_report" ("resume_id");`),
		db.execute(sql`CREATE INDEX IF NOT EXISTS "resume_ats_report_updated_at_index" ON "resume_ats_report" ("updated_at");`),
	]);

	atsReportTableReady = true;
};

type PersistedAtsReport = {
	id: string;
	resumeId: string;
	jobDescription: string | null;
	report: AtsReport;
	createdAt: Date;
	updatedAt: Date;
};

const toDate = (value: Date | number | string) => (value instanceof Date ? value : new Date(value));

const parseStoredReport = (serializedReport: string): AtsReport => {
	try {
		const parsed = JSON.parse(serializedReport) as unknown;
		return atsReportSchema.parse(parsed);
	} catch {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Stored ATS report could not be parsed.",
		});
	}
};

const mapPersistedReport = (record: {
	id: string;
	resumeId: string;
	jobDescription: string | null;
	report: string;
	createdAt: Date | number | string;
	updatedAt: Date | number | string;
}): PersistedAtsReport => ({
	id: record.id,
	resumeId: record.resumeId,
	jobDescription: record.jobDescription,
	report: parseStoredReport(record.report),
	createdAt: toDate(record.createdAt),
	updatedAt: toDate(record.updatedAt),
});

const getLatestByResumeId = async (input: { userId: string; resumeId: string }): Promise<PersistedAtsReport | null> => {
	await ensureAtsReportTable();

	const [record] = await db
		.select({
			id: resumeAtsReport.id,
			resumeId: resumeAtsReport.resumeId,
			jobDescription: resumeAtsReport.jobDescription,
			report: resumeAtsReport.report,
			createdAt: resumeAtsReport.createdAt,
			updatedAt: resumeAtsReport.updatedAt,
		})
		.from(resumeAtsReport)
		.where(and(eq(resumeAtsReport.userId, input.userId), eq(resumeAtsReport.resumeId, input.resumeId)))
		.orderBy(desc(resumeAtsReport.updatedAt))
		.limit(1);

	if (!record) return null;
	return mapPersistedReport(record);
};

const evaluate = async (input: {
	userId: string;
	resumeId: string;
	jobDescription?: string;
	keywords?: string[];
	threshold?: number;
}): Promise<PersistedAtsReport> => {
	await ensureAtsReportTable();

	const [resume] = await db
		.select({ data: schema.resume.data })
		.from(schema.resume)
		.where(and(eq(schema.resume.id, input.resumeId), eq(schema.resume.userId, input.userId)))
		.limit(1);

	if (!resume) throw new ORPCError("NOT_FOUND");

	const now = new Date();
	const storageKey = buildQualityReportStorageKey(input.userId, input.resumeId);
	const report = runQuality({
		generationId: `quality_${resume.id}_${now.getTime()}`,
		resume: new JSONResumeExporter().convert(resume.data),
		threshold: input.threshold,
		targetKeywords: input.targetKeywords,
	});

	const result: QualityScoreResult = {
		resumeId: resume.id,
		generatedAt: now,
		score: report.score,
		bulletReport: { bullets: report.bulletScores },
		report,
		storageKey,
		provider: "local-rule-engine",
	};

	await persistQualityScoreResult({ storageKey, result });

	return result;
};

const getLatest = async (input: { userId: string; resumeId: string }) => {
	return getPersistedQualityScoreResult(input);
};

export const resumeosService = {
	quality: {
		score,
		getLatest,
	const normalizedJobDescription = input.jobDescription?.trim() || undefined;
	const normalizedKeywords = (input.keywords ?? [])
		.map((keyword) => keyword.trim())
		.filter((keyword) => keyword.length > 0)
		.slice(0, 40);

	const report = evaluateAtsReport({
		resumeData: resume.data,
		jobDescription: normalizedJobDescription,
		keywords: normalizedKeywords,
		threshold: input.threshold,
	});

	await db
		.insert(resumeAtsReport)
		.values({
			id: generateId(),
			userId: input.userId,
			resumeId: input.resumeId,
			report: JSON.stringify(report),
			score: report.score,
			threshold: report.threshold,
			isPassing: report.pass,
			jobDescription: normalizedJobDescription ?? null,
			keywords: JSON.stringify(report.keywords),
		})
		.onConflictDoUpdate({
			target: [resumeAtsReport.userId, resumeAtsReport.resumeId],
			set: {
				report: JSON.stringify(report),
				score: report.score,
				threshold: report.threshold,
				isPassing: report.pass,
				jobDescription: normalizedJobDescription ?? null,
				keywords: JSON.stringify(report.keywords),
				updatedAt: new Date(),
			},
		});

	const persisted = await getLatestByResumeId({ userId: input.userId, resumeId: input.resumeId });
	if (!persisted) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "ATS report could not be persisted.",
		});
	}

	return persisted;
};

export const resumeosService = {
	ats: {
		evaluate,
		getLatestByResumeId,
	},
};
