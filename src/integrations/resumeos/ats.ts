import z from "zod";
import type { ResumeData } from "@/schema/resume/data";

const DEFAULT_THRESHOLD = 70;
const MAX_INFERRED_KEYWORDS = 24;

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"their",
	"this",
	"to",
	"with",
	"your",
	"you",
]);

const STRONG_ACTION_VERBS = new Set([
	"built",
	"designed",
	"implemented",
	"led",
	"optimized",
	"improved",
	"increased",
	"reduced",
	"launched",
	"delivered",
	"automated",
	"developed",
	"shipped",
	"scaled",
]);

const UNSUPPORTED_FORMATTING_PATTERN = /<(table|img|svg|style|script)\b/i;

const QUANTIFIABLE_IMPACT_PATTERN =
	/(\b\d+(?:\.\d+)?\b|%|\$\d+|\b(kpi|latency|throughput|revenue|users?|customers?|ms|x)\b)/i;

export const atsCheckResultSchema = z.object({
	id: z.string(),
	result: z.enum(["pass", "warn", "fail"]),
	weight: z.number().int().min(1).max(100),
	score: z.number().int().min(0).max(100),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});

export const atsReportSchema = z.object({
	score: z.number().int().min(0).max(100),
	threshold: z.number().int().min(0).max(100),
	pass: z.boolean(),
	keywords: z.array(z.string()),
	checks: z.array(atsCheckResultSchema),
	generatedAt: z.string().datetime(),
});

export type AtsReport = z.infer<typeof atsReportSchema>;

type AtsCheckResult = z.infer<typeof atsCheckResultSchema>;

type EvaluateAtsReportInput = {
	resumeData: ResumeData;
	jobDescription?: string;
	keywords?: string[];
	threshold?: number;
};

const escapeForRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeKeyword = (keyword: string) =>
	normalizeWhitespace(keyword.toLowerCase().replace(/[^a-z0-9+#.\s]+/g, " "));

const decodeHtmlEntities = (value: string) =>
	value
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'");

const stripHtml = (value: string) => normalizeWhitespace(decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")));

const buildBoundaryPattern = (keyword: string) => {
	const escaped = escapeForRegex(keyword).replace(/\s+/g, "\\s+");
	return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i");
};

const containsKeyword = (text: string, keyword: string) => buildBoundaryPattern(keyword).test(text);

const tokenizeWords = (value: string) =>
	value
		.toLowerCase()
		.split(/[^a-z0-9+#.]+/)
		.map((token) => token.trim())
		.filter(Boolean);

const extractStatementsFromHtml = (value: string) => {
	const listItems = Array.from(value.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
		.map((match) => stripHtml(match[1] ?? ""))
		.filter((statement) => statement.length > 0);

	if (listItems.length > 0) return listItems;

	return stripHtml(value)
		.split(/[.;]\s+/)
		.map((statement) => statement.trim())
		.filter((statement) => statement.length >= 18);
};

const inferKeywords = (jobDescription?: string) => {
	if (!jobDescription) return [];

	const frequencies = new Map<string, number>();

	for (const token of tokenizeWords(jobDescription)) {
		if (token.length < 3) continue;
		if (STOP_WORDS.has(token)) continue;

		frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
	}

	return Array.from(frequencies.entries())
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_INFERRED_KEYWORDS)
		.map(([keyword]) => keyword);
};

const getTargetKeywords = (keywords?: string[], jobDescription?: string) => {
	const normalized = [...(keywords ?? []).map(normalizeKeyword), ...inferKeywords(jobDescription)]
		.map((keyword) => keyword.trim())
		.filter((keyword) => keyword.length >= 2);

	return [...new Set(normalized)];
};

const getAllResumeText = (resumeData: ResumeData) => {
	const experienceItems = resumeData.sections.experience.items.filter((item) => !item.hidden);
	const projectItems = resumeData.sections.projects.items.filter((item) => !item.hidden);
	const educationItems = resumeData.sections.education.items.filter((item) => !item.hidden);
	const skillItems = resumeData.sections.skills.items.filter((item) => !item.hidden);

	const summaryText = resumeData.summary.hidden ? "" : stripHtml(resumeData.summary.content);
	const basicsText = [
		resumeData.basics.name,
		resumeData.basics.headline,
		resumeData.basics.email,
		resumeData.basics.phone,
		resumeData.basics.location,
	]
		.map((value) => value.trim())
		.filter(Boolean)
		.join(" ");

	const experienceText = experienceItems
		.flatMap((item) => [
			item.company,
			item.position,
			item.location,
			item.period,
			stripHtml(item.description),
			...item.roles.map((role) => `${role.position} ${role.period} ${stripHtml(role.description)}`.trim()),
		])
		.filter(Boolean)
		.join(" ");

	const projectText = projectItems
		.flatMap((item) => [item.name, item.period, stripHtml(item.description)])
		.filter(Boolean)
		.join(" ");

	const educationText = educationItems
		.flatMap((item) => [item.school, item.degree, item.area, item.grade, item.period, stripHtml(item.description)])
		.filter(Boolean)
		.join(" ");

	const skillText = skillItems
		.flatMap((item) => [item.name, item.proficiency, ...item.keywords])
		.filter(Boolean)
		.join(" ");

	const impactStatements = [
		...experienceItems.flatMap((item) => [
			...extractStatementsFromHtml(item.description),
			...item.roles.flatMap((role) => extractStatementsFromHtml(role.description)),
		]),
		...projectItems.flatMap((item) => extractStatementsFromHtml(item.description)),
	];

	const richTextBlocks = [
		resumeData.summary.content,
		...experienceItems.map((item) => item.description),
		...experienceItems.flatMap((item) => item.roles.map((role) => role.description)),
		...projectItems.map((item) => item.description),
	];

	return {
		richTextBlocks,
		impactStatements,
		fullText: normalizeWhitespace(`${basicsText} ${summaryText} ${experienceText} ${projectText} ${educationText} ${skillText}`),
	};
};

const createCheck = (input: Omit<AtsCheckResult, "result">): AtsCheckResult => {
	const result = input.score >= 85 ? "pass" : input.score >= 60 ? "warn" : "fail";
	return { ...input, result };
};

const evaluateCompleteness = (resumeData: ResumeData): AtsCheckResult => {
	const missing: string[] = [];

	if (!resumeData.basics.name.trim() || !resumeData.basics.headline.trim()) {
		missing.push("basics");
	}

	if (resumeData.summary.hidden || stripHtml(resumeData.summary.content).length < 30) {
		missing.push("summary");
	}

	if (resumeData.sections.experience.items.filter((item) => !item.hidden).length === 0) {
		missing.push("experience");
	}

	if (resumeData.sections.skills.items.filter((item) => !item.hidden).length === 0) {
		missing.push("skills");
	}

	if (resumeData.sections.education.items.filter((item) => !item.hidden).length === 0) {
		missing.push("education");
	}

	const totalSections = 5;
	const score = Math.round(((totalSections - missing.length) / totalSections) * 100);

	return createCheck({
		id: "section_completeness",
		weight: 30,
		score,
		message:
			missing.length === 0
				? "Core ATS sections are present"
				: "One or more core ATS sections are missing or too sparse",
		details: { missing },
	});
};

const evaluateFormatting = (richTextBlocks: string[], impactStatements: string[]): AtsCheckResult => {
	const issues: string[] = [];

	for (const [index, block] of richTextBlocks.entries()) {
		if (!block.trim()) continue;

		if (UNSUPPORTED_FORMATTING_PATTERN.test(block)) {
			issues.push(`block[${index}] contains unsupported formatting elements`);
		}

		if (/\|\s*[^|]+\s*\|/.test(block)) {
			issues.push(`block[${index}] includes table-like markup`);
		}
	}

	for (const [index, statement] of impactStatements.entries()) {
		if (statement.length > 280) {
			issues.push(`statement[${index}] exceeds recommended length`);
		}

		if (/[^\x09\x0A\x0D\x20-\x7E]/.test(statement)) {
			issues.push(`statement[${index}] contains non-ASCII characters that may reduce parser reliability`);
		}
	}

	const score = issues.length === 0 ? 100 : clamp(100 - issues.length * 12, 20, 100);

	return createCheck({
		id: "ats_parseability",
		weight: 25,
		score,
		message: issues.length === 0 ? "Formatting appears ATS-friendly" : "Formatting may reduce ATS parsing quality",
		details: { totalIssues: issues.length, issues: issues.slice(0, 10) },
	});
};

const evaluateKeywordCoverage = (fullText: string, targetKeywords: string[]): AtsCheckResult => {
	if (targetKeywords.length === 0) {
		return {
			id: "keyword_coverage",
			result: "pass",
			weight: 30,
			score: 100,
			message: "No target keywords provided; skipping keyword coverage penalties",
			details: { matched: [], missing: [] },
		};
	}

	const lowerText = fullText.toLowerCase();
	const matched = targetKeywords.filter((keyword) => containsKeyword(lowerText, keyword));
	const missing = targetKeywords.filter((keyword) => !matched.includes(keyword));
	const coverage = matched.length / targetKeywords.length;
	const score = clamp(Math.round((coverage / 0.7) * 100), 0, 100);

	return {
		id: "keyword_coverage",
		result: coverage >= 0.7 ? "pass" : coverage >= 0.45 ? "warn" : "fail",
		weight: 30,
		score,
		message: `Target keyword coverage is ${(coverage * 100).toFixed(1)}%`,
		details: {
			coverage,
			matched,
			missing,
		},
	};
};

const firstToken = (value: string) => tokenizeWords(value)[0] ?? "";

const evaluateImpactEvidence = (impactStatements: string[]): AtsCheckResult => {
	if (impactStatements.length === 0) {
		return {
			id: "impact_evidence",
			result: "warn",
			weight: 15,
			score: 35,
			message: "No bullet-style impact statements found",
			details: { totalStatements: 0, quantifiedStatements: 0, actionLedStatements: 0 },
		};
	}

	const quantifiedStatements = impactStatements.filter((statement) => QUANTIFIABLE_IMPACT_PATTERN.test(statement)).length;
	const actionLedStatements = impactStatements.filter((statement) => STRONG_ACTION_VERBS.has(firstToken(statement))).length;

	const metricRatio = quantifiedStatements / impactStatements.length;
	const actionRatio = actionLedStatements / impactStatements.length;
	const score = clamp(Math.round(metricRatio * 70 + actionRatio * 30), 0, 100);

	return {
		id: "impact_evidence",
		result: score >= 70 ? "pass" : score >= 45 ? "warn" : "fail",
		weight: 15,
		score,
		message: "Impact and action-oriented phrasing coverage",
		details: {
			totalStatements: impactStatements.length,
			quantifiedStatements,
			actionLedStatements,
		},
	};
};

export const evaluateAtsReport = (input: EvaluateAtsReportInput): AtsReport => {
	const threshold = clamp(Math.round(input.threshold ?? DEFAULT_THRESHOLD), 0, 100);
	const targetKeywords = getTargetKeywords(input.keywords, input.jobDescription);

	const { fullText, richTextBlocks, impactStatements } = getAllResumeText(input.resumeData);

	const checks = [
		evaluateCompleteness(input.resumeData),
		evaluateFormatting(richTextBlocks, impactStatements),
		evaluateKeywordCoverage(fullText, targetKeywords),
		evaluateImpactEvidence(impactStatements),
	];

	const score = Math.round(checks.reduce((acc, check) => acc + (check.score * check.weight) / 100, 0));

	return {
		score,
		threshold,
		pass: score >= threshold,
		keywords: targetKeywords,
		checks,
		generatedAt: new Date().toISOString(),
	};
};
