import z from "zod";
import { protectedProcedure } from "../context";
import { syncService } from "../services/sync";

const syncCollectionResultSchema = z.object({
	count: z.number().int().nonnegative().describe("Number of JSON records synced for the collection."),
	filesWritten: z
		.number()
		.int()
		.nonnegative()
		.describe("Number of JSON files written, including the collection index file."),
});

export const syncRouter = {
	run: protectedProcedure
		.route({
			method: "POST",
			path: "/sync/run",
			tags: ["Sync"],
			operationId: "runArtifactSync",
			summary: "Run artifact sync",
			description:
				"Synchronizes JSON artifacts, snapshots, and packets into the configured sync folder. SQLite database files are explicitly excluded.",
			successDescription: "Sync summary with per-collection counts.",
		})
		.output(
			z.object({
				syncDirectory: z.string().describe("Absolute path of the active sync directory."),
				generatedAt: z.string().datetime().describe("ISO timestamp indicating when sync completed."),
				artifacts: syncCollectionResultSchema,
				snapshots: syncCollectionResultSchema,
				packets: syncCollectionResultSchema,
				excludedDbPatterns: z
					.array(z.string())
					.describe("Filename patterns that are explicitly excluded from sync processing."),
			}),
		)
		.errors({
			BAD_REQUEST: {
				message: "Sync directory is not configured.",
				status: 400,
			},
		})
		.handler(async ({ context }) => {
			return syncService.syncNow({ userId: context.user.id });
		}),
};
