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
	},
};
