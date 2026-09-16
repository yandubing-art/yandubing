import crypto from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TrackerVehicleSnapshot } from "./tracker-status-store.js";

type PositionedText = { text: string; x: number; y: number };

export type ParsedTrackerReport = {
  reportCreatedAt: string | null;
  sourceHash: string;
  records: TrackerVehicleSnapshot[];
};

function parsePdfDate(value: unknown): string | null {
  const raw = typeof value === "string" ? value : "";
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-])(\d{2})'?([0-5]\d)'?$/.exec(raw);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, zoneHour, zoneMinute] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${zoneHour}:${zoneMinute}`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function valuesInColumn(items: PositionedText[], minX: number, maxX: number): PositionedText[] {
  return items.filter((item) => item.x >= minX && item.x < maxX).sort((left, right) => right.y - left.y || left.x - right.x);
}

function joined(items: PositionedText[], minX: number, maxX: number, separator: string): string {
  return valuesInColumn(items, minX, maxX).map((item) => item.text.trim()).filter(Boolean).join(separator).trim();
}

function parseSouthAfricaTimestamp(date: string, time: string): string | null {
  const dateMatch = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const timestamp = Date.parse(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}+02:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parsePage(items: PositionedText[]): TrackerVehicleSnapshot[] {
  const dateAnchors = items
    .filter((item) => item.x < 70 && /^\d{4}\/\d{2}\/\d{2}$/.test(item.text.trim()))
    .sort((left, right) => right.y - left.y);

  return dateAnchors.flatMap((anchor) => {
    const row = items.filter((item) => item.y <= anchor.y + 1.5 && item.y >= anchor.y - 12);
    const time = row.find((item) => item.x < 70 && /^\d{2}:\d{2}:\d{2}$/.test(item.text.trim()))?.text.trim() || "";
    const trackerTimestamp = parseSouthAfricaTimestamp(anchor.text.trim(), time);
    const registration = joined(row, 70, 140, "");
    const vin = joined(row, 215, 310, "");
    const unitSerialNumber = joined(row, 395, 480, "");
    if (!trackerTimestamp || !registration || !vin || !unitSerialNumber) return [];
    const odometerText = joined(row, 480, 545, "").replace(/\D/g, "");
    return [{
      registration,
      alias: joined(row, 140, 215, " "),
      vin,
      product: joined(row, 310, 395, " "),
      unitSerialNumber,
      odometer: odometerText ? Number(odometerText) : null,
      location: joined(row, 545, Number.POSITIVE_INFINITY, " "),
      trackerTimestamp
    }];
  });
}

export async function parseTrackerVehicleReportPdf(data: Buffer | Uint8Array): Promise<ParsedTrackerReport> {
  // pdfjs transfers the typed-array backing buffer to its worker. Always make
  // a standalone Uint8Array so Node Buffers and caller-owned data remain valid.
  const bytes = Uint8Array.from(data);
  const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    const metadata = await document.getMetadata().catch(() => null);
    const records: TrackerVehicleSnapshot[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => {
        if (!("str" in item) || !("transform" in item)) return [];
        const text = String(item.str || "").trim();
        if (!text) return [];
        return [{ text, x: Number(item.transform[4]), y: Number(item.transform[5]) }];
      });
      records.push(...parsePage(items));
    }
    if (!records.length) throw new Error("Tracker vehicle report contained no readable vehicle rows");
    const info = metadata?.info as Record<string, unknown> | undefined;
    return {
      reportCreatedAt: parsePdfDate(info?.CreationDate),
      sourceHash,
      records
    };
  } finally {
    await loadingTask.destroy();
  }
}
