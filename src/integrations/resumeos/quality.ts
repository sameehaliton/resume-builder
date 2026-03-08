import type { JSONResume } from "@/types/json-resume";

export interface QualityFinding {
	severity: "info" | "warn" | "error";
	section: string;
	rule: string;
	message: string;
	recommendation?: string;
}

export interface BulletScoreDimensionBreakdown {
	actionVerbStrength: number;
	metricEvidence: number;
	specificity: number;
	relevanceAlignment: number;
	clarityLength: number;
}

export type BulletScoreBand = "strong" | "acceptable" | "rewrite";

export interface BulletScore {
	path: string;
	text: string;
	score: number;
	band: BulletScoreBand;
	dimensions: BulletScoreDimensionBreakdown;
	reasons: string[];
	suggestedRewrite: string;
}

export interface QualityReport {
	generationId: string;
	score: number;
	threshold: number;
	pass: boolean;
	dimensions: {
		metricsDensity: number;
		weakVerbs: number;
		vagueness: number;
		duplication: number;
		buzzwordDensity: number;
		brevityClarity: number;
		relevanceAlignment: number;
	};
	findings: QualityFinding[];
	bulletScores: BulletScore[];
}

interface BulletRef {
	path: string;
	text: string;
}

interface QualityConfig {
	metricsDensityTarget: number;
	maxSummaryChars: number;
	maxHighlightChars: number;
	weakVerbs: string[];
	vagueTerms: string[];
}

export interface RunQualityInput {
	generationId: string;
	resume: JSONResume;
	threshold?: number;
	targetKeywords?: string[];
	config?: Partial<QualityConfig>;
}

const DEFAULT_CONFIG: QualityConfig = {
	metricsDensityTarget: 0.35,
	maxSummaryChars: 320,
	maxHighlightChars: 220,
	weakVerbs: ["helped", "assisted", "participated", "worked on", "involved in"],
	vagueTerms: ["various", "several", "many", "significant", "responsible for"],
};

const BUZZWORDS = ["synergy", "visionary", "results-driven", "innovative", "thought leader"];
const STRONG_VERBS = [
	"built",
	"designed",
	"implemented",
	"led",
	"optimized",
	"shipped",
	"reduced",
	"increased",
	"launched",
	"improved",
];

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWordBoundary(text: string, term: string): boolean {
	const escaped = escapeRegExp(term).replace(/\s+/g, "\\s+");
	const regex = new RegExp(`\\b${escaped}\\b`, "i");
	return regex.test(text);
}

function normalizeTokens(input: string): string[] {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9\s]+/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
}

function firstWord(text: string): string {
	const [head] = text.trim().toLowerCase().split(/\s+/);
	return head ?? "";
}

function hasMetric(text: string): boolean {
	return /\d|%|\$|latency|throughput|scale|users?|requests?|p\d{2}|x\b/i.test(text);
}

function collectBullets(resume: JSONResume): BulletRef[] {
	const bullets: BulletRef[] = [];

	for (const [workIndex, item] of (resume.work ?? []).entries()) {
		for (const [highlightIndex, bullet] of (item.highlights ?? []).entries()) {
			const text = bullet.trim();
			if (!text) continue;
			bullets.push({ path: `work[${workIndex}].highlights[${highlightIndex}]`, text });
		}
	}

	for (const [projectIndex, item] of (resume.projects ?? []).entries()) {
		for (const [highlightIndex, bullet] of (item.highlights ?? []).entries()) {
			const text = bullet.trim();
			if (!text) continue;
			bullets.push({ path: `projects[${projectIndex}].highlights[${highlightIndex}]`, text });
		}
	}

	return bullets;
}

function scoreActionVerb(text: string, weakVerbs: string[]): number {
	const start = firstWord(text);

	if (!start) return 0;
	if (STRONG_VERBS.includes(start)) return 100;
	if (weakVerbs.some((verb) => start === verb || text.toLowerCase().startsWith(verb))) return 35;

	return 72;
}

function scoreMetricEvidence(text: string): number {
	return hasMetric(text) ? 100 : 45;
}

function scoreSpecificity(text: string, vagueTerms: string[]): number {
	const lower = text.toLowerCase();

	if (vagueTerms.some((term) => containsWordBoundary(lower, term)) && !hasMetric(text)) return 40;
	if (text.trim().split(/\s+/).length < 7) return 58;

	return hasMetric(text) ? 95 : 78;
}

function scoreRelevance(text: string, targetKeywords: string[]): number {
	if (targetKeywords.length === 0) return 80;

	const matched = targetKeywords.filter((keyword) => containsWordBoundary(text.toLowerCase(), keyword.toLowerCase()));
	return Math.round((matched.length / targetKeywords.length) * 100);
}

function scoreClarity(text: string, maxChars: number): number {
	if (text.length <= maxChars) return 100;

	const over = text.length - maxChars;
	const penalty = Math.min(80, Math.round((over / Math.max(maxChars, 1)) * 100));
	return Math.max(20, 100 - penalty);
}

function scoreBand(score: number): BulletScoreBand {
	if (score >= 85) return "strong";
	if (score >= 70) return "acceptable";
	return "rewrite";
}

function suggestRewrite(reasons: string[], original: string): string {
	if (reasons.length === 0) return original;

	const starter = firstWord(original);
	const verb = STRONG_VERBS.includes(starter) ? starter : "Built";

	if (reasons.some((reason) => reason.includes("metric"))) {
		return `${verb} and delivered measurable impact (include %, $, or volume) with clear scope and ownership.`;
	}

	if (reasons.some((reason) => reason.includes("relevance"))) {
		return `${verb} a role-relevant outcome using target skills/keywords and concrete results.`;
	}

	return `${verb} a clearly scoped initiative with specific actions and outcomes.`;
}

function buildBulletScores(
	bullets: BulletRef[],
	weakVerbs: string[],
	vagueTerms: string[],
	targetKeywords: string[],
	maxHighlightChars: number,
): BulletScore[] {
	return bullets.map((bullet) => {
		const actionVerbScore = scoreActionVerb(bullet.text, weakVerbs);
		const metricScore = scoreMetricEvidence(bullet.text);
		const specificityScore = scoreSpecificity(bullet.text, vagueTerms);
		const relevanceScore = scoreRelevance(bullet.text, targetKeywords);
		const clarityScore = scoreClarity(bullet.text, maxHighlightChars);

		const score = Math.round(
			0.25 * actionVerbScore +
				0.25 * metricScore +
				0.2 * specificityScore +
				0.2 * relevanceScore +
				0.1 * clarityScore,
		);

		const reasons: string[] = [];
		if (actionVerbScore < 70) reasons.push("Use a stronger action verb to lead the statement.");
		if (metricScore < 70) reasons.push("Add metric evidence (%, $, latency, scale, or count).");
		if (specificityScore < 70) reasons.push("Increase specificity and remove vague language.");
		if (relevanceScore < 60) reasons.push("Align wording with target role keywords.");
		if (clarityScore < 70) reasons.push(`Shorten the bullet to <= ${maxHighlightChars} characters.`);

		return {
			path: bullet.path,
			text: bullet.text,
			score,
			band: scoreBand(score),
			dimensions: {
				actionVerbStrength: actionVerbScore,
				metricEvidence: metricScore,
				specificity: specificityScore,
				relevanceAlignment: relevanceScore,
				clarityLength: clarityScore,
			},
			reasons,
			suggestedRewrite: suggestRewrite(reasons, bullet.text),
		};
	});
}

function collectResumeKeywordsForQuality(resume: JSONResume): string[] {
	const tokenSource = [
		resume.basics?.summary ?? "",
		...(resume.work ?? []).flatMap((work) => [work.position ?? "", work.summary ?? "", ...(work.highlights ?? [])]),
		...(resume.skills ?? []).flatMap((skill) => [skill.name ?? "", ...(skill.keywords ?? [])]),
	].join(" ");

	return Array.from(new Set(normalizeTokens(tokenSource).filter((token) => token.length >= 3)));
}

export function runQuality(input: RunQualityInput): QualityReport {
	const config: QualityConfig = {
		metricsDensityTarget: input.config?.metricsDensityTarget ?? DEFAULT_CONFIG.metricsDensityTarget,
		maxSummaryChars: input.config?.maxSummaryChars ?? DEFAULT_CONFIG.maxSummaryChars,
		maxHighlightChars: input.config?.maxHighlightChars ?? DEFAULT_CONFIG.maxHighlightChars,
		weakVerbs: input.config?.weakVerbs?.length ? input.config.weakVerbs : DEFAULT_CONFIG.weakVerbs,
		vagueTerms: input.config?.vagueTerms?.length ? input.config.vagueTerms : DEFAULT_CONFIG.vagueTerms,
	};

	const threshold = clamp(Math.round(input.threshold ?? 75), 0, 100);
	const findings: QualityFinding[] = [];
	const bullets = collectBullets(input.resume);

	const weakVerbMatches: BulletRef[] = [];
	const vagueMatches: BulletRef[] = [];
	const buzzMatches: BulletRef[] = [];
	const longMatches: BulletRef[] = [];
	const metricMatches = bullets.filter((bullet) => hasMetric(bullet.text));

	const normalizedMap = new Map<string, BulletRef[]>();

	for (const bullet of bullets) {
		const lower = bullet.text.toLowerCase();
		const compact = lower.replace(/\d+/g, "#").replace(/[^a-z# ]+/g, " ").replace(/\s+/g, " ").trim();
		if (!normalizedMap.has(compact)) normalizedMap.set(compact, []);
		normalizedMap.get(compact)?.push(bullet);

		if (config.weakVerbs.some((verb) => lower.startsWith(verb) || lower.includes(` ${verb} `))) {
			weakVerbMatches.push(bullet);
			findings.push({
				severity: "warn",
				section: bullet.path,
				rule: "weak_verb",
				message: "Weak action verb reduces impact clarity",
				recommendation: "Use stronger verbs like built, led, optimized, or shipped.",
			});
		}

		for (const term of config.vagueTerms) {
			if (!containsWordBoundary(lower, term)) continue;

			vagueMatches.push(bullet);
			findings.push({
				severity: "warn",
				section: bullet.path,
				rule: "vagueness",
				message: `Vague term '${term}' found without concrete evidence`,
				recommendation: "Add measurable scope or outcome.",
			});
			break;
		}

		for (const term of BUZZWORDS) {
			if (!containsWordBoundary(lower, term)) continue;

			buzzMatches.push(bullet);
			findings.push({
				severity: "warn",
				section: bullet.path,
				rule: "buzzword",
				message: `Buzzword '${term}' appears without concrete proof`,
				recommendation: "Replace buzzwords with specific outcomes and metrics.",
			});
			break;
		}

		if (bullet.text.length > config.maxHighlightChars) {
			longMatches.push(bullet);
			findings.push({
				severity: "warn",
				section: bullet.path,
				rule: "clarity_length",
				message: `Bullet exceeds ${config.maxHighlightChars} characters`,
				recommendation: "Split into concise result-focused statements.",
			});
		}
	}

	const duplicates = Array.from(normalizedMap.values()).filter((items) => items.length > 1);
	for (const duplicateGroup of duplicates) {
		for (const bullet of duplicateGroup) {
			findings.push({
				severity: "warn",
				section: bullet.path,
				rule: "duplication",
				message: "Potential duplicate claim across highlights",
				recommendation: "Differentiate claim with distinct scope/metric or remove redundancy.",
			});
		}
	}

	const summaryLength = input.resume.basics?.summary?.length ?? 0;
	if (summaryLength > config.maxSummaryChars) {
		findings.push({
			severity: "warn",
			section: "basics.summary",
			rule: "clarity_summary_length",
			message: `Summary exceeds ${config.maxSummaryChars} characters`,
			recommendation: "Condense summary to role-specific high-signal content.",
		});
	}

	const metricsDensity = bullets.length > 0 ? metricMatches.length / bullets.length : 0;
	const providedKeywords = (input.targetKeywords ?? []).filter((keyword) => keyword.trim().length >= 3);
	const targetKeywords =
		providedKeywords.length > 0 ? providedKeywords.map((keyword) => keyword.toLowerCase()) : collectResumeKeywordsForQuality(input.resume);

	const topBullets = bullets.slice(0, Math.min(8, bullets.length));
	const topText = topBullets.map((bullet) => bullet.text.toLowerCase()).join(" ");
	const matchedKeywords = targetKeywords.filter((keyword) => containsWordBoundary(topText, keyword));
	const relevanceAlignment = targetKeywords.length > 0 ? matchedKeywords.length / targetKeywords.length : 0.8;

	const weakVerbPenalty = Math.min(20, weakVerbMatches.length * 4);
	const vaguenessPenalty = Math.min(15, vagueMatches.length * 3);
	const duplicationPenalty = Math.min(15, duplicates.length * 6);
	const buzzwordPenalty = Math.min(10, buzzMatches.length * 2);
	const clarityPenalty = Math.min(10, longMatches.length * 2 + (summaryLength > config.maxSummaryChars ? 3 : 0));
	const metricsBonus = Math.min(20, (metricsDensity / Math.max(config.metricsDensityTarget, 0.01)) * 20);
	const relevanceBonus = Math.min(10, relevanceAlignment * 10);

	const score = Math.round(
		clamp(
			100 - weakVerbPenalty - vaguenessPenalty - duplicationPenalty - buzzwordPenalty - clarityPenalty + metricsBonus + relevanceBonus,
			0,
			100,
		),
	);

	const bulletScores = buildBulletScores(bullets, config.weakVerbs, config.vagueTerms, targetKeywords, config.maxHighlightChars);

	return {
		generationId: input.generationId,
		score,
		threshold,
		pass: score >= threshold,
		dimensions: {
			metricsDensity: Number(metricsDensity.toFixed(4)),
			weakVerbs: Number((weakVerbMatches.length / Math.max(1, bullets.length)).toFixed(4)),
			vagueness: Number((vagueMatches.length / Math.max(1, bullets.length)).toFixed(4)),
			duplication: Number((duplicates.length / Math.max(1, bullets.length)).toFixed(4)),
			buzzwordDensity: Number((buzzMatches.length / Math.max(1, bullets.length)).toFixed(4)),
			brevityClarity: Number((1 - clarityPenalty / 10).toFixed(4)),
			relevanceAlignment: Number(relevanceAlignment.toFixed(4)),
		},
		findings,
		bulletScores,
	};
}
