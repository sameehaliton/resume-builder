import z from "zod";
import { protectedProcedure } from "../context";
import { syncSettingsService } from "../services/sync-settings";

const setSyncDirectorySchema = z.object({
	syncDirectory: z
		.string()
		.trim()
		.min(1)
		.max(2048)
		.describe("Absolute path to the local directory where sync artifacts should be stored."),
});

export const syncSettingsRouter = {
	getSyncDirectory: protectedProcedure
		.route({
			method: "GET",
			path: "/sync/settings/directory",
			tags: ["Sync"],
			operationId: "getSyncDirectory",
			summary: "Get sync directory setting",
			description:
				"Returns the authenticated user's configured sync directory path. If no path has been saved yet, returns null.",
			successDescription: "The user's sync directory setting.",
		})
		.output(
			z.object({
				syncDirectory: z.string().nullable().describe("The saved absolute sync directory path, or null if unset."),
			}),
		)
		.handler(async ({ context }) => {
			const syncDirectory = await syncSettingsService.getSyncDirectory({ userId: context.user.id });
			return { syncDirectory };
		}),

	setSyncDirectory: protectedProcedure
		.route({
			method: "PUT",
			path: "/sync/settings/directory",
			tags: ["Sync"],
			operationId: "setSyncDirectory",
			summary: "Set sync directory setting",
			description:
				"Saves the authenticated user's sync directory path. The path must be absolute, writable, and point to a directory.",
			successDescription: "The normalized sync directory path that was saved.",
		})
		.input(setSyncDirectorySchema)
		.output(
			z.object({
				syncDirectory: z.string().describe("The normalized absolute sync directory path."),
			}),
		)
		.errors({
			BAD_REQUEST: {
				message: "The provided sync directory path is invalid.",
				status: 400,
			},
		})
		.handler(async ({ context, input }) => {
			const syncDirectory = await syncSettingsService.setSyncDirectory({
				userId: context.user.id,
				syncDirectory: input.syncDirectory,
			});

			return { syncDirectory };
		}),
};
