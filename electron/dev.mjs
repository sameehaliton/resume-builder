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
	process.exit(code ?? 0);
});
