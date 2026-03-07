import { defineConfig } from "drizzle-kit";

const resolveMigrationUrl = () => {
	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) return "./reactive-resume.sqlite";
	if (databaseUrl.startsWith("file:")) return databaseUrl;
	if (databaseUrl.startsWith("sqlite:")) return databaseUrl;
	if (databaseUrl.startsWith("/") || databaseUrl.startsWith("./")) return databaseUrl;

	return "./reactive-resume.sqlite";
};

export default defineConfig({
	out: "./migrations",
	dialect: "sqlite",
	schema: "./src/integrations/drizzle/schema.ts",
	dbCredentials: {
		url: resolveMigrationUrl(),
	},
});
