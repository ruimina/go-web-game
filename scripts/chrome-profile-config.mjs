import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export const chromeExecutablePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const chromeUserDataDir = path.join(repoRoot, ".local", "chrome-codex-profile");
export const defaultLoginUrl = "https://accounts.google.com/";
export const defaultCheckUrl = "https://example.com/";
export const playwrightArtifactDir = path.join(repoRoot, "output", "playwright");

