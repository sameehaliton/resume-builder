import type { ResumeData } from "@/schema/resume/data";
import { stripHtml } from "@/utils/string";

const DEFAULT_MAX_KEYWORDS = 18;
const MIN_JOB_DESCRIPTION_LENGTH = 40;

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
	"in",
	"into",
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
	"you",
	"your",
	"we",
	"our",
	"will",
	"can",
	"must",
	"should",
	"have",
	"has",
	"had",
	"using",
	"use",
	"years",
	"year",
	"experience",
]);

const LIST_ITEM_PATTERN = /<li[^>]*>([\s\S]*?)<\/li>/gi;
const LIST_PATTERN = /<ul[\s\S]*?<\/ul>/i;

export type TailorGenerationErrorCode = "missing_jd" | "jd_too_short" | "no_keywords";

export class TailorGenerationError extends Error {
	constructor(
		public readonly code: TailorGenerationErrorCode,
		public readonly userMessage: string,
	) {
		super(userMessage);
	}
}

export interface TailorJDAnalysis {
	roleSummary: string;
	requiredSkills: string[];
	preferredSkills: string[];
	keywords: string[];
}

export interface TailorChange {
	path: string;
	reason: string;
	before: string;
	after: string;
}

export interface TailorGenerationResult {
	analysis: TailorJDAnalysis;
	keywordsUsed: string[];
	changes: TailorChange[];
	warnings: string[];
	tailoredData: ResumeData;
}

type TailorInput = {
	resumeData: ResumeData;
	jobDescription: string;
	maxKeywords?: number;
};

const escapeForRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const decodeHtmlEntities = (value: string) =>
	value
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'");

const toPlainText = (value: string) => normalizeWhitespace(decodeHtmlEntities(stripHtml(value)));

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const containsKeyword = (text: string, keyword: string) => {
	if (!keyword) return false;

	const escaped = escapeForRegex(keyword).replace(/\s+/g, "\\s+");
	const pattern = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i");
	return pattern.test(text);
};

const scoreTextAgainstKeywords = (text: string, keywords: string[]) => {
	const lower = text.toLowerCase();
	let score = 0;

	for (const keyword of keywords) {
		if (containsKeyword(lower, keyword.toLowerCase())) score += 1;
	}

	return score;
};

const extractListItems = (html: string) =>
	Array.from(html.matchAll(LIST_ITEM_PATTERN))
		.map((match) => toPlainText(match[1] ?? ""))
		.filter((item) => item.length > 0);

const replaceFirstList = (html: string, bullets: string[]) => {
	const nextList = `<ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`;

	if (LIST_PATTERN.test(html)) {
		return html.replace(LIST_PATTERN, nextList);
	}

	const trimmed = html.trim();
	if (!trimmed) return nextList;
	return `${trimmed}\n${nextList}`;
};

const dedupe = (values: string[]) => {
	const seen = new Set<string>();
	const output: string[] = [];

	for (const value of values) {
		const key = normalizeWhitespace(value).toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		output.push(normalizeWhitespace(value));
	}

	return output;
};

const tokenize = (value: string) =>
	value
		.toLowerCase()
		.split(/[^a-z0-9+#.]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const parseJobDescription = (jobDescription: string): TailorJDAnalysis => {
	const lines = jobDescription
		.split(/\r?\n/)
		.map((line) => normalizeWhitespace(line))
		.filter((line) => line.length > 0);

	const roleSummary = lines[0] ?? "";
	const requiredSkills: string[] = [];
	const preferredSkills: string[] = [];
	let section: "required" | "preferred" | "none" = "none";

	for (const line of lines) {
		const lower = line.toLowerCase();

		if (/^(required|required qualifications|must[- ]have|minimum qualifications)/i.test(lower)) {
			section = "required";
			continue;
		}

		if (/^(preferred|nice[- ]to[- ]have|bonus|preferred qualifications)/i.test(lower)) {
			section = "preferred";
			continue;
		}

		if (/^[-*\u2022]\s+/.test(line)) {
			const normalized = line.replace(/^[-*\u2022]\s+/, "").trim();
			if (!normalized) continue;

			if (section === "required") requiredSkills.push(normalized);
			if (section === "preferred") preferredSkills.push(normalized);
		}
	}

	const frequencies = new Map<string, number>();
	for (const token of tokenize(lines.join(" "))) {
		frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
	}

	const keywords = Array.from(frequencies.entries())
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 36)
		.map(([keyword]) => keyword);

	return {
		roleSummary,
		requiredSkills: dedupe(requiredSkills),
		preferredSkills: dedupe(preferredSkills),
		keywords,
	};
};

const keywordsFromAnalysis = (analysis: TailorJDAnalysis, maxKeywords: number) => {
	const merged = [
		...analysis.requiredSkills,
		...analysis.preferredSkills.slice(0, 8),
		...analysis.keywords,
	].map((keyword) => normalizeWhitespace(keyword));

	return dedupe(merged)
		.map((keyword) => keyword.toLowerCase())
		.filter((keyword) => keyword.length >= 2)
		.slice(0, maxKeywords);
};

const reorderBulletsByKeywords = (bullets: string[], keywords: string[]) => {
	return [...bullets]
		.map((bullet, index) => ({
			bullet,
			index,
			score: scoreTextAgainstKeywords(bullet, keywords),
		}))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => entry.bullet);
};

const previewList = (values: string[]) => values.map((value) => value.slice(0, 80)).join(" | ");

const reorderResumeContent = (resumeData: ResumeData, keywords: string[], changes: TailorChange[]) => {
	let hasBulletContent = false;

	for (const [index, item] of resumeData.sections.experience.items.entries()) {
		if (item.hidden) continue;

		const descriptionBullets = extractListItems(item.description);
		if (descriptionBullets.length > 1) {
			hasBulletContent = true;
			const reordered = reorderBulletsByKeywords(descriptionBullets, keywords);
			if (descriptionBullets.some((bullet, bulletIndex) => bullet !== reordered[bulletIndex])) {
				changes.push({
					path: `sections.experience.items[${index}].description`,
					reason: "Reordered experience bullets to prioritize JD-relevant evidence.",
					before: previewList(descriptionBullets),
					after: previewList(reordered),
				});
				item.description = replaceFirstList(item.description, reordered);
			}
		}

		for (const [roleIndex, role] of item.roles.entries()) {
			const roleBullets = extractListItems(role.description);
			if (roleBullets.length <= 1) continue;

			hasBulletContent = true;
			const reordered = reorderBulletsByKeywords(roleBullets, keywords);
			if (roleBullets.some((bullet, bulletIndex) => bullet !== reordered[bulletIndex])) {
				changes.push({
					path: `sections.experience.items[${index}].roles[${roleIndex}].description`,
					reason: "Reordered role bullets to emphasize keyword alignment.",
					before: previewList(roleBullets),
					after: previewList(reordered),
				});
				role.description = replaceFirstList(role.description, reordered);
			}
		}
	}

	for (const [index, item] of resumeData.sections.projects.items.entries()) {
		if (item.hidden) continue;

		const bullets = extractListItems(item.description);
		if (bullets.length <= 1) continue;

		hasBulletContent = true;
		const reordered = reorderBulletsByKeywords(bullets, keywords);
		if (bullets.some((bullet, bulletIndex) => bullet !== reordered[bulletIndex])) {
			changes.push({
				path: `sections.projects.items[${index}].description`,
				reason: "Reordered project bullets to surface relevant wins first.",
				before: previewList(bullets),
				after: previewList(reordered),
			});
			item.description = replaceFirstList(item.description, reordered);
		}
	}

	return { hasBulletContent };
};

const reorderSectionsByRelevance = (resumeData: ResumeData, keywords: string[], changes: TailorChange[]) => {
	const experienceWithScores = resumeData.sections.experience.items.map((item, index) => {
		const source = [item.company, item.position, toPlainText(item.description)].join(" ");
		const roleText = item.roles.map((role) => `${role.position} ${toPlainText(role.description)}`).join(" ");
		return {
			item,
			index,
			score: scoreTextAgainstKeywords(`${source} ${roleText}`, keywords),
		};
	});

	const sortedExperience = [...experienceWithScores].sort((a, b) => b.score - a.score || a.index - b.index);
	if (experienceWithScores.some((entry, index) => entry.item.id !== sortedExperience[index]?.item.id)) {
		changes.push({
			path: "sections.experience.items",
			reason: "Reordered experience entries by relevance to JD keywords.",
			before: experienceWithScores.map((entry) => entry.item.company || entry.item.position || entry.item.id).join(" | "),
			after: sortedExperience.map((entry) => entry.item.company || entry.item.position || entry.item.id).join(" | "),
		});
		resumeData.sections.experience.items = sortedExperience.map((entry) => entry.item);
	}

	const skillWithScores = resumeData.sections.skills.items.map((item, index) => {
		const skillText = [item.name, item.proficiency, ...item.keywords].join(" ");
		return { item, index, score: scoreTextAgainstKeywords(skillText, keywords) };
	});

	const sortedSkills = [...skillWithScores].sort((a, b) => b.score - a.score || a.index - b.index);
	if (skillWithScores.some((entry, index) => entry.item.id !== sortedSkills[index]?.item.id)) {
		changes.push({
			path: "sections.skills.items",
			reason: "Reordered skills to prioritize JD-matching capabilities.",
			before: skillWithScores.map((entry) => entry.item.name || entry.item.id).join(" | "),
			after: sortedSkills.map((entry) => entry.item.name || entry.item.id).join(" | "),
		});
		resumeData.sections.skills.items = sortedSkills.map((entry) => entry.item);
	}
};

const updateSummaryAndHeadline = (
	resumeData: ResumeData,
	analysis: TailorJDAnalysis,
	keywords: string[],
	changes: TailorChange[],
) => {
	if (!resumeData.basics.headline.trim() && analysis.roleSummary) {
		const nextHeadline = analysis.roleSummary.slice(0, 120);
		changes.push({
			path: "basics.headline",
			reason: "Set headline from job role context for stronger alignment.",
			before: resumeData.basics.headline,
			after: nextHeadline,
		});
		resumeData.basics.headline = nextHeadline;
	}

	if (keywords.length === 0) return;

	const currentSummary = toPlainText(resumeData.summary.content);
	const highlightedKeywords = keywords.slice(0, 5).join(", ");
	const tailoredSentence = `Targeting roles requiring ${highlightedKeywords}.`;
	const nextSummary = currentSummary
		? `<p>${escapeHtml(currentSummary)}</p><p>${escapeHtml(tailoredSentence)}</p>`
		: `<p>${escapeHtml(tailoredSentence)}</p>`;

	if (nextSummary !== resumeData.summary.content) {
		changes.push({
			path: "summary.content",
			reason: "Updated summary to reflect role-specific keyword focus.",
			before: currentSummary,
			after: normalizeWhitespace(`${currentSummary} ${tailoredSentence}`),
		});
		resumeData.summary.hidden = false;
		resumeData.summary.content = nextSummary;
	}
};

export const generateTailoredResume = (input: TailorInput): TailorGenerationResult => {
	const jobDescription = input.jobDescription.trim();
	if (!jobDescription) {
		throw new TailorGenerationError("missing_jd", "Please provide the job description text to generate a tailored resume.");
	}

	if (jobDescription.length < MIN_JOB_DESCRIPTION_LENGTH) {
		throw new TailorGenerationError(
			"jd_too_short",
			"The job description is too short. Paste a fuller posting so tailoring can identify role requirements.",
		);
	}

	const analysis = parseJobDescription(jobDescription);
	const maxKeywords = Math.max(5, Math.min(input.maxKeywords ?? DEFAULT_MAX_KEYWORDS, 40));
	const keywordsUsed = keywordsFromAnalysis(analysis, maxKeywords);
	if (keywordsUsed.length === 0) {
		throw new TailorGenerationError(
			"no_keywords",
			"We could not extract enough actionable keywords from this job description. Please provide a more detailed posting.",
		);
	}

	const tailoredData = structuredClone(input.resumeData);
	const changes: TailorChange[] = [];
	const warnings: string[] = [];

	updateSummaryAndHeadline(tailoredData, analysis, keywordsUsed, changes);

	const { hasBulletContent } = reorderResumeContent(tailoredData, keywordsUsed, changes);
	reorderSectionsByRelevance(tailoredData, keywordsUsed, changes);

	if (!hasBulletContent) {
		warnings.push("No bullet lists were found in experience/projects; only section ordering and summary updates were applied.");
	}

	if (changes.length === 0) {
		warnings.push("No high-confidence tailoring changes were detected for this resume and job description pair.");
	}

	return {
		analysis,
		keywordsUsed,
		changes,
		warnings,
		tailoredData,
	};
};
