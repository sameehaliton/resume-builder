import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CheckCircleIcon, CircleNotchIcon, SparkleIcon, TestTubeIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useResumeStore } from "@/components/resume/store/resume";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { orpc, type RouterOutput } from "@/integrations/orpc/client";
import { SectionBase } from "../shared/section-base";

type ActionType = "ats" | "quality" | "tailor";

type AtsResult = RouterOutput["resumeos"]["ats"]["evaluate"];
type QualityResult = RouterOutput["resumeos"]["quality"]["score"];
type TailorResult = RouterOutput["resumeos"]["tailor"]["generate"];

const defaultErrors: Record<ActionType, string | null> = {
	ats: null,
	quality: null,
	tailor: null,
};

const getErrorMessage = (error: unknown): string => {
	if (error instanceof Error && error.message.length > 0) return error.message;
	return t`Something went wrong. Please try again.`;
};

export function OptimizationSectionBuilder() {
	const { resumeId } = useParams({ from: "/builder/$resumeId" });
	const updateResumeData = useResumeStore((state) => state.updateResumeData);
	const isResumeLocked = useResumeStore((state) => state.resume.isLocked);

	const [jobDescription, setJobDescription] = useState("");
	const [errors, setErrors] = useState<Record<ActionType, string | null>>(defaultErrors);
	const [atsResult, setAtsResult] = useState<AtsResult | null>(null);
	const [qualityResult, setQualityResult] = useState<QualityResult | null>(null);
	const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
	const [isTailorApplied, setIsTailorApplied] = useState(false);

	const { mutateAsync: evaluateAts, isPending: isAtsPending } = useMutation(orpc.resumeos.ats.evaluate.mutationOptions());
	const { mutateAsync: scoreQuality, isPending: isQualityPending } = useMutation(
		orpc.resumeos.quality.score.mutationOptions(),
	);
	const { mutateAsync: generateTailoredResume, isPending: isTailorPending } = useMutation(
		orpc.resumeos.tailor.generate.mutationOptions(),
	);

	const clearError = (action: ActionType) => {
		setErrors((previous) => ({ ...previous, [action]: null }));
	};

	const runAts = async () => {
		clearError("ats");

		const trimmedJobDescription = jobDescription.trim();

		try {
			const result = await evaluateAts({
				resumeId,
				...(trimmedJobDescription.length > 0 ? { jobDescription: trimmedJobDescription } : {}),
			});
			setAtsResult(result);
		} catch (error) {
			setErrors((previous) => ({ ...previous, ats: getErrorMessage(error) }));
		}
	};

	const runQuality = async () => {
		clearError("quality");

		try {
			const result = await scoreQuality({ resumeId });
			setQualityResult(result);
		} catch (error) {
			setErrors((previous) => ({ ...previous, quality: getErrorMessage(error) }));
		}
	};

	const runTailor = async () => {
		clearError("tailor");
		setIsTailorApplied(false);

		const trimmedJobDescription = jobDescription.trim();

		if (trimmedJobDescription.length < 40) {
			setErrors((previous) => ({
				...previous,
				tailor: t`Please provide a fuller job description (at least 40 characters).`,
			}));
			return;
		}

		try {
			const result = await generateTailoredResume({
				resumeId,
				jobDescription: trimmedJobDescription,
			});
			setTailorResult(result);
		} catch (error) {
			setErrors((previous) => ({ ...previous, tailor: getErrorMessage(error) }));
		}
	};

	const applyTailoredData = () => {
		if (!tailorResult || isResumeLocked) return;

		updateResumeData((draft) => {
			Object.assign(draft, tailorResult.tailoredData);
		});

		setIsTailorApplied(true);
	};

	return (
		<SectionBase type="optimization" className="space-y-4">
			<div className="space-y-2">
				<p className="font-medium text-sm">
					<Trans>Job Description</Trans>
				</p>

				<Textarea
					value={jobDescription}
					onChange={(event) => setJobDescription(event.target.value)}
					placeholder={t`Paste the job description to power ATS checks and tailoring.`}
					className="min-h-28"
				/>

				<p className="text-muted-foreground text-xs">
					<Trans>Tailor requires at least 40 characters. ATS can run with or without a job description.</Trans>
				</p>
			</div>

			<ActionCard
				title={t`ATS Check`}
				description={t`Evaluate parser-friendliness and keyword coverage against ATS expectations.`}
				isPending={isAtsPending}
				error={errors.ats}
				buttonLabel={t`Run ATS`}
				pendingLabel={t`Running ATS...`}
				onRun={runAts}
				icon={<TestTubeIcon />}
			>
				{atsResult ? (
					<div className="space-y-2 text-sm">
						<div className="flex items-center gap-2">
							<Badge variant={atsResult.report.pass ? "secondary" : "destructive"}>
								{atsResult.report.pass ? t`Pass` : t`Needs Work`}
							</Badge>
							<span className="font-medium">
								{atsResult.report.score}/{100}
							</span>
						</div>

						<p className="text-muted-foreground text-xs">
							<Trans>{atsResult.report.checks.length} checks analyzed.</Trans>
						</p>
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						<Trans>No ATS report yet.</Trans>
					</p>
				)}
			</ActionCard>

			<ActionCard
				title={t`Quality Score`}
				description={t`Run quality scoring with bullet-level feedback to identify rewrite opportunities.`}
				isPending={isQualityPending}
				error={errors.quality}
				buttonLabel={t`Run Quality`}
				pendingLabel={t`Scoring quality...`}
				onRun={runQuality}
				icon={<CheckCircleIcon />}
			>
				{qualityResult ? (
					<div className="space-y-2 text-sm">
						<div className="flex items-center gap-2">
							<Badge variant={qualityResult.report.pass ? "secondary" : "destructive"}>
								{qualityResult.report.pass ? t`Pass` : t`Below Threshold`}
							</Badge>
							<span className="font-medium">
								{qualityResult.score}/{100}
							</span>
						</div>

						<p className="text-muted-foreground text-xs">
							<Trans>{qualityResult.report.bulletScores.length} bullets scored.</Trans>
						</p>
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						<Trans>No quality report yet.</Trans>
					</p>
				)}
			</ActionCard>

			<ActionCard
				title={t`Tailor Resume`}
				description={t`Generate deterministic suggestions based on your pasted job description.`}
				isPending={isTailorPending}
				error={errors.tailor}
				buttonLabel={t`Generate Tailored Resume`}
				pendingLabel={t`Generating tailored content...`}
				onRun={runTailor}
				icon={<SparkleIcon />}
			>
				{tailorResult ? (
					<div className="space-y-3 text-sm">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline">
								<Trans>{tailorResult.changes.length} changes</Trans>
							</Badge>
							<Badge variant="outline">
								<Trans>{tailorResult.keywordsUsed.length} keywords</Trans>
							</Badge>
							{tailorResult.warnings.length > 0 && (
								<Badge variant="destructive">
									<Trans>{tailorResult.warnings.length} warnings</Trans>
								</Badge>
							)}
						</div>

						{tailorResult.warnings.length > 0 && (
							<p className="text-muted-foreground text-xs">{tailorResult.warnings[0]}</p>
						)}

						<Button
							size="sm"
							variant="secondary"
							onClick={applyTailoredData}
							disabled={isResumeLocked}
							className="w-full"
						>
							<Trans>Apply Tailored Changes to Resume</Trans>
						</Button>

						{isTailorApplied && (
							<p className="text-success text-xs">
								<Trans>Tailored changes were applied to your resume.</Trans>
							</p>
						)}
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						<Trans>No tailored result yet.</Trans>
					</p>
				)}
			</ActionCard>
		</SectionBase>
	);
}

type ActionCardProps = {
	title: string;
	description: string;
	isPending: boolean;
	error: string | null;
	buttonLabel: string;
	pendingLabel: string;
	onRun: () => Promise<void>;
	icon: React.ReactNode;
	children: React.ReactNode;
};

function ActionCard({ title, description, isPending, error, buttonLabel, pendingLabel, onRun, icon, children }: ActionCardProps) {
	return (
		<div className="space-y-3 rounded-md border p-3">
			<div className="space-y-1">
				<p className="font-medium text-sm">{title}</p>
				<p className="text-muted-foreground text-xs">{description}</p>
			</div>

			<Button size="sm" variant="outline" onClick={() => void onRun()} disabled={isPending} className="w-full justify-start">
				{isPending ? <CircleNotchIcon className="animate-spin" /> : icon}
				{isPending ? pendingLabel : buttonLabel}
			</Button>

			{error && (
				<Alert variant="destructive">
					<WarningIcon />
					<AlertTitle>
						<Trans>Action failed</Trans>
					</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{children}
		</div>
	);
}
