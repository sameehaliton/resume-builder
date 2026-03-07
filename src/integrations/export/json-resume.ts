import { JSONResumeImporter } from "@/integrations/import/json-resume";
import { jsonResumeSchema } from "@/schema/json-resume";
import type { ResumeData } from "@/schema/resume/data";
import type {
	JSONResume,
	JSONResumeAward,
	JSONResumeBasics,
	JSONResumeCertificate,
	JSONResumeEducation,
	JSONResumeInterest,
	JSONResumeLanguage,
	JSONResumeLocation,
	JSONResumeProfile,
	JSONResumeProject,
	JSONResumePublication,
	JSONResumeReference,
	JSONResumeSkill,
	JSONResumeVolunteer,
	JSONResumeWork,
} from "@/types/json-resume";
import { stripHtml } from "@/utils/string";

const JSON_RESUME_SCHEMA_URL = "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
};

type DescriptionParts = {
	summary?: string;
	highlights?: string[];
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

function sanitizeEmail(value: string | undefined): string | undefined {
	const email = toNonEmptyString(value);
	if (!email) return undefined;
	return EMAIL_REGEX.test(email) ? email : undefined;
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
	if (!value) return {};

	const separators = [/\s+to\s+/i, /\s+-\s+/, /\s+–\s+/, /\s+—\s+/, /\s*–\s*/, /\s*—\s*/];

	for (const separator of separators) {
		const parts = value.split(separator).map((part) => part.trim());
		if (parts.length >= 2) {
			const startDate = parseDateToken(parts[0]);
			const endDate = parseDateToken(parts[1]);
			return {
				...(startDate ? { startDate } : {}),
				...(endDate ? { endDate } : {}),
			};
		}
	}

	const startDate = parseDateToken(value);
	return startDate ? { startDate } : {};
}

function extractHighlights(html: string | undefined): string[] {
	if (!html) return [];

	return Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
		.map((match) => toNonEmptyString(stripHtml(match[1])))
		.filter((value): value is string => Boolean(value));
}

function splitDescription(html: string | undefined): DescriptionParts {
	if (!html) return {};

	const withoutLists = html.replace(/<ul[\s\S]*?<\/ul>/gi, " ");
	const summary = toNonEmptyString(stripHtml(withoutLists));
	const highlights = extractHighlights(html);

	return {
		...(summary ? { summary } : {}),
		...(highlights.length > 0 ? { highlights } : {}),
	};
}

function deriveStudyTypeAndArea(degree: string, area: string): { studyType?: string; area?: string } {
	const degreeValue = toNonEmptyString(degree);
	const areaValue = toNonEmptyString(area);
	if (!degreeValue) return areaValue ? { area: areaValue } : {};

	const [studyType, ...rest] = degreeValue.split(" in ");
	const parsedStudyType = toNonEmptyString(studyType);
	const parsedArea = areaValue ?? toNonEmptyString(rest.join(" in "));

	return {
		...(parsedStudyType ? { studyType: parsedStudyType } : {}),
		...(parsedArea ? { area: parsedArea } : {}),
	};
}

function parseLocation(value: string): JSONResumeLocation | undefined {
	const location = toNonEmptyString(value);
	if (!location) return undefined;

	const [city, region, countryCode] = location.split(",").map((part) => part.trim());
	const parsed: JSONResumeLocation = {
		...(toNonEmptyString(city) ? { city: toNonEmptyString(city) } : {}),
		...(toNonEmptyString(region) ? { region: toNonEmptyString(region) } : {}),
		...(toNonEmptyString(countryCode) ? { countryCode: toNonEmptyString(countryCode) } : {}),
	};

	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function getVisibleItems<T extends { hidden: boolean }>(section: { hidden: boolean; items: T[] }): T[] {
	if (section.hidden) return [];
	return section.items.filter((item) => !item.hidden);
}

function mapBasics(resumeData: ResumeData): JSONResumeBasics | undefined {
	const website = sanitizeUrl(resumeData.basics.website.url);
	const profiles = getVisibleItems(resumeData.sections.profiles)
		.map((item): JSONResumeProfile | undefined => {
			const network = toNonEmptyString(item.network);
			const username = toNonEmptyString(item.username);
			const url = sanitizeUrl(item.website.url);
			if (!network && !username && !url) return undefined;

			return {
				...(network ? { network } : {}),
				...(username ? { username } : {}),
				...(url ? { url } : {}),
			};
		})
		.filter((item): item is JSONResumeProfile => Boolean(item));

	const summary = resumeData.summary.hidden ? undefined : toNonEmptyString(stripHtml(resumeData.summary.content));
	const basics: JSONResumeBasics = {
		...(toNonEmptyString(resumeData.basics.name) ? { name: toNonEmptyString(resumeData.basics.name) } : {}),
		...(toNonEmptyString(resumeData.basics.headline)
			? { label: toNonEmptyString(resumeData.basics.headline) }
			: {}),
		...(sanitizeEmail(resumeData.basics.email) ? { email: sanitizeEmail(resumeData.basics.email) } : {}),
		...(toNonEmptyString(resumeData.basics.phone) ? { phone: toNonEmptyString(resumeData.basics.phone) } : {}),
		...(website ? { url: website } : {}),
		...(summary ? { summary } : {}),
		...(resumeData.picture.hidden ? {} : { image: sanitizeUrl(resumeData.picture.url) ?? resumeData.picture.url }),
		...(parseLocation(resumeData.basics.location) ? { location: parseLocation(resumeData.basics.location) } : {}),
		...(profiles.length > 0 ? { profiles } : {}),
	};

	return Object.keys(basics).length > 0 ? basics : undefined;
}

function mapWork(resumeData: ResumeData): JSONResumeWork[] {
	return getVisibleItems(resumeData.sections.experience).flatMap((item) => {
		const company = toNonEmptyString(item.company);
		if (!company) return [];

		const location = toNonEmptyString(item.location);
		const url = sanitizeUrl(item.website.url);

		if (item.roles.length > 0) {
			return item.roles
				.map((role): JSONResumeWork | undefined => {
					const position = toNonEmptyString(role.position) ?? toNonEmptyString(item.position);
					const { startDate, endDate } = parsePeriod(role.period);
					const { summary, highlights } = splitDescription(role.description || item.description);

					const work: JSONResumeWork = {
						name: company,
						...(position ? { position } : {}),
						...(location ? { location } : {}),
						...(url ? { url } : {}),
						...(startDate ? { startDate } : {}),
						...(endDate ? { endDate } : {}),
						...(summary ? { summary } : {}),
						...(highlights ? { highlights } : {}),
					};

					return Object.keys(work).length > 0 ? work : undefined;
				})
				.filter((entry): entry is JSONResumeWork => Boolean(entry));
		}

		const position = toNonEmptyString(item.position);
		const { startDate, endDate } = parsePeriod(item.period);
		const { summary, highlights } = splitDescription(item.description);

		const work: JSONResumeWork = {
			name: company,
			...(position ? { position } : {}),
			...(location ? { location } : {}),
			...(url ? { url } : {}),
			...(startDate ? { startDate } : {}),
			...(endDate ? { endDate } : {}),
			...(summary ? { summary } : {}),
			...(highlights ? { highlights } : {}),
		};

		return Object.keys(work).length > 0 ? [work] : [];
	});
}

function mapVolunteer(resumeData: ResumeData): JSONResumeVolunteer[] {
	return getVisibleItems(resumeData.sections.volunteer)
		.map((item): JSONResumeVolunteer | undefined => {
			const organization = toNonEmptyString(item.organization);
			if (!organization) return undefined;

			const { startDate, endDate } = parsePeriod(item.period);
			const { summary, highlights } = splitDescription(item.description);
			const position = toNonEmptyString(item.location);
			const url = sanitizeUrl(item.website.url);

			return {
				organization,
				...(position ? { position } : {}),
				...(url ? { url } : {}),
				...(startDate ? { startDate } : {}),
				...(endDate ? { endDate } : {}),
				...(summary ? { summary } : {}),
				...(highlights ? { highlights } : {}),
			};
		})
		.filter((item): item is JSONResumeVolunteer => Boolean(item));
}

function mapEducation(resumeData: ResumeData): JSONResumeEducation[] {
	return getVisibleItems(resumeData.sections.education)
		.map((item): JSONResumeEducation | undefined => {
			const institution = toNonEmptyString(item.school);
			if (!institution) return undefined;

			const { startDate, endDate } = parsePeriod(item.period);
			const url = sanitizeUrl(item.website.url);
			const { studyType, area } = deriveStudyTypeAndArea(item.degree, item.area);
			const courses = extractHighlights(item.description);
			const score = toNonEmptyString(item.grade);

			return {
				institution,
				...(url ? { url } : {}),
				...(studyType ? { studyType } : {}),
				...(area ? { area } : {}),
				...(startDate ? { startDate } : {}),
				...(endDate ? { endDate } : {}),
				...(score ? { score } : {}),
				...(courses.length > 0 ? { courses } : {}),
			};
		})
		.filter((item): item is JSONResumeEducation => Boolean(item));
}

function mapAwards(resumeData: ResumeData): JSONResumeAward[] {
	return getVisibleItems(resumeData.sections.awards)
		.map((item): JSONResumeAward | undefined => {
			const title = toNonEmptyString(item.title);
			if (!title) return undefined;

			const summary = toNonEmptyString(stripHtml(item.description));
			const date = parseDateToken(item.date);
			const awarder = toNonEmptyString(item.awarder);

			return {
				title,
				...(date ? { date } : {}),
				...(awarder ? { awarder } : {}),
				...(summary ? { summary } : {}),
			};
		})
		.filter((item): item is JSONResumeAward => Boolean(item));
}

function mapCertificates(resumeData: ResumeData): JSONResumeCertificate[] {
	return getVisibleItems(resumeData.sections.certifications)
		.map((item): JSONResumeCertificate | undefined => {
			const name = toNonEmptyString(item.title);
			if (!name) return undefined;

			const issuer = toNonEmptyString(item.issuer);
			const date = parseDateToken(item.date);
			const url = sanitizeUrl(item.website.url);

			return {
				name,
				...(issuer ? { issuer } : {}),
				...(date ? { date } : {}),
				...(url ? { url } : {}),
			};
		})
		.filter((item): item is JSONResumeCertificate => Boolean(item));
}

function mapPublications(resumeData: ResumeData): JSONResumePublication[] {
	return getVisibleItems(resumeData.sections.publications)
		.map((item): JSONResumePublication | undefined => {
			const name = toNonEmptyString(item.title);
			if (!name) return undefined;

			const publisher = toNonEmptyString(item.publisher);
			const releaseDate = parseDateToken(item.date);
			const url = sanitizeUrl(item.website.url);
			const summary = toNonEmptyString(stripHtml(item.description));

			return {
				name,
				...(publisher ? { publisher } : {}),
				...(releaseDate ? { releaseDate } : {}),
				...(url ? { url } : {}),
				...(summary ? { summary } : {}),
			};
		})
		.filter((item): item is JSONResumePublication => Boolean(item));
}

function mapSkills(resumeData: ResumeData): JSONResumeSkill[] {
	return getVisibleItems(resumeData.sections.skills)
		.map((item): JSONResumeSkill | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const level = toNonEmptyString(item.proficiency) ?? (item.level > 0 ? String(item.level) : undefined);
			const keywords = item.keywords.map((keyword) => keyword.trim()).filter(Boolean);

			return {
				name,
				...(level ? { level } : {}),
				...(keywords.length > 0 ? { keywords } : {}),
			};
		})
		.filter((item): item is JSONResumeSkill => Boolean(item));
}

function mapLanguages(resumeData: ResumeData): JSONResumeLanguage[] {
	return getVisibleItems(resumeData.sections.languages)
		.map((item): JSONResumeLanguage | undefined => {
			const language = toNonEmptyString(item.language);
			if (!language) return undefined;

			const fluency = toNonEmptyString(item.fluency);
			return {
				language,
				...(fluency ? { fluency } : {}),
			};
		})
		.filter((item): item is JSONResumeLanguage => Boolean(item));
}

function mapInterests(resumeData: ResumeData): JSONResumeInterest[] {
	return getVisibleItems(resumeData.sections.interests)
		.map((item): JSONResumeInterest | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const keywords = item.keywords.map((keyword) => keyword.trim()).filter(Boolean);
			return {
				name,
				...(keywords.length > 0 ? { keywords } : {}),
			};
		})
		.filter((item): item is JSONResumeInterest => Boolean(item));
}

function mapReferences(resumeData: ResumeData): JSONResumeReference[] {
	return getVisibleItems(resumeData.sections.references)
		.map((item): JSONResumeReference | undefined => {
			const name = toNonEmptyString(item.name);
			const parts = [
				toNonEmptyString(stripHtml(item.description)),
				toNonEmptyString(item.position),
				toNonEmptyString(item.phone),
				sanitizeUrl(item.website.url),
			].filter((part): part is string => Boolean(part));
			const reference = parts.length > 0 ? parts.join(" | ") : undefined;

			if (!name && !reference) return undefined;
			return {
				...(name ? { name } : {}),
				...(reference ? { reference } : {}),
			};
		})
		.filter((item): item is JSONResumeReference => Boolean(item));
}

function mapProjects(resumeData: ResumeData): JSONResumeProject[] {
	return getVisibleItems(resumeData.sections.projects)
		.map((item): JSONResumeProject | undefined => {
			const name = toNonEmptyString(item.name);
			if (!name) return undefined;

			const { startDate, endDate } = parsePeriod(item.period);
			const url = sanitizeUrl(item.website.url);
			const { summary, highlights } = splitDescription(item.description);

			return {
				name,
				...(summary ? { description: summary } : {}),
				...(highlights ? { highlights } : {}),
				...(startDate ? { startDate } : {}),
				...(endDate ? { endDate } : {}),
				...(url ? { url } : {}),
			};
		})
		.filter((item): item is JSONResumeProject => Boolean(item));
}

export class JSONResumeExporter {
	convert(resumeData: ResumeData): JSONResume {
		const basics = mapBasics(resumeData);
		const work = mapWork(resumeData);
		const volunteer = mapVolunteer(resumeData);
		const education = mapEducation(resumeData);
		const awards = mapAwards(resumeData);
		const certificates = mapCertificates(resumeData);
		const publications = mapPublications(resumeData);
		const skills = mapSkills(resumeData);
		const languages = mapLanguages(resumeData);
		const interests = mapInterests(resumeData);
		const references = mapReferences(resumeData);
		const projects = mapProjects(resumeData);
		const canonical = sanitizeUrl(resumeData.basics.website.url);

		const meta = {
			version: "v1.0.0",
			lastModified: new Date().toISOString(),
			...(canonical ? { canonical } : {}),
		};

		return jsonResumeSchema.parse({
			$schema: JSON_RESUME_SCHEMA_URL,
			...(basics ? { basics } : {}),
			...(work.length > 0 ? { work } : {}),
			...(volunteer.length > 0 ? { volunteer } : {}),
			...(education.length > 0 ? { education } : {}),
			...(awards.length > 0 ? { awards } : {}),
			...(certificates.length > 0 ? { certificates } : {}),
			...(publications.length > 0 ? { publications } : {}),
			...(skills.length > 0 ? { skills } : {}),
			...(languages.length > 0 ? { languages } : {}),
			...(interests.length > 0 ? { interests } : {}),
			...(references.length > 0 ? { references } : {}),
			...(projects.length > 0 ? { projects } : {}),
			meta,
		});
	}

	parse(resumeData: ResumeData): string {
		return JSON.stringify(this.convert(resumeData), null, 2);
	}
}

export function runJSONResumeRoundtripSanityCheck(resumeData: ResumeData): ResumeData {
	const exporter = new JSONResumeExporter();
	const importer = new JSONResumeImporter();
	const exported = exporter.convert(resumeData);
	return importer.convert(exported);
}
