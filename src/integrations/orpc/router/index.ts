import { aiRouter } from "./ai";
import { authRouter } from "./auth";
import { flagsRouter } from "./flags";
import { packetRouter } from "./packet";
import { printerRouter } from "./printer";
import { resumeRouter } from "./resume";
import { resumeosRouter } from "./resumeos";
import { statisticsRouter } from "./statistics";
import { storageRouter } from "./storage";
import { syncSettingsRouter } from "./sync-settings";

export default {
	ai: aiRouter,
	auth: authRouter,
	flags: flagsRouter,
	packet: packetRouter,
	resume: resumeRouter,
	resumeos: resumeosRouter,
	storage: storageRouter,
	syncSettings: syncSettingsRouter,
	printer: printerRouter,
	statistics: statisticsRouter,
};
