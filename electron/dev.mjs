import { spawn } from "node:child_process";

const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";

const electron = spawn(
	NPM_BIN,
	[
		"exec",
		"--yes",
		"--package=electron@35.0.1",
		"electron",
		"electron/main.cjs",
	],
	{
		stdio: "inherit",
		env: process.env,
	},
);

electron.on("exit", (code) => {
const STARTUP_TIMEOUT_MS = 120_000;
const RETRY_INTERVAL_MS = 750;
const DEV_SERVER_URL = process.env.ELECTRON_DEV_SERVER_URL ?? "http://127.0.0.1:3000";
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";

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

const startWebServer = () =>
	spawn(PNPM_BIN, ["dev"], {
		stdio: "inherit",
		env: process.env,
	});

const startElectron = (url) =>
	spawn(
		NPM_BIN,
		[
			"exec",
			"--yes",
			"--package=electron@35.0.1",
			"electron",
			"electron/main.cjs",
		],
		{
			stdio: "inherit",
			env: { ...process.env, ELECTRON_DEV_SERVER_URL: url },
		},
	);

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
