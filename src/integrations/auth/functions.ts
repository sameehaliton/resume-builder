import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { authClient } from "./client";
import { auth } from "./config";
import { resolveDesktopSession } from "./local-session";
import type { AuthSession } from "./types";

export const getSession = createIsomorphicFn()
	.client(async (): Promise<AuthSession | null> => {
		const { data, error } = await authClient.getSession();
		if (error) return resolveDesktopSession(null);
		return resolveDesktopSession(data as AuthSession | null);
	})
	.server(async (): Promise<AuthSession | null> => {
		try {
			const result = await auth.api.getSession({ headers: getRequestHeaders() });
			return resolveDesktopSession(result as AuthSession | null);
		} catch {
			return resolveDesktopSession(null);
		}
	});
