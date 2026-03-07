import type { AuthSession } from "./types";

const DESKTOP_SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 365 * 10;

export const DESKTOP_LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DESKTOP_LOCAL_USER_NAME = "Desktop User";
export const DESKTOP_LOCAL_USER_EMAIL = "desktop-local-session-0001@local.rxresu.me";
export const DESKTOP_LOCAL_USERNAME = "desktop-local-session-0001";

const DESKTOP_LOCAL_SESSION_ID = "00000000-0000-4000-8000-000000000002";
const DESKTOP_LOCAL_SESSION_TOKEN = "desktop-local-session-token";

type DesktopWindow = Window & {
	desktop?: {
		isDesktop?: boolean;
	};
};

export function isDesktopMode() {
	if (typeof window !== "undefined") {
		const desktopWindow = window as DesktopWindow;
		return Boolean(desktopWindow.desktop?.isDesktop) || /Electron/i.test(window.navigator.userAgent);
	}

	return process.env.DESKTOP_MODE === "true";
}

export function createDesktopLocalSession(overrides: Partial<AuthSession["user"]> = {}): AuthSession {
	const now = new Date();

	const user = {
		id: DESKTOP_LOCAL_USER_ID,
		name: DESKTOP_LOCAL_USER_NAME,
		email: DESKTOP_LOCAL_USER_EMAIL,
		image: null,
		emailVerified: true,
		username: DESKTOP_LOCAL_USERNAME,
		displayUsername: DESKTOP_LOCAL_USERNAME,
		twoFactorEnabled: false,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};

	return {
		session: {
			id: DESKTOP_LOCAL_SESSION_ID,
			token: DESKTOP_LOCAL_SESSION_TOKEN,
			userId: user.id,
			ipAddress: "127.0.0.1",
			userAgent: "desktop-local-session",
			expiresAt: new Date(now.getTime() + DESKTOP_SESSION_LIFETIME_MS),
			createdAt: now,
			updatedAt: now,
		},
		user,
	} as AuthSession;
}

export function resolveDesktopSession(session: AuthSession | null): AuthSession | null {
	if (session) return session;
	if (!isDesktopMode()) return null;
	return createDesktopLocalSession();
}
