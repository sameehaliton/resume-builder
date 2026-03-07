import type z from "zod";
import type {
	jsonResumeAwardSchema,
	jsonResumeBasicsSchema,
	jsonResumeCertificateSchema,
	jsonResumeEducationSchema,
	jsonResumeInterestSchema,
	jsonResumeLanguageSchema,
	jsonResumeLocationSchema,
	jsonResumeMetaSchema,
	jsonResumeProfileSchema,
	jsonResumeProjectSchema,
	jsonResumePublicationSchema,
	jsonResumeReferenceSchema,
	jsonResumeSchema,
	jsonResumeSkillSchema,
	jsonResumeVolunteerSchema,
	jsonResumeWorkSchema,
} from "@/schema/json-resume";

export type JSONResume = z.infer<typeof jsonResumeSchema>;
export type JSONResumeBasics = z.infer<typeof jsonResumeBasicsSchema>;
export type JSONResumeLocation = z.infer<typeof jsonResumeLocationSchema>;
export type JSONResumeProfile = z.infer<typeof jsonResumeProfileSchema>;
export type JSONResumeWork = z.infer<typeof jsonResumeWorkSchema>;
export type JSONResumeVolunteer = z.infer<typeof jsonResumeVolunteerSchema>;
export type JSONResumeEducation = z.infer<typeof jsonResumeEducationSchema>;
export type JSONResumeAward = z.infer<typeof jsonResumeAwardSchema>;
export type JSONResumeCertificate = z.infer<typeof jsonResumeCertificateSchema>;
export type JSONResumePublication = z.infer<typeof jsonResumePublicationSchema>;
export type JSONResumeSkill = z.infer<typeof jsonResumeSkillSchema>;
export type JSONResumeLanguage = z.infer<typeof jsonResumeLanguageSchema>;
export type JSONResumeInterest = z.infer<typeof jsonResumeInterestSchema>;
export type JSONResumeReference = z.infer<typeof jsonResumeReferenceSchema>;
export type JSONResumeProject = z.infer<typeof jsonResumeProjectSchema>;
export type JSONResumeMeta = z.infer<typeof jsonResumeMetaSchema>;
