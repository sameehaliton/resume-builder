import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { BriefcaseIcon, CircleNotchIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { orpc, type RouterOutput } from "@/integrations/orpc/client";

type PacketStatus = RouterOutput["packet"]["list"][number]["status"];

export function PacketLifecyclePanel() {
	const { i18n } = useLingui();
	const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
	const [updatingPacketId, setUpdatingPacketId] = useState<string | null>(null);

	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: { tags: [], sort: "lastUpdatedAt" } }));
	const { data: packets } = useQuery(orpc.packet.list.queryOptions());
	const { mutate: createPacket, isPending: isCreatingPacket } = useMutation(orpc.packet.createFromResume.mutationOptions());
	const { mutate: setPacketStatus } = useMutation(orpc.packet.setStatus.mutationOptions());

	const resumeOptions = useMemo(() => {
		return (resumes ?? []).map((resume) => ({ value: resume.id, label: resume.name }));
	}, [resumes]);

	const statusOptions = useMemo<{ value: PacketStatus; label: string }[]>(() => {
		return [
			{ value: "draft", label: i18n.t("Draft") },
			{ value: "ready", label: i18n.t("Ready") },
			{ value: "applied", label: i18n.t("Applied") },
			{ value: "interview", label: i18n.t("Interview") },
			{ value: "offer", label: i18n.t("Offer") },
			{ value: "rejected", label: i18n.t("Rejected") },
			{ value: "archived", label: i18n.t("Archived") },
		];
	}, [i18n]);

	const statusLabelMap = useMemo(() => {
		return new Map(statusOptions.map((status) => [status.value, status.label]));
	}, [statusOptions]);

	const resolvedSelectedResumeId = useMemo(() => {
		if (!resumeOptions.length) return null;
		if (selectedResumeId && resumeOptions.some((resume) => resume.value === selectedResumeId)) return selectedResumeId;
		return resumeOptions[0]?.value ?? null;
	}, [resumeOptions, selectedResumeId]);

	const createPacketFromResume = () => {
		if (!resolvedSelectedResumeId) return;

		createPacket(
			{ resumeId: resolvedSelectedResumeId },
			{
				onSuccess: () => {
					toast.success(t`A snapshot and packet were created successfully.`);
				},
				onError: (error) => {
					toast.error(error.message);
				},
			},
		);
	};

	const updatePacketStatus = (packetId: string, status: PacketStatus) => {
		setUpdatingPacketId(packetId);
		setPacketStatus(
			{ id: packetId, status },
			{
				onError: (error) => {
					toast.error(error.message);
				},
				onSettled: () => {
					setUpdatingPacketId((currentPacketId) => (currentPacketId === packetId ? null : currentPacketId));
				},
			},
		);
	};

	const formatDate = (date: Date) =>
		new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }).format(date);

	return (
		<section className="space-y-3 rounded-lg border p-4">
			<div className="flex items-center gap-2">
				<BriefcaseIcon className="size-4" />
				<h2 className="font-medium text-sm">
					<Trans>Packet Lifecycle</Trans>
				</h2>
			</div>

			<p className="text-muted-foreground text-xs">
				<Trans>Create an immutable snapshot from a resume and track packet status locally.</Trans>
			</p>

			<div className="flex flex-col gap-2 sm:flex-row">
				<Combobox
					value={resolvedSelectedResumeId}
					options={resumeOptions}
					onValueChange={(value) => {
						setSelectedResumeId(value);
					}}
					disabled={resumeOptions.length === 0}
					emptyMessage={t`No resumes found.`}
					buttonProps={{
						className: "w-full justify-between sm:w-72",
						children: (_, option) => option?.label ?? t`Select a resume`,
					}}
				/>

				<Button className="sm:w-auto" onClick={createPacketFromResume} disabled={!resolvedSelectedResumeId || isCreatingPacket}>
					{isCreatingPacket ? <CircleNotchIcon className="animate-spin" /> : <PlusIcon />}
					<Trans>Create Packet</Trans>
				</Button>
			</div>

			{(packets?.length ?? 0) === 0 ? (
				<div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-xs">
					<Trans>No packets yet.</Trans>
				</div>
			) : (
				<div className="space-y-2">
					{packets?.map((packet) => (
						<div key={packet.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
							<div className="flex-1 space-y-1">
								<div className="flex items-center gap-2">
									<p className="font-medium text-sm">{packet.title}</p>
									<Badge variant="outline">{statusLabelMap.get(packet.status) ?? packet.status}</Badge>
								</div>

								<p className="text-muted-foreground text-xs">
									<Trans>Snapshot source: {packet.resumeName}</Trans>
								</p>
								<p className="text-muted-foreground text-xs">
									<Trans>
										Created {formatDate(packet.createdAt)} | Snapshot {formatDate(packet.snapshotCreatedAt)}
									</Trans>
								</p>
							</div>

							<Combobox
								value={packet.status}
								options={statusOptions}
								clearable={false}
								disabled={updatingPacketId === packet.id}
								onValueChange={(value) => {
									if (!value || value === packet.status) return;
									updatePacketStatus(packet.id, value);
								}}
								buttonProps={{
									variant: "outline",
									className: "w-full justify-between sm:w-48",
								}}
							/>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
