#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";

const ELECTRON_VERSION = "35.0.1";
const ELECTRON_BUILDER_VERSION = "26.0.12";
const DIST_DESKTOP_DIR = "dist-desktop";

const rawArgs = process.argv.slice(2);
const isHelpRequested = rawArgs.includes("--help") || rawArgs.includes("-h");

if (isHelpRequested) {
	console.log(`Usage: node scripts/desktop/build-macos.mjs [--signed] [--notarize]\n\nModes:\n  default             Unsigned DMG/ZIP build\n  --signed            Signed DMG/ZIP build (requires CSC_LINK and CSC_KEY_PASSWORD)\n  --signed --notarize Signed DMG/ZIP build with notarization + stapling`);
	process.exit(0);
}

const supportedArgs = new Set(["--signed", "--notarize"]);
const unknownArgs = rawArgs.filter((arg) => !supportedArgs.has(arg));
if (unknownArgs.length > 0) {
	console.error(`[desktop:build] Unknown arguments: ${unknownArgs.join(", ")}`);
	process.exit(1);
}

if (process.platform !== "darwin") {
	console.error("[desktop:build] macOS packaging can only run on Darwin hosts.");
	process.exit(1);
}

const shouldSign = rawArgs.includes("--signed");
const shouldNotarize = rawArgs.includes("--notarize");

if (shouldNotarize && !shouldSign) {
	console.error("[desktop:build] --notarize requires --signed.");
	process.exit(1);
}

ensureRequiredEnv(shouldSign ? ["CSC_LINK", "CSC_KEY_PASSWORD"] : []);
ensureRequiredEnv(shouldNotarize ? ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"] : []);

const buildLabel = shouldNotarize ? "signed + notarized" : shouldSign ? "signed" : "unsigned";
console.log(`[desktop:build] Starting ${buildLabel} macOS packaging pipeline...`);

await rm(DIST_DESKTOP_DIR, { recursive: true, force: true });

await run(PNPM_BIN, ["build"]);

const builderArgs = [
	"exec",
	"--yes",
	`--package=electron@${ELECTRON_VERSION}`,
	`--package=electron-builder@${ELECTRON_BUILDER_VERSION}`,
	"electron-builder",
	"--mac",
	"dmg",
	"zip",
	"--publish",
	"never",
];

const builderEnv = {
	...process.env,
	CI: process.env.CI ?? "true",
};

if (!shouldSign) {
	builderArgs.push("--config.mac.identity=null");
	builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

await run(NPM_BIN, builderArgs, builderEnv);

if (shouldNotarize) {
	await notarizeAndStapleArtifacts();
}

console.log("[desktop:build] Completed macOS packaging pipeline.");

function ensureRequiredEnv(keys) {
	const missing = keys.filter((key) => {
		const value = process.env[key];
		return typeof value !== "string" || value.length === 0;
	});

	if (missing.length > 0) {
		console.error(`[desktop:build] Missing required environment variables: ${missing.join(", ")}`);
		process.exit(1);
	}
}

function run(command, args, env = process.env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			stdio: "inherit",
		});

		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			if (typeof code === "number") {
				reject(new Error(`${command} exited with code ${code}`));
				return;
			}

			reject(new Error(`${command} exited with signal ${signal ?? "unknown"}`));
		});
	});
}

async function notarizeAndStapleArtifacts() {
	const files = await readdir(DIST_DESKTOP_DIR, { withFileTypes: true });
	const dmgArtifacts = files
		.filter((entry) => entry.isFile() && entry.name.endsWith(".dmg"))
		.map((entry) => join(DIST_DESKTOP_DIR, entry.name));

	if (dmgArtifacts.length === 0) {
		throw new Error("No DMG artifacts were produced for notarization.");
	}

	for (const dmgPath of dmgArtifacts) {
		console.log(`[desktop:build] Notarizing ${dmgPath}...`);
		await run("xcrun", [
			"notarytool",
			"submit",
			dmgPath,
			"--apple-id",
			process.env.APPLE_ID,
			"--password",
			process.env.APPLE_APP_SPECIFIC_PASSWORD,
			"--team-id",
			process.env.APPLE_TEAM_ID,
			"--wait",
		]);

		console.log(`[desktop:build] Stapling ticket to ${dmgPath}...`);
		await run("xcrun", ["stapler", "staple", dmgPath]);
	}
}
