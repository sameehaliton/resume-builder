import type { ResumeData } from "@/schema/resume/data";
import { stripHtml } from "@/utils/string";

const RENDERCV_SCHEMA_COMMENT =
	"# yaml-language-server: $schema=https://github.com/rendercv/rendercv/blob/main/schema.json?raw=true";

const ISO_DATE_REGEX =
	/^([1-2][0-9]{3}-[0-1][0-9]-[0-3][0-9]|[1-2][0-9]{3}-[0-1][0-9]|[1-2][0-9]{3})$/;

const MONTHS: Record<string, string> = {
	jan: "01",
	january: "01",
	feb: "02",
	february: "02",
	mar: "03",
	march: "03",
	apr: "04",
	april: "04",
	may: "05",
	jun: "06",
	june: "06",
	jul: "07",
	july: "07",
	aug: "08",
	august: "08",
	sep: "09",
	sept: "09",
	september: "09",
	oct: "10",
	october: "10",
	nov: "11",
	november: "11",
	dec: "12",
	december: "12",
};

type DateRange = {
	startDate?: string;
	endDate?: string;
	isRange: boolean;
};

type RenderCVDateFields = {
	date?: string;
	start_date?: string;
	end_date?: string;
};

type DescriptionParts = {
	summary?: string;
	highlights: string[];
};

type RenderCVSocialNetwork = {
	network: string;
	username: string;
};

type RenderCVNormalEntry = {
	name: string;
	location?: string;
	date?: string;
	start_date?: string;
	end_date?: string;
	summary?: string;
	highlights?: string[];
};

type RenderCVExperienceEntry = {
	company: string;
	position: string;
	location?: string;
	date?: string;
	start_date?: string;
	end_date?: string;
	summary?: string;
	highlights?: string[];
};

type RenderCVEducationEntry = {
	institution: string;
	area: string;
	degree?: string;
	location?: string;
	date?: string;
	start_date?: string;
	end_date?: string;
	summary?: string;
	highlights?: string[];
};

type RenderCVSectionEntry = RenderCVNormalEntry | RenderCVExperienceEntry | RenderCVEducationEntry;

type RenderCVSections = Record<string, RenderCVSectionEntry[]>;

export type RenderCVDocument = {
	cv: {
		name?: string;
		location?: string;
		email?: string;
		phone?: string;
		website?: string;
		summary?: string;
		social_networks?: RenderCVSocialNetwork[];
		sections?: RenderCVSections;
	};
};

function toNonEmptyString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function sanitizeUrl(value: string | undefined): string | undefined {
	const url = toNonEmptyString(value);
	if (!url) return undefined;

	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
		return parsed.toString();
	} catch {
		return undefined;
	}
}

function normalizeDay(value: string): string {
	return value.padStart(2, "0");
}

function parseDateToken(input: string | undefined): string | undefined {
	const value = toNonEmptyString(input)?.replace(/,+/g, "");
	if (!value) return undefined;

	const lower = value.toLowerCase();
	if (["present", "current", "now", "ongoing", "today"].includes(lower)) return undefined;

	if (ISO_DATE_REGEX.test(value)) return value;

	const monthYear = /^([a-zA-Z]+)\s+([1-2][0-9]{3})$/.exec(value);
	if (monthYear) {
		const month = MONTHS[monthYear[1].toLowerCase()];
		if (!month) return undefined;
		return `${monthYear[2]}-${month}`;
	}

	const monthDayYear = /^([a-zA-Z]+)\s+([0-3]?[0-9])\s+([1-2][0-9]{3})$/.exec(value);
	if (monthDayYear) {
		const month = MONTHS[monthDayYear[1].toLowerCase()];
		if (!month) return undefined;
		return `${monthDayYear[3]}-${month}-${normalizeDay(monthDayYear[2])}`;
	}

	const dayMonthYear = /^([0-3]?[0-9])\s+([a-zA-Z]+)\s+([1-2][0-9]{3})$/.exec(value);
	if (dayMonthYear) {
		const month = MONTHS[dayMonthYear[2].toLowerCase()];
		if (!month) return undefined;
		return `${dayMonthYear[3]}-${month}-${normalizeDay(dayMonthYear[1])}`;
	}

	const monthSlashYear = /^([0-1]?[0-9])\/([1-2][0-9]{3})$/.exec(value);
	if (monthSlashYear) {
		return `${monthSlashYear[2]}-${normalizeDay(monthSlashYear[1])}`;
	}

	const yearOnly = /^([1-2][0-9]{3})$/.exec(value);
	if (yearOnly) return yearOnly[1];

	return undefined;
}

function parsePeriod(period: string | undefined): DateRange {
	const value = toNonEmptyString(period);
	if (!value) return { isRange: false };

	const separators = [/\s+to\s+/i, /\s+-\s+/, /\s+–\s+/, /\s+—\s+/, /\s*–\s*/, /\s*—\s*/];

	for (const separator of separators) {
		const parts = value.split(separator).map((part) => part.trim());
		if (parts.length >= 2) {
			const startDate = parseDateToken(parts[0]);
			const endDate = parseDateToken(parts[1]);
			return {
				isRange: true,
				...(startDate ? { startDate } : {}),
				...(endDate ? { endDate } : {}),
			};
		}
	}

	const date = parseDateToken(value);
	return {
		isRange: false,
		...(date ? { startDate: date } : {}),
	};
}

function toRenderCVDateFields(period: string | undefined): RenderCVDateFields {
	const { isRange, startDate, endDate } = parsePeriod(period);

	if (isRange) {
		return {
			...(startDate ? { start_date: startDate } : {}),
			...(endDate ? { end_date: endDate } : {}),
		};
	}

	return startDate ? { date: startDate } : {};
}

function extractHighlights(html: string | undefined): string[] {
	if (!html) return [];

	return Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
		.map((match) => toNonEmptyString(stripHtml(match[1])))
		.filter((value): value is string => Boolean(value));
}

function splitDescription(html: string | undefined): DescriptionParts {
	if (!html) return { highlights: [] };

	const withoutLists = html.replace(/<ul[\s\S]*?<\/ul>/gi, " ");
	const summary = toNonEmptyString(stripHtml(withoutLists));
	const highlights = extractHighlights(html);

	return {
		...(summary ? { summary } : {}),
		highlights,
	};
}

function getVisibleItems<T extends { hidden: boolean }>(section: { hidden: boolean; items: T[] }): T[] {
	if (section.hidden) return [];
	return section.items.filter((item) => !item.hidden);
}

function parseNetworkFromUrl(url: string | undefined): string | undefined {
	const parsed = sanitizeUrl(url);
	if (!parsed) return undefined;

	try {
		const hostname = new URL(parsed).hostname.replace(/^www\./, "");
		const [network] = hostname.split(".");
		return toNonEmptyString(network);
	} catch {
		return undefined;
	}
}

function parseUsernameFromUrl(url: string | undefined): string | undefined {
	const parsed = sanitizeUrl(url);
	if (!parsed) return undefined;

	try {
		const pathSegments = new URL(parsed).pathname.split("/").filter(Boolean);
		if (pathSegments.length === 0) return undefined;
		return toNonEmptyString(decodeURIComponent(pathSegments[pathSegments.length - 1]));
	} catch {
		return undefined;
	}
}

function mapSocialNetworks(resumeData: ResumeData): RenderCVSocialNetwork[] {
	return getVisibleItems(resumeData.sections.profiles)
		.map((item): RenderCVSocialNetwork | undefined => {
			const network = toNonEmptyString(item.network) ?? parseNetworkFromUrl(item.website.url);
			const username = toNonEmptyString(item.username) ?? parseUsernameFromUrl(item.website.url);

			if (!network || !username) return undefined;
			return { network, username };
		})
		.filter((entry): entry is RenderCVSocialNetwork => Boolean(entry));
}

function mapExperience(resumeData: ResumeData): RenderCVExperienceEntry[] {
	return getVisibleItems(resumeData.sections.experience).flatMap((item) => {
		const company = toNonEmptyString(item.company);
		if (!company) return [];

		const location = toNonEmptyString(item.location);
		const getEntry = (
			position: string | undefined,
			period: string | undefined,
			description: string | undefined,
		): RenderCVExperienceEntry => {
			const { summary, highlights } = splitDescription(description);

			return {
				company,
				position: position ?? "Role",
				...(location ? { location } : {}),
				...toRenderCVDateFields(period),
				...(summary ? { summary } : {}),
				...(highlights.length > 0 ? { highlights } : {}),
			};
		};

		if (item.roles.length > 0) {
			return item.roles.map((role) => {
				const position = toNonEmptyString(role.position) ?? toNonEmptyString(item.position);
				return getEntry(position, role.period || item.period, role.description || item.description);
			});
		}

		const position = toNonEmptyString(item.position);
		return [getEntry(position, item.period, item.description)];
	});
}

function mapEducation(resumeData: ResumeData): RenderCVEducationEntry[] {
	return getVisibleItems(resumeData.sections.education)
		.map((item): RenderCVEducationEntry | undefined => {
			const institution = toNonEmptyString(item.school);
			if (!institution) return undefined;

			const area = toNonEmptyString(item.area) ?? toNonEmptyString(item.degree);
			if (!area) return undefined;

			const degree = toNonEmptyString(item.degree);
			const location = toNonEmptyString(item.location);
			const { summary, highlights } = splitDescription(item.description);

			return {
				institution,
				area,
				...(degree && degree !== area ? { degree } : {}),
				...(location ? { location } : {}),
				...toRenderCVDateFields(item.period),
				...(summary ? { summary } : {}),
				...(highlights.length > 0 ? { highlights } : {}),
			};
		})
		.filter((entry): entry is RenderCVEducationEntry => Boolean(entry));
}

function mapProjects(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.projects)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const { summary, highlights } = splitDescription(item.description);

			return {
				name,
				...toRenderCVDateFields(item.period),
				...(summary ? { summary } : {}),
				...(highlights.length > 0 ? { highlights } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapSkills(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.skills)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const summary = toNonEmptyString(item.proficiency);
			const highlights = item.keywords.map((keyword) => keyword.trim()).filter(Boolean);

			return {
				name,
				...(summary ? { summary } : {}),
				...(highlights.length > 0 ? { highlights } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapLanguages(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.languages)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.language);
			if (!name) return undefined;

			const summary = toNonEmptyString(item.fluency);
			return {
				name,
				...(summary ? { summary } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapInterests(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.interests)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const highlights = item.keywords.map((keyword) => keyword.trim()).filter(Boolean);
			return {
				name,
				...(highlights.length > 0 ? { highlights } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapAwards(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.awards)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.title);
			if (!name) return undefined;

			const summary = toNonEmptyString(stripHtml(item.description));
			const location = toNonEmptyString(item.awarder);
			const date = parseDateToken(item.date);

			return {
				name,
				...(location ? { location } : {}),
				...(date ? { date } : {}),
				...(summary ? { summary } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapCertifications(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.certifications)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.title);
			if (!name) return undefined;

			const summary = toNonEmptyString(stripHtml(item.description));
			const location = toNonEmptyString(item.issuer);
			const date = parseDateToken(item.date);

			return {
				name,
				...(location ? { location } : {}),
				...(date ? { date } : {}),
				...(summary ? { summary } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapPublications(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.publications)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.title);
			if (!name) return undefined;

			const summary = toNonEmptyString(stripHtml(item.description));
			const location = toNonEmptyString(item.publisher);
			const date = parseDateToken(item.date);

			return {
				name,
				...(location ? { location } : {}),
				...(date ? { date } : {}),
				...(summary ? { summary } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapVolunteer(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.volunteer)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.organization);
			if (!name) return undefined;

			const location = toNonEmptyString(item.location);
			const { summary, highlights } = splitDescription(item.description);

			return {
				name,
				...(location ? { location } : {}),
				...toRenderCVDateFields(item.period),
				...(summary ? { summary } : {}),
				...(highlights.length > 0 ? { highlights } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function mapReferences(resumeData: ResumeData): RenderCVNormalEntry[] {
	return getVisibleItems(resumeData.sections.references)
		.map((item): RenderCVNormalEntry | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const details = [
				toNonEmptyString(item.position),
				toNonEmptyString(item.phone),
				sanitizeUrl(item.website.url),
			].filter((value): value is string => Boolean(value));
			const summaryParts = [toNonEmptyString(stripHtml(item.description)), details.join(" | ")].filter(
				(value): value is string => Boolean(value),
			);

			return {
				name,
				...(summaryParts.length > 0 ? { summary: summaryParts.join(" | ") } : {}),
			};
		})
		.filter((entry): entry is RenderCVNormalEntry => Boolean(entry));
}

function resolveSectionTitle(title: string, fallback: string): string {
	return toNonEmptyString(title) ?? fallback;
}

function addSection(sections: RenderCVSections, title: string, entries: RenderCVSectionEntry[]) {
	if (entries.length === 0) return;

	let key = title;
	let suffix = 2;
	while (sections[key]) {
		key = `${title} (${suffix})`;
		suffix += 1;
	}

	sections[key] = entries;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
	return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringifyScalar(value: string | number | boolean | null): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (value === null) return "null";
	return String(value);
}

function stringifyKey(key: string): string {
	return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function toYAML(value: unknown, indent = 0): string {
	const spacing = "  ".repeat(indent);

	if (isScalar(value)) return `${spacing}${stringifyScalar(value)}`;

	if (Array.isArray(value)) {
		if (value.length === 0) return `${spacing}[]`;

		const lines = value
			.filter((item) => item !== undefined)
			.map((item) => {
				if (isScalar(item)) return `${spacing}- ${stringifyScalar(item)}`;
				if (Array.isArray(item) && item.length === 0) return `${spacing}- []`;
				if (isPlainObject(item) && Object.keys(item).length === 0) return `${spacing}- {}`;
				return `${spacing}-\n${toYAML(item, indent + 1)}`;
			});

		return lines.join("\n");
	}

	if (isPlainObject(value)) {
		const entries = Object.entries(value).filter(([, item]) => item !== undefined);
		if (entries.length === 0) return `${spacing}{}`;

		const lines = entries.map(([key, item]) => {
			const yamlKey = stringifyKey(key);

			if (isScalar(item)) return `${spacing}${yamlKey}: ${stringifyScalar(item)}`;
			if (Array.isArray(item) && item.length === 0) return `${spacing}${yamlKey}: []`;
			if (isPlainObject(item) && Object.keys(item).length === 0) return `${spacing}${yamlKey}: {}`;

			return `${spacing}${yamlKey}:\n${toYAML(item, indent + 1)}`;
		});

		return lines.join("\n");
	}

	return `${spacing}${stringifyScalar(String(value))}`;
}

export class RenderCVExporter {
	convert(resumeData: ResumeData): RenderCVDocument {
		const sections: RenderCVSections = {};

		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.education.title, "Education"),
			mapEducation(resumeData),
		);
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.experience.title, "Experience"),
			mapExperience(resumeData),
		);
		addSection(sections, resolveSectionTitle(resumeData.sections.projects.title, "Projects"), mapProjects(resumeData));
		addSection(sections, resolveSectionTitle(resumeData.sections.skills.title, "Skills"), mapSkills(resumeData));
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.languages.title, "Languages"),
			mapLanguages(resumeData),
		);
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.interests.title, "Interests"),
			mapInterests(resumeData),
		);
		addSection(sections, resolveSectionTitle(resumeData.sections.awards.title, "Awards"), mapAwards(resumeData));
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.certifications.title, "Certifications"),
			mapCertifications(resumeData),
		);
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.publications.title, "Publications"),
			mapPublications(resumeData),
		);
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.volunteer.title, "Volunteering"),
			mapVolunteer(resumeData),
		);
		addSection(
			sections,
			resolveSectionTitle(resumeData.sections.references.title, "References"),
			mapReferences(resumeData),
		);

		const summary = resumeData.summary.hidden ? undefined : toNonEmptyString(stripHtml(resumeData.summary.content));
		const socialNetworks = mapSocialNetworks(resumeData);
		const website = sanitizeUrl(resumeData.basics.website.url);

		return {
			cv: {
				...(toNonEmptyString(resumeData.basics.name) ? { name: toNonEmptyString(resumeData.basics.name) } : {}),
				...(toNonEmptyString(resumeData.basics.location)
					? { location: toNonEmptyString(resumeData.basics.location) }
					: {}),
				...(toNonEmptyString(resumeData.basics.email) ? { email: toNonEmptyString(resumeData.basics.email) } : {}),
				...(toNonEmptyString(resumeData.basics.phone) ? { phone: toNonEmptyString(resumeData.basics.phone) } : {}),
				...(website ? { website } : {}),
				...(summary ? { summary } : {}),
				...(socialNetworks.length > 0 ? { social_networks: socialNetworks } : {}),
				...(Object.keys(sections).length > 0 ? { sections } : {}),
			},
		};
	}

	parse(resumeData: ResumeData): string {
		const yamlContent = toYAML(this.convert(resumeData));
		return `${RENDERCV_SCHEMA_COMMENT}\n${yamlContent}\n`;
	}
}
