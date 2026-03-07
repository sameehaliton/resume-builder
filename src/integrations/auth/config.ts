import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { BetterAuthError, betterAuth } from "better-auth";
import { type GenericOAuthConfig, genericOAuth, openAPI, twoFactor } from "better-auth/plugins";
import { username } from "better-auth/plugins/username";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/integrations/drizzle/client";
import { env } from "@/utils/env";
import { hashPassword, verifyPassword } from "@/utils/password";
import { generateId, toUsername } from "@/utils/string";
import {
	createDesktopLocalSession,
	DESKTOP_LOCAL_USER_EMAIL,
	DESKTOP_LOCAL_USER_ID,
	DESKTOP_LOCAL_USER_NAME,
	DESKTOP_LOCAL_USERNAME,
	isDesktopMode,
} from "./local-session";
import { schema } from "../drizzle";
import { sendEmail } from "../email/service";

function isCustomOAuthProviderEnabled() {
	const hasDiscovery = Boolean(env.OAUTH_DISCOVERY_URL);
	const hasManual =
		Boolean(env.OAUTH_AUTHORIZATION_URL) && Boolean(env.OAUTH_TOKEN_URL) && Boolean(env.OAUTH_USER_INFO_URL);

	return Boolean(env.OAUTH_CLIENT_ID) && Boolean(env.OAUTH_CLIENT_SECRET) && (hasDiscovery || hasManual);
}

function getTrustedOrigins(): string[] {
	const appUrl = new URL(env.APP_URL);
	const trustedOrigins = new Set<string>([appUrl.origin.replace(/\/$/, "")]);
	const LOCAL_ORIGINS = ["localhost", "127.0.0.1"];

	if (LOCAL_ORIGINS.includes(appUrl.hostname)) {
		for (const hostname of LOCAL_ORIGINS) {
			if (hostname !== appUrl.hostname) {
				const altUrl = new URL(env.APP_URL);
				altUrl.hostname = hostname;
				trustedOrigins.add(altUrl.origin.replace(/\/$/, ""));
			}
		}
	}

	return Array.from(trustedOrigins);
}

async function ensureDesktopLocalUser() {
	const [existingUser] = await db.select().from(schema.user).where(eq(schema.user.id, DESKTOP_LOCAL_USER_ID)).limit(1);
	if (existingUser) return existingUser;

	await db
		.insert(schema.user)
		.values({
			id: DESKTOP_LOCAL_USER_ID,
			name: DESKTOP_LOCAL_USER_NAME,
			email: DESKTOP_LOCAL_USER_EMAIL,
			username: DESKTOP_LOCAL_USERNAME,
			displayUsername: DESKTOP_LOCAL_USERNAME,
			emailVerified: true,
			twoFactorEnabled: false,
		})
		.onConflictDoNothing({ target: schema.user.id });

	const [createdUser] = await db.select().from(schema.user).where(eq(schema.user.id, DESKTOP_LOCAL_USER_ID)).limit(1);
	if (!createdUser) throw new BetterAuthError("Unable to initialize the desktop local session user.");

	return createdUser;
}

async function getDesktopLocalSession() {
	const user = await ensureDesktopLocalUser();

	return createDesktopLocalSession({
		id: user.id,
		name: user.name,
		email: user.email,
		image: user.image,
		emailVerified: user.emailVerified,
		username: user.username,
		displayUsername: user.displayUsername,
		twoFactorEnabled: user.twoFactorEnabled,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
	});
}

const getAuthConfig = () => {
	const authConfigs: GenericOAuthConfig[] = [];

	if (isCustomOAuthProviderEnabled()) {
		authConfigs.push({
			providerId: "custom",
			disableSignUp: env.FLAG_DISABLE_SIGNUPS,
			clientId: env.OAUTH_CLIENT_ID as string,
			clientSecret: env.OAUTH_CLIENT_SECRET as string,
			discoveryUrl: env.OAUTH_DISCOVERY_URL,
			authorizationUrl: env.OAUTH_AUTHORIZATION_URL,
			tokenUrl: env.OAUTH_TOKEN_URL,
			userInfoUrl: env.OAUTH_USER_INFO_URL,
			scopes: env.OAUTH_SCOPES,
			redirectURI: `${env.APP_URL}/api/auth/oauth2/callback/custom`,
			mapProfileToUser: async (profile) => {
				if (!profile.email) {
					throw new BetterAuthError(
						"OAuth Provider did not return an email address. This is required for user creation.",
						{ cause: "EMAIL_REQUIRED" },
					);
				}

				const email = profile.email;
				const name = profile.name ?? profile.preferred_username ?? email.split("@")[0];
				const username = profile.preferred_username ?? email.split("@")[0];
				const image = profile.image ?? profile.picture ?? profile.avatar_url;

				return {
					name,
					email,
					image,
					username,
					displayUsername: username,
					emailVerified: true,
				};
			},
		} satisfies GenericOAuthConfig);
	}

	return betterAuth({
		appName: "Reactive Resume",

		baseURL: env.APP_URL,
		secret: env.AUTH_SECRET,

		database: drizzleAdapter(db, { schema, provider: "pg" }),

		telemetry: { enabled: false },
		trustedOrigins: getTrustedOrigins(),
		advanced: {
			database: { generateId },
			useSecureCookies: env.APP_URL.startsWith("https://"),
		},

		emailAndPassword: {
			enabled: !env.FLAG_DISABLE_EMAIL_AUTH,
			autoSignIn: true,
			minPasswordLength: 6,
			maxPasswordLength: 64,
			requireEmailVerification: false,
			disableSignUp: env.FLAG_DISABLE_SIGNUPS || env.FLAG_DISABLE_EMAIL_AUTH,
			sendResetPassword: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Reset your password",
					text: `You requested a password reset for your Reactive Resume account.\n\nTo reset your password, please visit the following URL:\n${url}.\n\nIf you did not request a password reset, please ignore this email.`,
				});
			},
			password: {
				hash: (password) => hashPassword(password),
				verify: ({ password, hash }) => verifyPassword(password, hash),
			},
		},

		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Verify your email",
					text: `You recently signed up for an account on Reactive Resume.\n\nTo verify your email, please visit the following URL:\n${url}`,
				});
			},
		},

		user: {
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					await sendEmail({
						to: newEmail,
						subject: "Verify your new email",
						text: `You recently requested to change your email on Reactive Resume from ${user.email} to ${newEmail}.\n\nTo verify this change, please visit the following URL:\n${url}\n\nIf you did not request this change, please ignore this email.`,
					});
				},
			},
			additionalFields: {
				username: {
					type: "string",
					required: true,
				},
			},
		},

		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google", "github"],
			},
		},

		socialProviders: {
			google: {
				enabled: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				// biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are not null
				clientId: env.GOOGLE_CLIENT_ID!,
				// biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are not null
				clientSecret: env.GOOGLE_CLIENT_SECRET!,
				mapProfileToUser: async (profile) => {
					const name = profile.name ?? profile.email.split("@")[0];

					return {
						name,
						email: profile.email,
						image: profile.picture,
						username: profile.email.split("@")[0],
						displayUsername: profile.email.split("@")[0],
						emailVerified: true,
					};
				},
			},

			github: {
				enabled: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				// biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are not null
				clientId: env.GITHUB_CLIENT_ID!,
				// biome-ignore lint/style/noNonNullAssertion: enabled check ensures these are not null
				clientSecret: env.GITHUB_CLIENT_SECRET!,
				mapProfileToUser: async (profile) => {
					const name = profile.name ?? profile.login ?? String(profile.id);
					const login = profile.login ?? String(profile.id);
					const normalizedLogin = toUsername(login);

					const [legacyAccount] = await db
						.select({
							accountId: schema.account.accountId,
							email: schema.user.email,
							emailVerified: schema.user.emailVerified,
							username: schema.user.username,
							displayUsername: schema.user.displayUsername,
						})
						.from(schema.account)
						.innerJoin(schema.user, eq(schema.account.userId, schema.user.id))
						.where(
							and(
								eq(schema.account.providerId, "github"),
								or(eq(schema.user.username, normalizedLogin), eq(schema.user.displayUsername, login)),
							),
						)
						.limit(1);

					if (legacyAccount) {
						return {
							id: legacyAccount.accountId,
							name,
							email: legacyAccount.email,
							image: profile.avatar_url,
							username: legacyAccount.username,
							displayUsername: legacyAccount.displayUsername,
							emailVerified: legacyAccount.emailVerified,
						};
					}

					return {
						name,
						email: profile.email,
						image: profile.avatar_url,
						username: normalizedLogin,
						displayUsername: login,
						emailVerified: true,
					};
				},
			},
		},

		plugins: [
			openAPI(),
			apiKey({
				enableSessionForAPIKeys: true,
				rateLimit: {
					enabled: true,
					timeWindow: 1000 * 60 * 60 * 24, // 1 day
					maxRequests: 500, // 500 requests per day
				},
			}),
			username({
				minUsernameLength: 3,
				maxUsernameLength: 64,
				usernameNormalization: (value) => toUsername(value),
				displayUsernameNormalization: (value) => toUsername(value),
				usernameValidator: (username) => /^[a-z0-9._-]+$/.test(username),
				validationOrder: { username: "post-normalization", displayUsername: "post-normalization" },
			}),
			twoFactor({ issuer: "Reactive Resume" }),
			genericOAuth({ config: authConfigs }),
		],
	});
};

const authConfig = getAuthConfig();

if (isDesktopMode()) {
	const originalGetSession = authConfig.api.getSession.bind(authConfig.api);

	const desktopAwareGetSession = async (...args: Parameters<typeof originalGetSession>) => {
		try {
			const result = await originalGetSession(...args);
			if (result?.user) return result;
		} catch {}

		return (await getDesktopLocalSession()) as Awaited<ReturnType<typeof originalGetSession>>;
	};

	(authConfig.api as { getSession: typeof authConfig.api.getSession }).getSession =
		desktopAwareGetSession as typeof authConfig.api.getSession;
}

export const auth = authConfig;
