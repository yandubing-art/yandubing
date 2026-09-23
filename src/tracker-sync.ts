import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Download, type Locator, type Page } from "playwright-core";
import { config } from "./config.js";
import { readTrackerVehicleList } from "./tracker-live.js";
import { TrackerHistoryStore } from "./tracker-history-store.js";
import { deduplicateTrackerRecords, TrackerStatusStore } from "./tracker-status-store.js";
import { cleanupTrackerEmailReports, syncLatestTrackerEmailReport, TrackerEmailReportStore } from "./tracker-email-report.js";
import { hasRetryableTrackerMileageResults, syncStoredTrackerEmailMileage, TrackerMileageSyncStore } from "./tracker-mileage-sync.js";
import { LarkClient } from "./lark.js";

const statusStore = new TrackerStatusStore();
const historyStore = new TrackerHistoryStore();
const emailReportStore = new TrackerEmailReportStore();
const mileageSyncStore = new TrackerMileageSyncStore();
const lark = new LarkClient();
let stopping = false;
let activeContext: BrowserContext | null = null;
let emailSyncRunning = false;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emailReportDue(now = new Date()): boolean {
  if (!config.trackerReportEmailEnabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = config.trackerReportEmailRunHour * 60 + config.trackerReportEmailRunMinute;
  const end = 6 * 60;
  if (minutes < start || minutes > end) return false;
  const runDate = localDateKey(now);
  const state = emailReportStore.read();
  if (state.lastSuccessRunDate === runDate) {
    const mileageState = mileageSyncStore.read();
    const mileageNeedsRetry = config.trackerMileageSyncEnabled && Boolean(state.sourceHash)
      && (mileageState.sourceHash !== state.sourceHash || !mileageState.completedAt || hasRetryableTrackerMileageResults(mileageState));
    if (!mileageNeedsRetry) return false;
  }
  const lastAttempt = Date.parse(state.lastAttemptAt || "");
  return !Number.isFinite(lastAttempt) || Date.now() - lastAttempt >= 30 * 60 * 1000;
}

async function syncEmailReportIfDue(): Promise<void> {
  if (emailSyncRunning || !emailReportDue()) return;
  emailSyncRunning = true;
  const runDate = localDateKey();
  try {
    cleanupTrackerEmailReports();
    const result = await syncLatestTrackerEmailReport(runDate, emailReportStore);
    console.log("Tracker email report check", { runDate, ...result });
    const mileageResult = await syncStoredTrackerEmailMileage(lark, emailReportStore, mileageSyncStore);
    console.log("Tracker email mileage sync", mileageResult);
  } catch (error) {
    console.warn("Tracker email report check failed", { runDate, error: message(error) });
  } finally {
    emailSyncRunning = false;
  }
}

function resolveBrowserExecutable(): string {
  if (config.trackerBrowserExecutablePath) return path.resolve(config.trackerBrowserExecutablePath);
  let bundledChromium = "";
  try {
    bundledChromium = chromium.executablePath();
  } catch {
    bundledChromium = "";
  }
  const candidates = [
    bundledChromium,
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe")
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

async function launchContext(): Promise<BrowserContext> {
  const userDataDir = path.resolve(config.trackerBrowserProfilePath);
  const downloadDirectory = path.resolve(config.trackerDownloadDirectory);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(downloadDirectory, { recursive: true });
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) throw new Error("No supported Edge or Chrome executable was found; configure TRACKER_BROWSER_EXECUTABLE_PATH");
  return chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: config.trackerHeadless,
    acceptDownloads: true,
    downloadsPath: downloadDirectory,
    args: ["--disable-blink-features=AutomationControlled"],
    ...(config.trackerBrowserUserAgent ? { userAgent: config.trackerBrowserUserAgent } : {}),
    viewport: { width: 1440, height: 1000 }
  });
}

async function ensureLoggedIn(page: Page): Promise<void> {
  const target = `${config.trackerBaseUrl.replace(/\/$/, "")}/myHub/vehicles`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: config.trackerPageTimeoutMs });
  const passwordInput = page.locator('input[type="password"]').first();
  const loginRequired = /\/login|\/account\/login/i.test(page.url()) || await passwordInput.isVisible().catch(() => false);
  if (!loginRequired) {
    await page.getByText("Vehicles", { exact: true }).first().waitFor({ state: "visible", timeout: config.trackerPageTimeoutMs });
    return;
  }
  if (!config.trackerUsername || !config.trackerPassword) throw new Error("Tracker login is required but TRACKER_USERNAME or TRACKER_PASSWORD is not configured");
  const usernameInput = page.locator('input:not([type="password"]):not([type="checkbox"]):not([type="hidden"])').first();
  await usernameInput.fill(config.trackerUsername);
  await passwordInput.fill(config.trackerPassword);
  const rememberMe = page.locator('input[type="checkbox"]').first();
  if (await rememberMe.isVisible().catch(() => false)) await rememberMe.check().catch(() => undefined);
  const loginButton = page.locator("#btnLogin").or(page.getByRole("button", { name: /log in/i })).first();
  await loginButton.click({ timeout: config.trackerPageTimeoutMs });
  await page.waitForURL((url) => !/\/login|\/account\/login/i.test(url.pathname), { timeout: config.trackerPageTimeoutMs });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: config.trackerPageTimeoutMs });
  await page.getByText("Vehicles", { exact: true }).first().waitFor({ state: "visible", timeout: config.trackerPageTimeoutMs });
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (await locator.count().catch(() => 0) && await locator.first().isVisible().catch(() => false)) return locator.first();
  }
  return null;
}

async function waitForEnabled(locator: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isEnabled().catch(() => false)) return true;
    await wait(250);
  }
  return false;
}

function reportFiles(directory: string): Map<string, { size: number; mtimeMs: number }> {
  if (!fs.existsSync(directory)) return new Map();
  return new Map(fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      const stat = fs.statSync(filePath);
      return [filePath, { size: stat.size, mtimeMs: stat.mtimeMs }];
    }));
}

function isCompletePdf(filePath: string): boolean {
  try {
    const data = fs.readFileSync(filePath);
    if (data.length < 16 || data.subarray(0, 5).toString("ascii") !== "%PDF-") return false;
    return data.subarray(Math.max(0, data.length - 2048)).toString("latin1").includes("%%EOF");
  } catch {
    return false;
  }
}

async function waitForNewReportFile(
  directory: string,
  before: Map<string, { size: number; mtimeMs: number }>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let stableCandidate = "";
  let stableSize = -1;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Tracker report file wait was cancelled");
    const candidates = [...reportFiles(directory).entries()]
      .filter(([filePath, stat]) => {
        const previous = before.get(filePath);
        return stat.size > 0 && (!previous || stat.mtimeMs > previous.mtimeMs || stat.size !== previous.size);
      })
      .sort((left, right) => right[1].mtimeMs - left[1].mtimeMs);
    const candidate = candidates[0];
    if (candidate) {
      if (candidate[0] === stableCandidate && candidate[1].size === stableSize) stableChecks += 1;
      else {
        stableCandidate = candidate[0];
        stableSize = candidate[1].size;
        stableChecks = 1;
      }
      if (stableChecks >= 2 && isCompletePdf(stableCandidate)) return stableCandidate;
    }
    await wait(500);
  }
  throw new Error("Tracker report file did not appear in the download directory");
}

async function downloadVehicleReport(page: Page): Promise<string> {
  const vehiclesHeading = page.getByText("Vehicles", { exact: true }).first();
  await vehiclesHeading.waitFor({ state: "visible", timeout: config.trackerPageTimeoutMs });
  const trigger = await firstVisible([
    page.locator("button.download"),
    page.locator('button[aria-label*="download" i]'),
    page.locator('button[title*="download" i]'),
    page.locator('button:has-text("file_download")'),
    vehiclesHeading.locator("xpath=following::button[1]")
  ]);
  if (!trigger) throw new Error("Tracker vehicle report download button was not found");
  await trigger.click({ timeout: config.trackerPageTimeoutMs });
  await page.getByText("Download Vehicle List Report", { exact: true }).waitFor({ state: "visible", timeout: config.trackerPageTimeoutMs });
  const finalButton = page.getByRole("button", { name: "Download", exact: true });
  const pdfOption = page.getByText("Pdf", { exact: true }).first();
  const pdfChip = pdfOption.locator("xpath=..");
  const pdfSelected = (await pdfChip.getAttribute("class").catch(() => ""))?.includes("chip-selected") || false;
  if (!pdfSelected && await pdfOption.isVisible().catch(() => false)) {
    await pdfChip.click();
  }
  if (!await waitForEnabled(finalButton, Math.min(config.trackerPageTimeoutMs, 30_000))) {
    throw new Error("Tracker report download button remained disabled after selecting PDF");
  }

  const downloadDirectory = path.resolve(config.trackerDownloadDirectory);
  const before = reportFiles(downloadDirectory);
  const destination = path.join(downloadDirectory, `VehicleListReport-${Date.now()}.pdf`);
  const controller = new AbortController();
  const eventResult = page.waitForEvent("download", { timeout: config.trackerPageTimeoutMs })
    .then((download) => ({ download, filePath: "" }));
  const fileResult = waitForNewReportFile(downloadDirectory, before, config.trackerPageTimeoutMs, controller.signal)
    .then((filePath) => ({ download: null, filePath }));
  // Attach rejection handlers before clicking: the Tracker button can keep the
  // click action pending while the download event itself reaches its timeout.
  const resultPromise = Promise.any([eventResult, fileResult]);
  let result: { download: Download | null; filePath: string };
  try {
    await finalButton.click({ timeout: config.trackerPageTimeoutMs, noWaitAfter: true });
    result = await resultPromise.catch(() => { throw new Error("Tracker vehicle report download did not complete"); });
    if (result.download) {
      try {
        await result.download.saveAs(destination);
      } catch {
        result = await fileResult;
      }
    }
  } finally {
    controller.abort();
  }
  if (!result.download && path.resolve(result.filePath) !== path.resolve(destination)) {
    fs.copyFileSync(result.filePath, destination);
    fs.rmSync(result.filePath, { force: true });
  }
  return destination;
}

function cleanOldReports(): void {
  const directory = path.resolve(config.trackerDownloadDirectory);
  if (!fs.existsSync(directory)) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(directory, entry.name);
    if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
  }
}

export async function syncTrackerReportOnce(completedRefreshRequestId?: string): Promise<number> {
  statusStore.writeAttempt();
  if (config.trackerReportDownloadEnabled) cleanOldReports();
  let reportPath = "";
  try {
    activeContext = await launchContext();
    const page = activeContext.pages()[0] || await activeContext.newPage();
    page.setDefaultTimeout(config.trackerPageTimeoutMs);
    await ensureLoggedIn(page);
    let parsed;
    let source: "report" | "live" = "live";
    if (config.trackerReportDownloadEnabled) {
      try {
        reportPath = await downloadVehicleReport(page);
        const { parseTrackerVehicleReportPdf } = await import("./tracker-report.js");
        parsed = await parseTrackerVehicleReportPdf(fs.readFileSync(reportPath));
        source = "report";
      } catch (error) {
        console.warn("Tracker report download failed; using the live vehicle list:", message(error));
      }
    }
    parsed ||= await readTrackerVehicleList(page, statusStore.read().records);
    const records = deduplicateTrackerRecords(parsed.records);
    const historyRecords = historyStore.appendSnapshots(records);
    statusStore.writeSuccess({ ...parsed, records, source, completedRefreshRequestId });
    console.log("Tracker vehicle data synchronized", { source, records: records.length, historyRecords, reportCreatedAt: parsed.reportCreatedAt });
    return records.length;
  } catch (error) {
    const detail = message(error);
    if (config.trackerErrorScreenshotPath && activeContext) {
      const page = activeContext.pages().at(-1);
      if (page) {
        const screenshotPath = path.resolve(config.trackerErrorScreenshotPath);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
      }
    }
    statusStore.writeFailure(detail, completedRefreshRequestId);
    throw error;
  } finally {
    if (activeContext) await activeContext.close().catch(() => undefined);
    activeContext = null;
    if (reportPath) fs.rmSync(reportPath, { force: true });
  }
}

async function importReport(filePath: string): Promise<void> {
  statusStore.writeAttempt();
  const { parseTrackerVehicleReportPdf } = await import("./tracker-report.js");
  const parsed = await parseTrackerVehicleReportPdf(fs.readFileSync(path.resolve(filePath)));
  const records = deduplicateTrackerRecords(parsed.records);
  const historyRecords = historyStore.appendSnapshots(records);
  statusStore.writeSuccess({ ...parsed, records, source: "report" });
  console.log("Tracker report imported", { records: records.length, historyRecords, reportCreatedAt: parsed.reportCreatedAt });
}

async function hasActiveDispatch(): Promise<boolean> {
  const endpoint = config.trackerActivityUrl || `http://127.0.0.1:${config.port}/api/tasks`;
  try {
    const response = await fetch(endpoint, { headers: { "x-internal-api-token": config.internalApiToken }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return false;
    const payload = await response.json() as { tasks?: Array<{ status?: string; stage?: string }> };
    const keywords = config.trackerActiveStatusKeywords.map((value) => value.toLowerCase());
    return (payload.tasks || []).some((task) => {
      const value = `${task.status || ""} ${task.stage || ""}`.toLowerCase();
      return keywords.some((keyword) => value.includes(keyword));
    });
  } catch (error) {
    console.warn("Tracker activity check failed; using normal interval:", message(error));
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop(): Promise<void> {
  let consecutiveFailures = 0;
  let delay = 0;
  while (!stopping) {
    const refreshRequestId = await waitForNextRun(delay);
    if (stopping) break;
    delay = config.trackerSyncIntervalMs;
    try {
      await syncTrackerReportOnce(refreshRequestId);
      consecutiveFailures = 0;
      if (await hasActiveDispatch()) delay = config.trackerActiveSyncIntervalMs;
    } catch (error) {
      consecutiveFailures += 1;
      delay = config.trackerRetryIntervalMs;
      console.error("Tracker synchronization failed", { consecutiveFailures, error: message(error) });
    }
    await syncEmailReportIfDue();
  }
}

async function waitForNextRun(delayMs: number): Promise<string | undefined> {
  const scheduledAt = Date.now() + Math.max(0, delayMs);
  while (!stopping) {
    const current = statusStore.read();
    const previousAttempt = Date.parse(current.lastAttemptAt || current.lastSuccessAt || "");
    const minimumAt = Number.isFinite(previousAttempt) ? previousAttempt + config.trackerMinimumSyncIntervalMs : Date.now();
    const normalRunAt = Math.max(scheduledAt, minimumAt);
    const refreshRunAt = current.refreshRequest ? minimumAt : Number.POSITIVE_INFINITY;
    const runAt = Math.min(normalRunAt, refreshRunAt);
    const remaining = runAt - Date.now();
    if (remaining <= 0) return current.refreshRequest?.id;
    await wait(Math.min(5_000, remaining));
  }
  return undefined;
}

async function main(): Promise<void> {
  if (process.argv.includes("--email-mileage-once") || process.argv.includes("--email-mileage-dry-run")) {
    if (process.argv.includes("--email-mileage-once")) {
      const emailResult = await syncLatestTrackerEmailReport(localDateKey(), emailReportStore);
      console.log("Tracker email report check", emailResult);
    }
    const result = await syncStoredTrackerEmailMileage(lark, emailReportStore, mileageSyncStore, { dryRun: process.argv.includes("--email-mileage-dry-run") });
    console.log("Tracker email mileage sync", result);
    return;
  }
  if (process.argv.includes("--email-once")) {
    const result = await syncLatestTrackerEmailReport(localDateKey(), emailReportStore);
    console.log("Tracker email report check", result);
    return;
  }
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) {
    const filePath = process.argv[reportIndex + 1];
    if (!filePath) throw new Error("--report requires a PDF file path");
    await importReport(filePath);
    return;
  }
  if (!config.trackerSyncEnabled) {
    console.log("Tracker synchronization is disabled; set TRACKER_SYNC_ENABLED=true to start the worker");
    return;
  }
  if (process.argv.includes("--once")) {
    await syncTrackerReportOnce();
    return;
  }
  await runLoop();
}

async function shutdown(): Promise<void> {
  stopping = true;
  if (activeContext) await activeContext.close().catch(() => undefined);
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });

main().catch((error) => {
  console.error(message(error));
  process.exitCode = 1;
});
