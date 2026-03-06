import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  chromeExecutablePath,
  chromeUserDataDir,
  defaultCheckUrl,
  playwrightArtifactDir,
} from "./chrome-profile-config.mjs";

const targetUrl = process.argv[2] || defaultCheckUrl;
const screenshotPath = path.join(playwrightArtifactDir, "codex-profile-check.png");

if (!fs.existsSync(chromeExecutablePath)) {
  console.error(`Chrome not found at: ${chromeExecutablePath}`);
  process.exit(1);
}

fs.mkdirSync(chromeUserDataDir, { recursive: true });
fs.mkdirSync(playwrightArtifactDir, { recursive: true });

const context = await chromium.launchPersistentContext(chromeUserDataDir, {
  executablePath: chromeExecutablePath,
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: [
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`Opened ${targetUrl}`);
  console.log(`Using profile: ${chromeUserDataDir}`);
  console.log(`Saved screenshot: ${screenshotPath}`);
  console.log("If the page is already logged in, this profile is ready for reuse.");
} finally {
  await context.close();
}

