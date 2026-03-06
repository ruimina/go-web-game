import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  chromeExecutablePath,
  chromeUserDataDir,
  defaultLoginUrl,
} from "./chrome-profile-config.mjs";

const urls = process.argv.slice(2);
const targetUrls = urls.length > 0 ? urls : [defaultLoginUrl];

if (!fs.existsSync(chromeExecutablePath)) {
  console.error(`Chrome not found at: ${chromeExecutablePath}`);
  process.exit(1);
}

fs.mkdirSync(chromeUserDataDir, { recursive: true });

const chromeArgs = [
  `--user-data-dir=${chromeUserDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  // Playwright launches Chrome with a mock keychain on macOS.
  // Use the same secure storage mode here so manual login cookies remain readable.
  "--use-mock-keychain",
  ...targetUrls,
];

const child = spawn(chromeExecutablePath, chromeArgs, {
  detached: true,
  stdio: "ignore",
});

child.unref();

console.log(`Opened Chrome with dedicated profile: ${chromeUserDataDir}`);
console.log("Log into the sites you want to reuse later, then close that Chrome window.");
