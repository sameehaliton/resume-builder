import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon, GearSixIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LocaleCombobox } from "@/components/locale/combobox";
import { ThemeCombobox } from "@/components/theme/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { orpc } from "@/integrations/orpc/client";
import { DashboardHeader } from "../-components/header";

export const Route = createFileRoute("/dashboard/settings/preferences")({
	component: RouteComponent,
});

function RouteComponent() {
	const [syncDirectory, setSyncDirectory] = useState("");

	const { data: syncDirectorySetting, isLoading: isSyncDirectoryLoading } = useQuery(
		orpc.syncSettings.getSyncDirectory.queryOptions(),
	);

	const persistedSyncDirectory = useMemo(() => syncDirectorySetting?.syncDirectory ?? "", [syncDirectorySetting?.syncDirectory]);
	const normalizedSyncDirectory = useMemo(() => syncDirectory.trim(), [syncDirectory]);
	const isSyncDirectoryDirty = normalizedSyncDirectory !== persistedSyncDirectory;

	useEffect(() => {
		setSyncDirectory(persistedSyncDirectory);
	}, [persistedSyncDirectory]);

	const { mutate: saveSyncDirectory, isPending: isSavingSyncDirectory } = useMutation(
		orpc.syncSettings.setSyncDirectory.mutationOptions(),
	);

	const handleSaveSyncDirectory = () => {
		const toastId = toast.loading(t`Saving sync folder...`);

		saveSyncDirectory(
			{ syncDirectory },
			{
				onSuccess: ({ syncDirectory: savedSyncDirectory }) => {
					setSyncDirectory(savedSyncDirectory);
					toast.success(t`Your sync folder has been updated.`, { id: toastId });
				},
				onError: (error) => {
					toast.error(error.message, { id: toastId });
				},
			},
		);
	};

	return (
		<div className="space-y-4">
			<DashboardHeader icon={GearSixIcon} title={t`Preferences`} />

			<Separator />

			<motion.div
				initial={{ opacity: 0, y: -20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.3 }}
				className="grid max-w-xl gap-6"
			>
				<div className="grid gap-1.5">
					<Label className="mb-0.5">
						<Trans>Theme</Trans>
					</Label>
					<ThemeCombobox />
				</div>

				<div className="grid gap-1.5">
					<Label className="mb-0.5">
						<Trans>Language</Trans>
					</Label>
					<LocaleCombobox />
					<Button
						asChild
						size="sm"
						variant="link"
						className="h-5 justify-start text-muted-foreground text-xs active:scale-100"
					>
						<a href="https://crowdin.com/project/reactive-resume" target="_blank" rel="noopener">
							<Trans>Help translate the app to your language</Trans>
							<ArrowRightIcon className="size-3" />
						</a>
					</Button>
				</div>

				<div className="grid gap-2">
					<Label className="mb-0.5">
						<Trans>Sync Folder</Trans>
					</Label>

					<Input
						value={syncDirectory}
						onChange={(event) => setSyncDirectory(event.target.value)}
						placeholder={t`/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Reactive Resume`}
						autoCapitalize="off"
						autoCorrect="off"
						autoComplete="off"
						spellCheck={false}
						disabled={isSyncDirectoryLoading || isSavingSyncDirectory}
					/>

					<p className="text-muted-foreground text-xs">
						<Trans>
							Enter an absolute folder path. The path is validated, created if missing, and must be writable.
						</Trans>
					</p>

					<div className="flex justify-end">
						<Button
							size="sm"
							onClick={handleSaveSyncDirectory}
							disabled={
								isSyncDirectoryLoading ||
								isSavingSyncDirectory ||
								!isSyncDirectoryDirty ||
								normalizedSyncDirectory.length === 0
							}
						>
							<Trans>Save Sync Folder</Trans>
						</Button>
					</div>
				</div>
			</motion.div>
		</div>
	);
}
