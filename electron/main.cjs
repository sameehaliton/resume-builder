const path = require("node:path");
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
