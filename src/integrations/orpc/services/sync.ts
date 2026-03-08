import { ORPCError } from "@orpc/server";
import { syncUserArtifactsToDirectory, type ArtifactSyncResult } from "@/integrations/sync/engine";
import { syncSettingsService } from "./sync-settings";

export const syncService = {
	syncNow: async (input: { userId: string }): Promise<ArtifactSyncResult> => {
		const syncDirectory = await syncSettingsService.getSyncDirectory({ userId: input.userId });

		if (!syncDirectory) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Sync directory is not configured.",
			});
		}

		return syncUserArtifactsToDirectory({
			userId: input.userId,
			syncDirectory,
		});
	},
};
