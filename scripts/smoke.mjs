#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

const PREFIX = "[smoke]";
const STARTUP_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 45_000;
const LOG_BUFFER_LIMIT = 120;

function log(message) {
	console.log(`${PREFIX} ${message}`);
}

function toErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function parseEnvFile(filepath) {
	if (!filepath || !existsSync(filepath)) return {};

	const output = {};
	const source = readFileSync(filepath, "utf8");
	const lines = source.split(/\r?\n/u);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const separator = trimmed.indexOf("=");
		if (separator === -1) continue;

		const key = trimmed.slice(0, separator).trim();
		let value = trimmed.slice(separator + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		if (key) output[key] = value;
	}

	return output;
}

function resolveBaseEnv() {
	const envFromDotEnv = parseEnvFile(".env");
	const envFromExample = parseEnvFile(".env.example");

	const env = {
		...envFromExample,
		...envFromDotEnv,
		...process.env,
	};

	const appUrl = process.env.SMOKE_APP_URL ?? env.APP_URL ?? "http://127.0.0.1:3000";
	const parsedAppUrl = new URL(appUrl);

	return {
		APP_URL: parsedAppUrl.origin,
		PRINTER_APP_URL: env.PRINTER_APP_URL ?? parsedAppUrl.origin,
		PRINTER_ENDPOINT: env.PRINTER_ENDPOINT ?? "ws://127.0.0.1:4000?token=1234567890",
		DATABASE_URL: env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres",
		AUTH_SECRET: env.AUTH_SECRET ?? "reactive-resume-smoke-secret",
		DESKTOP_MODE: process.env.DESKTOP_MODE ?? "true",
	};
}

function buildRequestError(method, path, response, payload) {
	const detail =
		typeof payload === "string" ? payload : payload?.message ?? payload?.error?.message ?? JSON.stringify(payload);
	return new Error(`${method} ${path} failed with ${response.status} ${response.statusText}: ${detail}`);
}

async function readJsonResponse(response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function requestJson(baseUrl, path, options = {}) {
	const method = options.method ?? "GET";
	const headers = new Headers(options.headers ?? {});
	headers.set("accept", "application/json");

	let body;
	if (options.json !== undefined) {
		headers.set("content-type", "application/json");
		body = JSON.stringify(options.json);
	}

	const response = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	const payload = await readJsonResponse(response);
	if (!response.ok) {
		throw buildRequestError(method, path, response, payload);
	}

	return payload;
}

async function waitForServer(baseUrl) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	const readyPath = "/api/openapi/spec.json";

	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${baseUrl}${readyPath}`, {
				signal: AbortSignal.timeout(5_000),
				headers: { accept: "application/json" },
			});

			if (response.ok) return;
		} catch {}

		await wait(1_000);
	}

	throw new Error(`Timed out waiting for ${baseUrl}${readyPath}`);
}

async function runSmokeSuite(openapiBaseUrl) {
	const createdResumeIds = [];
	const artifactsDir = join(process.cwd(), "tests", ".artifacts");
	await mkdir(artifactsDir, { recursive: true });

	try {
		log("Creating resume");
		const createdResumeId = await requestJson(openapiBaseUrl, "/resumes", {
			method: "POST",
			json: {
				name: `Desktop Smoke ${Date.now()}`,
				slug: `desktop-smoke-${Date.now()}`,
				tags: ["desktop-smoke"],
				withSampleData: true,
			},
		});

		if (typeof createdResumeId !== "string" || createdResumeId.length === 0) {
			throw new Error("Create resume did not return a valid ID.");
		}

		createdResumeIds.push(createdResumeId);

		log("Editing resume with JSON Patch");
		const editedName = `Smoke User ${Date.now()}`;
		await requestJson(openapiBaseUrl, `/resumes/${createdResumeId}`, {
			method: "PATCH",
			json: {
				id: createdResumeId,
				operations: [{ op: "replace", path: "/basics/name", value: editedName }],
			},
		});

		const editedResume = await requestJson(openapiBaseUrl, `/resumes/${createdResumeId}`);
		if (editedResume?.data?.basics?.name !== editedName) {
			throw new Error("Edited resume did not persist patched basics.name.");
		}

		log("Exporting resume JSON");
		const exportArtifactPath = join(artifactsDir, `resume-export-${createdResumeId}.json`);
		await writeFile(exportArtifactPath, JSON.stringify(editedResume.data, null, 2), "utf8");

		log("Importing exported resume JSON");
		const importedResumeId = await requestJson(openapiBaseUrl, "/resumes/import", {
			method: "POST",
			json: { data: editedResume.data },
		});

		if (typeof importedResumeId !== "string" || importedResumeId.length === 0) {
			throw new Error("Import resume did not return a valid ID.");
		}

		createdResumeIds.push(importedResumeId);

		log("Exporting resume PDF");
		const pdfResponse = await fetch(`${openapiBaseUrl}/resumes/${importedResumeId}/pdf`, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		const pdfPayload = await readJsonResponse(pdfResponse);

		if (!pdfResponse.ok) {
			const responseText = typeof pdfPayload === "string" ? pdfPayload : JSON.stringify(pdfPayload);
			const isMissingRuntime = pdfResponse.status === 503 && responseText.includes("local Chrome/Chromium runtime");

			if (!isMissingRuntime) {
				throw buildRequestError("GET", `/resumes/${importedResumeId}/pdf`, pdfResponse, pdfPayload);
			}

			log("PDF endpoint returned the expected graceful runtime-missing error");
			return;
		}

		if (!pdfPayload || typeof pdfPayload.url !== "string" || pdfPayload.url.length === 0) {
			throw new Error("PDF export succeeded but did not return a URL.");
		}

		const downloadedPdf = await fetch(pdfPayload.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!downloadedPdf.ok) {
			throw new Error(`Failed to download generated PDF: ${downloadedPdf.status} ${downloadedPdf.statusText}`);
		}

		const pdfBytes = new Uint8Array(await downloadedPdf.arrayBuffer());
		if (pdfBytes.byteLength === 0) {
			throw new Error("Generated PDF is empty.");
		}

		const pdfArtifactPath = join(artifactsDir, `resume-export-${importedResumeId}.pdf`);
		await writeFile(pdfArtifactPath, pdfBytes);

		log("PDF export verified");
	} finally {
		for (const id of createdResumeIds.reverse()) {
			try {
				await requestJson(openapiBaseUrl, `/resumes/${id}`, { method: "DELETE" });
			} catch (error) {
				log(`Cleanup warning for resume ${id}: ${toErrorMessage(error)}`);
			}
		}
	}
}

async function main() {
	const useExistingServer = process.env.SMOKE_USE_EXISTING_SERVER === "true";
	const baseEnv = resolveBaseEnv();
	const appUrl = new URL(baseEnv.APP_URL);
	const openapiBaseUrl = `${appUrl.origin}/api/openapi`;

	/** @type {import("node:child_process").ChildProcess | null} */
	let serverProcess = null;
	const serverLogs = [];

	if (!useExistingServer) {
		log(`Starting dev server at ${appUrl.origin}`);
		serverProcess = spawn("pnpm", ["dev", "--", "--host", appUrl.hostname, "--port", appUrl.port || "3000"], {
			cwd: process.cwd(),
			env: { ...process.env, ...baseEnv },
			stdio: ["ignore", "pipe", "pipe"],
		});

		const capture = (chunk) => {
			const text = chunk.toString();
			const lines = text.split(/\r?\n/u).filter(Boolean);
			for (const line of lines) {
				serverLogs.push(line);
				if (serverLogs.length > LOG_BUFFER_LIMIT) serverLogs.shift();
			}

			if (process.env.SMOKE_VERBOSE === "true") {
				process.stdout.write(chunk);
			}
		};

		serverProcess.stdout?.on("data", capture);
		serverProcess.stderr?.on("data", capture);

		try {
			await waitForServer(appUrl.origin);
		} catch (error) {
			const tail = serverLogs.slice(-20).join("\n");
			throw new Error(`Could not start dev server: ${toErrorMessage(error)}\n${tail}`);
		}
	} else {
		log(`Using existing server at ${appUrl.origin}`);
		await waitForServer(appUrl.origin);
	}

	try {
		log("Running desktop MVP smoke checks: create/edit/import/export/pdf");
		await runSmokeSuite(openapiBaseUrl);
		log("Smoke suite passed");
	} finally {
		if (serverProcess) {
			serverProcess.kill("SIGTERM");
		}
	}
}

main().catch((error) => {
	console.error(`${PREFIX} FAILED: ${toErrorMessage(error)}`);
	process.exitCode = 1;
});
