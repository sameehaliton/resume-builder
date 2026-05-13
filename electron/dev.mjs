import { spawn } from "node:child_process";

const STARTUP_TIMEOUT_MS = 120_000;
const RETRY_INTERVAL_MS = 750;
const DEV_SERVER_URL = process.env.ELECTRON_DEV_SERVER_URL ?? "http://127.0.0.1:3000";
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";

// Desktop dev is local-first and does not require an external Postgres / printer / SMTP /
// OAuth setup. We provide safe defaults so `pnpm desktop:dev` works on a fresh clone with
// no `.env` file. User-set values in `.env` or the shell environment still take priority.
const desktopDevEnvDefaults = {
	DESKTOP_MODE: "true",
	APP_URL: DEV_SERVER_URL,
	PRINTER_APP_URL: DEV_SERVER_URL,
	// PRINTER_ENDPOINT is required by env validation but unused in desktop mode (local Chrome is used instead).
	PRINTER_ENDPOINT: "ws://127.0.0.1:4000?token=desktop",
	DATABASE_URL: "file:./reactive-resume.sqlite",
	AUTH_SECRET: "reactive-resume-desktop-dev-secret",
};

const buildDevEnv = () => {
	const env = { ...process.env };
	for (const [key, value] of Object.entries(desktopDevEnvDefaults)) {
		if (!env[key] || env[key].trim() === "") env[key] = value;
	}
	return env;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDevServer = async (url) => {
	const startedAt = Date.now();

	while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.ok) return;
		} catch {}

		await sleep(RETRY_INTERVAL_MS);
	}

	throw new Error(`Timed out waiting for dev server at ${url}`);
};

const devEnv = buildDevEnv();

const startWebServer = () =>
	spawn(PNPM_BIN, ["dev"], {
		stdio: "inherit",
		env: devEnv,
	});

const startElectron = (url) =>
	spawn(NPM_BIN, ["exec", "--yes", "--package=electron@35.0.1", "electron", "electron/main.cjs"], {
		stdio: "inherit",
		env: { ...devEnv, ELECTRON_DEV_SERVER_URL: url },
	});

const shutdown = (children) => {
	for (const child of children) {
		if (!child.killed) child.kill("SIGTERM");
	}
};

const children = [];

process.on("SIGINT", () => shutdown(children));
process.on("SIGTERM", () => shutdown(children));

const webServer = startWebServer();
children.push(webServer);

webServer.on("exit", (code) => {
	if (code !== null && code !== 0) {
		process.exit(code ?? 1);
	}
});

await waitForDevServer(DEV_SERVER_URL);

const electron = startElectron(DEV_SERVER_URL);
children.push(electron);

electron.on("exit", (code) => {
	shutdown(children);
	process.exit(code ?? 0);
});
