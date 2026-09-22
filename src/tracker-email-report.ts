import fs from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "./config.js";
import { parseTrackerCsvReport, type ParsedTrackerCsvReport, type TrackerCsvMileageRecord } from "./tracker-csv-report.js";

export type TrackerEmailReportState = {
  version: 1;
  lastAttemptAt: string | null;
  lastAttemptRunDate: string | null;
  lastSuccessAt: string | null;
  lastSuccessRunDate: string | null;
  lastError: string;
  messageId: string | null;
  reportStart: string | null;
  reportEnd: string | null;
  sourceHash: string | null;
  filePath: string | null;
  records: TrackerCsvMileageRecord[];
};

export type TrackerEmailSyncResult = {
  status: "updated" | "unchanged" | "not_found" | "skipped";
  message: string;
  records: number;
  reportStart?: string;
  reportEnd?: string;
};

const EMPTY_STATE: TrackerEmailReportState = {
  version: 1,
  lastAttemptAt: null,
  lastAttemptRunDate: null,
  lastSuccessAt: null,
  lastSuccessRunDate: null,
  lastError: "",
  messageId: null,
  reportStart: null,
  reportEnd: null,
  sourceHash: null,
  filePath: null,
  records: []
};

export class TrackerEmailReportStore {
  private readonly filePath: string;
  private cached: TrackerEmailReportState;

  constructor(filePath = config.trackerReportEmailStatePath) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.cached = this.load();
  }

  read(): TrackerEmailReportState {
    this.cached = this.load();
    return this.cached;
  }

  beginAttempt(runDate: string): TrackerEmailReportState {
    return this.persist({
      ...this.read(),
      lastAttemptAt: new Date().toISOString(),
      lastAttemptRunDate: runDate,
      lastError: ""
    });
  }

  writeFailure(error: string): TrackerEmailReportState {
    return this.persist({ ...this.read(), lastError: error.slice(0, 500) });
  }

  writeSuccess(input: { runDate: string; messageId: string; report: ParsedTrackerCsvReport; filePath: string }): TrackerEmailReportState {
    return this.persist({
      ...this.read(),
      lastAttemptRunDate: input.runDate,
      lastSuccessAt: new Date().toISOString(),
      lastSuccessRunDate: input.runDate,
      lastError: "",
      messageId: input.messageId,
      reportStart: input.report.reportStart,
      reportEnd: input.report.reportEnd,
      sourceHash: input.report.sourceHash,
      filePath: input.filePath,
      records: input.report.records
    });
  }

  private load(): TrackerEmailReportState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TrackerEmailReportState>;
      return {
        ...EMPTY_STATE,
        ...parsed,
        version: 1,
        records: Array.isArray(parsed.records) ? parsed.records as TrackerCsvMileageRecord[] : []
      };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  private persist(state: TrackerEmailReportState): TrackerEmailReportState {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    this.cached = state;
    return state;
  }
}

function messageId(message: { uid: number; envelope?: { messageId?: string | null } }): string {
  return message.envelope?.messageId?.trim() || `uid:${message.uid}`;
}

function reportFileName(report: ParsedTrackerCsvReport): string {
  const date = (report.reportEnd || new Date().toISOString()).slice(0, 10).replace(/[^0-9-]/g, "");
  return `TripReport-Detail-${date}-${report.sourceHash.slice(0, 12)}.csv`;
}

function attachmentIsCsv(attachment: { filename?: string | null; contentType?: string }): boolean {
  const filename = String(attachment.filename || "").toLowerCase();
  const contentType = String(attachment.contentType || "").toLowerCase();
  return filename.endsWith(".csv") || contentType.includes("csv") || contentType === "application/vnd.ms-excel";
}

function subjectMatches(subject: string): boolean {
  return subject.toLocaleLowerCase().includes(config.trackerReportEmailSubject.toLocaleLowerCase());
}

function mailDate(value: Date | string | undefined): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mailError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const candidate = error as { message?: unknown; serverResponseCode?: unknown; responseText?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : String(error);
  const code = typeof candidate.serverResponseCode === "string" ? candidate.serverResponseCode : "";
  const response = typeof candidate.responseText === "string" ? candidate.responseText : "";
  return [message, code, response].filter(Boolean).join("; ");
}

async function getGmailAccessToken(): Promise<string> {
  if (config.trackerReportEmailAuthMode !== "oauth2") {
    throw new Error(`Unsupported tracker report email auth mode: ${config.trackerReportEmailAuthMode}`);
  }
  if (!config.trackerReportEmailClientId || !config.trackerReportEmailClientSecret || !config.trackerReportEmailRefreshToken) {
    throw new Error("Gmail OAuth2 is enabled but client ID, client secret, or refresh token is missing");
  }
  const response = await fetch(config.trackerReportEmailTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.trackerReportEmailClientId,
      client_secret: config.trackerReportEmailClientSecret,
      refresh_token: config.trackerReportEmailRefreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: unknown; error?: unknown; error_description?: unknown };
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    const detail = [payload.error, payload.error_description].filter(Boolean).join(": ") || response.statusText;
    throw new Error(`Gmail OAuth2 token refresh failed: ${detail}`);
  }
  return payload.access_token;
}

export async function syncLatestTrackerEmailReport(
  runDate: string,
  store = new TrackerEmailReportStore()
): Promise<TrackerEmailSyncResult> {
  if (!config.trackerReportEmailEnabled) {
    return { status: "skipped", message: "Tracker email report sync is disabled", records: 0 };
  }
  if (!config.trackerReportEmailUser) {
    return { status: "skipped", message: "Tracker email report user is not configured", records: 0 };
  }

  store.beginAttempt(runDate);
  const reportDirectory = path.resolve(config.trackerReportEmailDirectory);
  fs.mkdirSync(reportDirectory, { recursive: true });
  let client: ImapFlow | null = null;
  try {
    const accessToken = await getGmailAccessToken();
    client = new ImapFlow({
      host: config.trackerReportEmailHost,
      port: config.trackerReportEmailPort,
      secure: true,
      auth: { user: config.trackerReportEmailUser, accessToken },
      logger: false
    });
    await client.connect();
    const lock = await client.getMailboxLock(config.trackerReportEmailMailbox, { readOnly: true });
    try {
      const since = new Date(Date.now() - config.trackerReportEmailLookbackDays * 24 * 60 * 60 * 1000);
      const foundUids = await client.search({ since }, { uid: true });
      const uids = foundUids === false ? [] : foundUids;
      const recentUids = uids.slice(-100).reverse();
      const messages = await client.fetchAll(recentUids, { envelope: true, internalDate: true, source: true }, { uid: true });
      messages.sort((left, right) => mailDate(right.internalDate) - mailDate(left.internalDate));

      for (const message of messages) {
        const subject = message.envelope?.subject || "";
        if (!subjectMatches(subject) || !message.source) continue;
        const parsedMessage = await simpleParser(message.source);
        const attachment = parsedMessage.attachments.find((item) => attachmentIsCsv(item));
        if (!attachment) continue;
        const report = parseTrackerCsvReport(attachment.content);
        const id = messageId(message);
        const previous = store.read();
        if (previous.messageId === id && previous.sourceHash === report.sourceHash) {
          return {
            status: "unchanged",
            message: "最新 Tracker CSV 报表已经处理过",
            records: report.records.length,
            reportStart: report.reportStart,
            reportEnd: report.reportEnd
          };
        }
        const filePath = path.join(reportDirectory, reportFileName(report));
        fs.writeFileSync(filePath, attachment.content);
        store.writeSuccess({ runDate, messageId: id, report, filePath });
        return {
          status: "updated",
          message: `已下载并解析 Tracker CSV 报表：${report.records.length} 辆车`,
          records: report.records.length,
          reportStart: report.reportStart,
          reportEnd: report.reportEnd
        };
      }
      const message = "未找到包含 Trip Report (Detail) CSV 附件的新邮件";
      store.writeFailure(message);
      return { status: "not_found", message, records: 0 };
    } finally {
      lock.release();
    }
  } catch (error) {
    const detail = mailError(error);
    store.writeFailure(detail);
    throw new Error(`Tracker email report sync failed: ${detail}`);
  } finally {
    await client?.logout().catch(() => undefined);
  }
}

export function cleanupTrackerEmailReports(directory = config.trackerReportEmailDirectory, keepDays = 14): void {
  const root = path.resolve(directory);
  if (!fs.existsSync(root)) return;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".csv")) continue;
    const filePath = path.join(root, entry.name);
    if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
  }
}
