const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

const DEFAULT_LOCAL_APP_URL = "http://127.0.0.1:3000";
const HEALTHCHECK_PATH = "/api/health";
const BACKEND_LOG_LIMIT = 250;

const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const STARTUP_ATTEMPTS = parsePositiveInteger(process.env.ELECTRON_BACKEND_START_ATTEMPTS, 3);
const STARTUP_TIMEOUT_MS = parsePositiveInteger(process.env.ELECTRON_BACKEND_STARTUP_TIMEOUT_MS, 45_000);
const HEALTHCHECK_REQUEST_TIMEOUT_MS = parsePositiveInteger(
	process.env.ELECTRON_BACKEND_HEALTHCHECK_TIMEOUT_MS,
	2_500,
);
const HEALTHCHECK_RETRY_INTERVAL_MS = parsePositiveInteger(
	process.env.ELECTRON_BACKEND_HEALTHCHECK_INTERVAL_MS,
	750,
);
const BACKEND_RETRY_DELAY_MS = parsePositiveInteger(process.env.ELECTRON_BACKEND_RETRY_DELAY_MS, 1_500);
const BACKEND_STOP_TIMEOUT_MS = parsePositiveInteger(process.env.ELECTRON_BACKEND_STOP_TIMEOUT_MS, 5_000);

let mainWindow;
let backendProcess;
let backendUrl = normalizeUrl(process.env.ELECTRON_BACKEND_URL, DEFAULT_LOCAL_APP_URL);
let appUrl = normalizeUrl(process.env.ELECTRON_DEV_SERVER_URL ?? backendUrl, backendUrl);
let isQuitting = false;

const backendLogBuffer = [];

function parsePositiveInteger(value, fallback) {
	if (typeof value !== "string") return fallback;

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

	return parsed;
}

function normalizeUrl(value, fallback) {
	try {
		return new URL(value).toString();
	} catch {
		return fallback;
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}

function formatExitReason(code, signal) {
	if (typeof code === "number") return `code ${code}`;
	if (signal) return `signal ${signal}`;
	return "unknown reason";
}

function escapeHtml(value) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function appendBackendLog(source, value) {
	const text = value.toString();
	if (!text.trim()) return;

	for (const line of text.trimEnd().split(/\r?\n/g)) {
		const entry = `[${source}] ${line}`;
		backendLogBuffer.push(entry);
		if (backendLogBuffer.length > BACKEND_LOG_LIMIT) backendLogBuffer.shift();
	}

	if (source === "stderr") {
		console.error(`[backend] ${text.trimEnd()}`);
		return;
	}

	console.log(`[backend] ${text.trimEnd()}`);
}

function renderBackendErrorPage(errorMessage) {
	const safeError = escapeHtml(errorMessage);
	const safeBackendUrl = escapeHtml(backendUrl);
	const logs = backendLogBuffer.length > 0 ? backendLogBuffer.join("\n") : "No backend logs captured.";
	const safeLogs = escapeHtml(logs);

	return `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Reactive Resume - Backend Error</title>
		<style>
			:root {
				color-scheme: dark;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			}

			body {
				margin: 0;
				padding: 24px;
				background: #141414;
				color: #f0f0f0;
			}

			h1 {
				margin: 0 0 12px;
				font-size: 24px;
			}

			p {
				margin: 0 0 10px;
				line-height: 1.45;
			}

			pre {
				margin-top: 16px;
				padding: 16px;
				border-radius: 8px;
				background: #0a0a0a;
				border: 1px solid #2b2b2b;
				max-height: 360px;
				overflow: auto;
				white-space: pre-wrap;
				word-break: break-word;
			}
		</style>
	</head>
	<body>
		<h1>Backend Failed to Start</h1>
		<p><strong>Target URL:</strong> ${safeBackendUrl}</p>
		<p><strong>Error:</strong> ${safeError}</p>
		<p>Check local dependencies, environment variables, and backend logs below.</p>
		<pre>${safeLogs}</pre>
	</body>
</html>`;
}

async function showBackendError(error) {
	const message = getErrorMessage(error);

	console.error(`[desktop] Backend failure: ${message}`);
	if (backendLogBuffer.length > 0) {
		console.error(`[desktop] Recent backend logs:\n${backendLogBuffer.join("\n")}`);
	}

	if (!mainWindow || mainWindow.isDestroyed()) {
		mainWindow = new BrowserWindow({
			width: 920,
			height: 720,
			minWidth: 720,
			minHeight: 520,
			backgroundColor: "#141414",
			title: "Reactive Resume",
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
			},
		});

		mainWindow.once("ready-to-show", () => {
			mainWindow?.show();
		});
	}

	const html = renderBackendErrorPage(message);
	await mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
}

function buildManagedBackendEnv() {
	const parsedUrl = new URL(backendUrl);
	const defaultPort = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80");

	return {
		...process.env,
		DESKTOP_MODE: "true",
		ELECTRON_MANAGED_BACKEND: "true",
		APP_URL: process.env.APP_URL ?? backendUrl,
		PRINTER_APP_URL: process.env.PRINTER_APP_URL ?? backendUrl,
		PORT: process.env.PORT ?? defaultPort,
	};
}

function spawnBackend() {
	const cwd = app.getAppPath();
	const env = buildManagedBackendEnv();

	if (!app.isPackaged) {
		console.log("[desktop] Starting managed backend with `pnpm dev`.");
		return spawn(PNPM_BIN, ["dev"], {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
	}

	const backendEntryPoint = path.join(cwd, ".output", "server", "index.mjs");
	console.log(`[desktop] Starting managed backend from ${backendEntryPoint}.`);

	return spawn(process.execPath, [backendEntryPoint], {
		cwd,
		env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

async function queryHealthcheck(healthcheckUrl) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(healthcheckUrl, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});

		const text = await response.text();
		let data;

		try {
			data = JSON.parse(text);
		} catch {
			data = undefined;
		}

		return {
			ok: response.ok,
			statusCode: response.status,
			data,
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function waitForBackendHealth(childProcess, state) {
	const healthcheckUrl = new URL(HEALTHCHECK_PATH, backendUrl).toString();
	const startedAt = Date.now();
	let lastReason = `No successful response from ${healthcheckUrl}`;

	while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
		if (state.spawnError) {
			throw new Error(`Backend process failed to spawn: ${getErrorMessage(state.spawnError)}`);
		}

		if (typeof childProcess.exitCode === "number" || childProcess.signalCode) {
			throw new Error(`Backend exited before becoming healthy (${formatExitReason(childProcess.exitCode, childProcess.signalCode)})`);
		}

		try {
			const healthcheck = await queryHealthcheck(healthcheckUrl);
			const status = healthcheck.data?.status;

			if (healthcheck.ok && status !== "unhealthy") {
				console.log(`[desktop] Backend healthcheck passed at ${healthcheckUrl}.`);
				return;
			}

			const healthStatus = typeof status === "string" ? `status=${status}` : `http=${healthcheck.statusCode}`;
			lastReason = `Healthcheck returned ${healthStatus}`;
		} catch (error) {
			lastReason = getErrorMessage(error);
		}

		await sleep(HEALTHCHECK_RETRY_INTERVAL_MS);
	}

	throw new Error(
		`Timed out waiting for backend healthcheck after ${STARTUP_TIMEOUT_MS}ms. Last result: ${lastReason}`,
	);
}

async function stopManagedBackend() {
	const childProcess = backendProcess;
	if (!childProcess) return;

	backendProcess = undefined;
	if (typeof childProcess.exitCode === "number" || childProcess.signalCode) return;

	const exited = new Promise((resolve) => {
		childProcess.once("exit", resolve);
	});

	try {
		childProcess.kill("SIGTERM");
	} catch (error) {
		console.error(`[desktop] Failed to send SIGTERM to backend: ${getErrorMessage(error)}`);
		return;
	}

	const didTimeout = await Promise.race([
		exited.then(() => false),
		sleep(BACKEND_STOP_TIMEOUT_MS).then(() => true),
	]);

	if (!didTimeout || typeof childProcess.exitCode === "number" || childProcess.signalCode) return;

	console.warn("[desktop] Backend did not exit after SIGTERM, sending SIGKILL.");

	try {
		childProcess.kill("SIGKILL");
	} catch (error) {
		console.error(`[desktop] Failed to send SIGKILL to backend: ${getErrorMessage(error)}`);
	}
}

async function startManagedBackend() {
	if (process.env.ELECTRON_DEV_SERVER_URL) {
		console.log(`[desktop] Using external app URL (${appUrl}); managed backend disabled.`);
		return;
	}

	let lastError;

	for (let attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt += 1) {
		console.log(`[desktop] Starting backend (attempt ${attempt}/${STARTUP_ATTEMPTS})...`);

		const state = { spawnError: undefined };
		const childProcess = spawnBackend();
		backendProcess = childProcess;

		childProcess.stdout?.on("data", (chunk) => appendBackendLog("stdout", chunk));
		childProcess.stderr?.on("data", (chunk) => appendBackendLog("stderr", chunk));
		childProcess.on("error", (error) => {
			state.spawnError = error;
			appendBackendLog("spawn-error", getErrorMessage(error));
		});

		try {
			await waitForBackendHealth(childProcess, state);

			childProcess.on("exit", (code, signal) => {
				if (backendProcess === childProcess) {
					backendProcess = undefined;
				}

				if (isQuitting) return;

				const reason = formatExitReason(code, signal);
				void showBackendError(new Error(`Backend process exited unexpectedly (${reason}).`));
			});

			return;
		} catch (error) {
			lastError = error;
			console.error(`[desktop] Backend startup attempt ${attempt} failed: ${getErrorMessage(error)}`);
			await stopManagedBackend();

			if (attempt < STARTUP_ATTEMPTS) {
				await sleep(BACKEND_RETRY_DELAY_MS);
			}
		}
	}

	throw new Error(
		`Failed to start backend after ${STARTUP_ATTEMPTS} attempts: ${getErrorMessage(lastError)}`,
	);
}

async function createWindow() {
	mainWindow = new BrowserWindow({
const { app, BrowserWindow } = require("electron");

const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:3000";

const createWindow = async () => {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1100,
		minHeight: 700,
		backgroundColor: "#111111",
		show: false,
		title: "Reactive Resume",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	mainWindow.once("ready-to-show", () => {
		mainWindow?.show();
	});

	mainWindow.on("closed", () => {
		mainWindow = undefined;
	});

	await mainWindow.loadURL(appUrl);
}

app.whenReady()
	.then(async () => {
		backendUrl = normalizeUrl(process.env.ELECTRON_BACKEND_URL, DEFAULT_LOCAL_APP_URL);
		appUrl = normalizeUrl(process.env.ELECTRON_DEV_SERVER_URL ?? backendUrl, backendUrl);

		try {
			await startManagedBackend();
			await createWindow();
		} catch (error) {
			await showBackendError(error);
		}

		app.on("activate", async () => {
			if (BrowserWindow.getAllWindows().length > 0) return;

			try {
				if (!process.env.ELECTRON_DEV_SERVER_URL && !backendProcess) {
					await startManagedBackend();
				}

				await createWindow();
			} catch (error) {
				await showBackendError(error);
			}
		});
	})
	.catch((error) => {
		console.error(`[desktop] Failed during Electron startup: ${getErrorMessage(error)}`);
		app.quit();
	});

app.on("before-quit", () => {
	isQuitting = true;
	void stopManagedBackend();
	window.once("ready-to-show", () => {
		window.show();
	});

	const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL ?? DEFAULT_DEV_SERVER_URL;

	if (!app.isPackaged || process.env.ELECTRON_DEV_SERVER_URL) {
		await window.loadURL(devServerUrl);
		return;
	}

	const packagedIndexHtmlPath = path.join(app.getAppPath(), ".output", "public", "index.html");
	await window.loadFile(packagedIndexHtmlPath);
};

app.whenReady().then(async () => {
	await createWindow();

	app.on("activate", async () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			await createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
