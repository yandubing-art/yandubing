import crypto from "node:crypto";
import { normalizeTrackerIdentifier } from "./tracker-status-store.js";

export type TrackerCsvMileageRecord = {
  registration: string;
  normalizedRegistration: string;
  reportStart: string;
  reportEnd: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  odometerEndConsistent: boolean;
  sourceRows: number;
};

export type ParsedTrackerCsvReport = {
  sourceHash: string;
  reportStart: string;
  reportEnd: string;
  records: TrackerCsvMileageRecord[];
};

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushCell = (): void => {
    row.push(cell);
    cell = "";
  };
  const pushRow = (): void => {
    if (row.length || cell) pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      pushCell();
    } else if (character === "\n") {
      pushRow();
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (quoted) throw new Error("Tracker CSV contains an unterminated quoted field");
  if (row.length || cell) pushRow();
  return rows;
}

function numberValue(value: string | undefined): number | null {
  const normalized = String(value || "").replace(/[\s,]/g, "").trim();
  if (!normalized || normalized === "-") return null;
  const number = Number(normalized.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function reportTimestamp(value: string): string {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const timestamp = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+02:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value.trim();
}

export function parseTrackerCsvReport(data: Buffer | Uint8Array): ParsedTrackerCsvReport {
  const bytes = Uint8Array.from(data);
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("Tracker CSV contains no data rows");

  const headers = rows[0].map((header) => header.trim());
  const index = new Map(headers.map((header, position) => [header, position]));
  const required = ["Reg", "ReportStart", "ReportEnd", "VehOdometerStart", "VehOdometerEnd"];
  const missing = required.filter((name) => !index.has(name));
  if (missing.length) throw new Error(`Tracker CSV is missing fields: ${missing.join(", ")}`);

  const at = (row: string[], name: string): string => row[index.get(name) ?? -1] || "";
  const reportStart = reportTimestamp(at(rows[1], "ReportStart"));
  const reportEnd = reportTimestamp(at(rows[1], "ReportEnd"));
  if (!reportStart || !reportEnd) throw new Error("Tracker CSV has no report period");

  const grouped = new Map<string, { registration: string; starts: Set<number>; ends: Set<number>; rows: number }>();
  for (const row of rows.slice(1)) {
    const registration = at(row, "Reg").trim();
    const normalizedRegistration = normalizeTrackerIdentifier(registration);
    if (!normalizedRegistration || registration === "-") continue;
    const group = grouped.get(normalizedRegistration) || { registration, starts: new Set(), ends: new Set(), rows: 0 };
    group.rows += 1;
    const start = numberValue(at(row, "VehOdometerStart"));
    const end = numberValue(at(row, "VehOdometerEnd"));
    if (start !== null) group.starts.add(start);
    if (end !== null) group.ends.add(end);
    grouped.set(normalizedRegistration, group);
  }

  const records = [...grouped.entries()].map(([normalizedRegistration, group]) => {
    const starts = [...group.starts].sort((left, right) => left - right);
    const ends = [...group.ends].sort((left, right) => left - right);
    return {
      registration: group.registration,
      normalizedRegistration,
      reportStart,
      reportEnd,
      odometerStart: starts.length ? starts[0] : null,
      odometerEnd: ends.length ? ends[ends.length - 1] : null,
      odometerEndConsistent: ends.length <= 1,
      sourceRows: group.rows
    };
  });
  if (!records.length) throw new Error("Tracker CSV contains no identifiable vehicles");

  return {
    sourceHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    reportStart,
    reportEnd,
    records
  };
}
