import { apiKeyClient } from "@better-auth/api-key/client";
import { genericOAuthClient, inferAdditionalFields, twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { createDesktopLocalSession, isDesktopMode } from "./local-session";
import type { auth } from "./config";

const getAuthClient = () => {
	return createAuthClient({
		plugins: [
			apiKeyClient(),
			usernameClient(),
			twoFactorClient({
				onTwoFactorRedirect() {
					// Redirect to 2FA verification page
					if (typeof window !== "undefined") {
						window.location.href = "/auth/verify-2fa";
					}
				},
			}),
			genericOAuthClient(),
			inferAdditionalFields<typeof auth>(),
		],
	});
};

const baseAuthClient = getAuthClient();

export const authClient = {
	...baseAuthClient,
	getSession: async (...args: Parameters<typeof baseAuthClient.getSession>) => {
		const result = await baseAuthClient.getSession(...args);
		if (!isDesktopMode() || result.data) return result;

		return {
			...result,
			data: createDesktopLocalSession(),
			error: null,
		};
	},
	useSession: (...args: Parameters<typeof baseAuthClient.useSession>) => {
		const result = baseAuthClient.useSession(...args);
		if (!isDesktopMode() || result.data) return result;

		return {
			...result,
			data: createDesktopLocalSession(),
			error: null,
		};
	},
} as typeof baseAuthClient;
