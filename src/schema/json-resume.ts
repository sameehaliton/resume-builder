import z from "zod";

// ISO 8601 date pattern supporting YYYY, YYYY-MM, or YYYY-MM-DD.
export const jsonResumeIso8601DateSchema = z
	.string()
	.regex(
		/^([1-2][0-9]{3}-[0-1][0-9]-[0-3][0-9]|[1-2][0-9]{3}-[0-1][0-9]|[1-2][0-9]{3})$/,
		"Must be a valid ISO 8601 date (YYYY, YYYY-MM, or YYYY-MM-DD)",
	);

export const jsonResumeLocationSchema = z.looseObject({
	address: z.string().optional(),
	postalCode: z.string().optional(),
	city: z.string().optional(),
	countryCode: z.string().optional(),
	region: z.string().optional(),
});

export const jsonResumeProfileSchema = z.looseObject({
	network: z.string().optional(),
	username: z.string().optional(),
	url: z.url().optional(),
});

export const jsonResumeBasicsSchema = z.looseObject({
	name: z.string().optional(),
	label: z.string().optional(),
	image: z.string().optional(),
	email: z.email().optional(),
	phone: z.string().optional(),
	url: z.url().optional(),
	summary: z.string().optional(),
	location: jsonResumeLocationSchema.optional(),
	profiles: z.array(jsonResumeProfileSchema).optional(),
});

export const jsonResumeWorkSchema = z.looseObject({
	name: z.string().optional(),
	location: z.string().optional(),
	description: z.string().optional(),
	position: z.string().optional(),
	url: z.url().optional(),
	startDate: jsonResumeIso8601DateSchema.optional(),
	endDate: jsonResumeIso8601DateSchema.optional(),
	summary: z.string().optional(),
	highlights: z.array(z.string()).optional(),
});

export const jsonResumeVolunteerSchema = z.looseObject({
	organization: z.string().optional(),
	position: z.string().optional(),
	url: z.url().optional(),
	startDate: jsonResumeIso8601DateSchema.optional(),
	endDate: jsonResumeIso8601DateSchema.optional(),
	summary: z.string().optional(),
	highlights: z.array(z.string()).optional(),
});

export const jsonResumeEducationSchema = z.looseObject({
	institution: z.string().optional(),
	url: z.url().optional(),
	area: z.string().optional(),
	studyType: z.string().optional(),
	startDate: jsonResumeIso8601DateSchema.optional(),
	endDate: jsonResumeIso8601DateSchema.optional(),
	score: z.string().optional(),
	courses: z.array(z.string()).optional(),
});

export const jsonResumeAwardSchema = z.looseObject({
	title: z.string().optional(),
	date: jsonResumeIso8601DateSchema.optional(),
	awarder: z.string().optional(),
	summary: z.string().optional(),
});

export const jsonResumeCertificateSchema = z.looseObject({
	name: z.string().optional(),
	date: jsonResumeIso8601DateSchema.optional(),
	url: z.url().optional(),
	issuer: z.string().optional(),
});

export const jsonResumePublicationSchema = z.looseObject({
	name: z.string().optional(),
	publisher: z.string().optional(),
	releaseDate: jsonResumeIso8601DateSchema.optional(),
	url: z.url().optional(),
	summary: z.string().optional(),
});

export const jsonResumeSkillSchema = z.looseObject({
	name: z.string().optional(),
	level: z.string().optional(),
	keywords: z.array(z.string()).optional(),
});

export const jsonResumeLanguageSchema = z.looseObject({
	language: z.string().optional(),
	fluency: z.string().optional(),
});

export const jsonResumeInterestSchema = z.looseObject({
	name: z.string().optional(),
	keywords: z.array(z.string()).optional(),
});

export const jsonResumeReferenceSchema = z.looseObject({
	name: z.string().optional(),
	reference: z.string().optional(),
});

export const jsonResumeProjectSchema = z.looseObject({
	name: z.string().optional(),
	description: z.string().optional(),
	highlights: z.array(z.string()).optional(),
	keywords: z.array(z.string()).optional(),
	startDate: jsonResumeIso8601DateSchema.optional(),
	endDate: jsonResumeIso8601DateSchema.optional(),
	url: z.url().optional(),
	roles: z.array(z.string()).optional(),
	entity: z.string().optional(),
	type: z.string().optional(),
});

export const jsonResumeMetaSchema = z.looseObject({
	canonical: z.url().optional(),
	version: z.string().optional(),
	lastModified: z.string().optional(),
});

export const jsonResumeSchema = z.looseObject({
	$schema: z.url().optional(),
	basics: jsonResumeBasicsSchema.optional(),
	work: z.array(jsonResumeWorkSchema).optional(),
	volunteer: z.array(jsonResumeVolunteerSchema).optional(),
	education: z.array(jsonResumeEducationSchema).optional(),
	awards: z.array(jsonResumeAwardSchema).optional(),
	certificates: z.array(jsonResumeCertificateSchema).optional(),
	publications: z.array(jsonResumePublicationSchema).optional(),
	skills: z.array(jsonResumeSkillSchema).optional(),
	languages: z.array(jsonResumeLanguageSchema).optional(),
	interests: z.array(jsonResumeInterestSchema).optional(),
	references: z.array(jsonResumeReferenceSchema).optional(),
	projects: z.array(jsonResumeProjectSchema).optional(),
	meta: jsonResumeMetaSchema.optional(),
});
