import z from "zod";
import { protectedProcedure } from "../context";
import { resumeosService } from "../services/resumeos";

const qualityFindingSchema = z.object({
	severity: z.enum(["info", "warn", "error"]),
	section: z.string(),
	rule: z.string(),
	message: z.string(),
	recommendation: z.string().optional(),
});

const bulletScoreSchema = z.object({
	path: z.string(),
	text: z.string(),
	score: z.number().min(0).max(100),
	band: z.enum(["strong", "acceptable", "rewrite"]),
	dimensions: z.object({
		actionVerbStrength: z.number().min(0).max(100),
		metricEvidence: z.number().min(0).max(100),
		specificity: z.number().min(0).max(100),
		relevanceAlignment: z.number().min(0).max(100),
		clarityLength: z.number().min(0).max(100),
	}),
	reasons: z.array(z.string()),
	suggestedRewrite: z.string(),
});

const qualityReportSchema = z.object({
	generationId: z.string(),
	score: z.number().min(0).max(100),
	threshold: z.number().min(0).max(100),
	pass: z.boolean(),
	dimensions: z.object({
		metricsDensity: z.number(),
		weakVerbs: z.number(),
		vagueness: z.number(),
		duplication: z.number(),
		buzzwordDensity: z.number(),
		brevityClarity: z.number(),
		relevanceAlignment: z.number(),
	}),
	findings: z.array(qualityFindingSchema),
	bulletScores: z.array(bulletScoreSchema),
});

const qualityScoreResultSchema = z.object({
	resumeId: z.string(),
	generatedAt: z.date(),
	score: z.number().min(0).max(100),
	bulletReport: z.object({
		bullets: z.array(bulletScoreSchema),
	}),
	report: qualityReportSchema,
	storageKey: z.string(),
	provider: z.literal("local-rule-engine"),
});

export const resumeosRouter = {
	quality: {
		score: protectedProcedure
			.route({
				method: "POST",
				path: "/resumeos/quality",
				tags: ["ResumeOS Quality"],
				operationId: "scoreResumeQuality",
				summary: "Score resume quality",
				description:
					"Runs quality scoring for the selected resume, including bullet-level analysis. The generated report is persisted locally for future retrieval.",
				successDescription: "A quality score, full report, and bullet report for the resume.",
			})
			.input(
				z.object({
					resumeId: z.string(),
					threshold: z.number().int().min(0).max(100).optional(),
					targetKeywords: z.array(z.string().trim().min(1)).max(100).optional(),
				}),
			)
			.output(qualityScoreResultSchema)
			.handler(async ({ context, input }) => {
				return resumeosService.quality.score({
					userId: context.user.id,
					resumeId: input.resumeId,
					threshold: input.threshold,
					targetKeywords: input.targetKeywords,
				});
			}),

		getLatest: protectedProcedure
			.route({
				method: "GET",
				path: "/resumeos/quality/{resumeId}",
				tags: ["ResumeOS Quality"],
				operationId: "getLatestResumeQualityScore",
				summary: "Get latest quality report",
				description:
					"Returns the latest persisted quality score/report for the selected resume. Returns null when no report has been generated yet.",
				successDescription: "The latest quality score/report, or null if none exists.",
			})
			.input(
				z.object({
					resumeId: z.string(),
				}),
			)
			.output(qualityScoreResultSchema.nullable())
			.handler(async ({ context, input }) => {
				return resumeosService.quality.getLatest({
					userId: context.user.id,
					resumeId: input.resumeId,
				});
			}),
	},
};
