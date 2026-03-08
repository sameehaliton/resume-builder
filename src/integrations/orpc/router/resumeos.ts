import z from "zod";
import { atsReportSchema } from "@/integrations/resumeos";
import { protectedProcedure } from "../context";
import { resumeosService } from "../services/resumeos";

const atsReportRecordSchema = z.object({
	id: z.string(),
	resumeId: z.string(),
	jobDescription: z.string().nullable(),
	report: atsReportSchema,
	createdAt: z.date(),
	updatedAt: z.date(),
});

const runAtsInputSchema = z.object({
	resumeId: z.string().describe("The unique identifier of the resume to score."),
	jobDescription: z.string().trim().max(20_000).optional().describe("Optional job description text to evaluate keyword coverage against."),
	keywords: z
		.array(z.string().trim().min(1).max(64))
		.max(40)
		.optional()
		.describe("Optional list of target keywords to score against."),
	threshold: z.number().int().min(0).max(100).optional().describe("Optional ATS pass threshold from 0 to 100."),
});

export const resumeosRouter = {
	ats: {
		evaluate: protectedProcedure
			.route({
				method: "POST",
				path: "/resumeos/ats",
				tags: ["ResumeOS"],
				operationId: "evaluateResumeAts",
				summary: "Evaluate ATS score for a resume",
				description:
					"Runs ATS scoring against the latest resume data, returns a structured report, and persists the report locally for the authenticated user.",
				successDescription: "The persisted ATS scoring report for the resume.",
			})
			.input(runAtsInputSchema)
			.output(atsReportRecordSchema)
			.handler(async ({ context, input }) => {
				return resumeosService.ats.evaluate({
					userId: context.user.id,
					resumeId: input.resumeId,
					jobDescription: input.jobDescription,
					keywords: input.keywords,
					threshold: input.threshold,
				});
			}),

		getLatestByResumeId: protectedProcedure
			.route({
				method: "GET",
				path: "/resumeos/ats/{resumeId}",
				tags: ["ResumeOS"],
				operationId: "getLatestResumeAtsReport",
				summary: "Get latest ATS report for a resume",
				description:
					"Returns the latest locally persisted ATS report for the specified resume, or null if the resume has not been scored yet.",
				successDescription: "The latest ATS report for the resume or null.",
			})
			.input(z.object({ resumeId: z.string().describe("The unique identifier of the resume.") }))
			.output(atsReportRecordSchema.nullable())
			.handler(async ({ context, input }) => {
				return resumeosService.ats.getLatestByResumeId({
					userId: context.user.id,
					resumeId: input.resumeId,
				});
			}),
	},
};
