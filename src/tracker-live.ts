import crypto from "node:crypto";
import type { Page } from "playwright-core";
import { normalizeTrackerIdentifier, type TrackerVehicleSnapshot } from "./tracker-status-store.js";

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

type VisibleTrackerVehicle = {
  registration: string;
  alias: string;
  status: string;
  location: string;
  timestampLabel: string;
  vin?: string;
  product?: string;
  odometer?: number | null;
};

export function parseTrackerOdometer(value: string): number | null {
  const match = /([\d\s,\.]+)\s*(?:km|公里)/i.exec(value.replace(/\u00a0/g, " "));
  if (!match) return null;
  const odometer = Number(match[1].replace(/[\s,]/g, ""));
  return Number.isFinite(odometer) && odometer >= 0 ? odometer : null;
}

async function readVehicleDetails(page: Page, index: number): Promise<Pick<VisibleTrackerVehicle, "vin" | "product" | "odometer">> {
  const item = page.locator("vehicleitem").nth(index);
  const toggle = item.locator(".DesktopExpandIcon imagebutton > div");
  await toggle.evaluate((element) => (element as HTMLElement).click());
  try {
    const details = item.locator(".detailsContent").first();
    await details.waitFor({ state: "attached", timeout: 8_000 });
    await details.locator(".odometerClass").first().waitFor({ state: "attached", timeout: 2_000 }).catch(() => undefined);
    const data = await details.evaluate((element) => ({
      lines: [...element.querySelectorAll(".modelClass")].map((node) => node.textContent?.trim() || ""),
      odometer: element.querySelector(".odometerClass")?.textContent?.trim() || "",
      product: element.querySelector(".productClass")?.textContent?.trim() || ""
    }));
    const vin = data.lines.map((line) => /^VIN\s*:\s*(\S+)/i.exec(line)?.[1] || "").find(Boolean) || "";
    return { vin, product: data.product, odometer: parseTrackerOdometer(data.odometer) };
  } finally {
    await toggle.evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
  }
}

export function parseTrackerVisibleTimestamp(value: string): string | null {
  const match = /(?:^|,\s*)(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{2}):(\d{2})\s*$/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const iso = `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}T${match[4]}:${match[5]}:00+02:00`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function preferredAlias(previous: TrackerVehicleSnapshot | undefined, current: string): string {
  const existing = previous?.alias?.trim() || "";
  if (existing && existing !== "-") return existing;
  return current;
}

export async function readTrackerVehicleList(
  page: Page,
  previousRecords: TrackerVehicleSnapshot[]
): Promise<{ records: TrackerVehicleSnapshot[]; reportCreatedAt: string; sourceHash: string }> {
  const items = page.locator("vehicleitem");
  await items.first().waitFor({ state: "visible", timeout: 30_000 });
  const visible = await items.evaluateAll((elements): VisibleTrackerVehicle[] => elements.map((element) => {
    const text = (selector: string) => element.querySelector(selector)?.textContent?.trim() || "";
    const statuses = [...element.querySelectorAll(".vehicleStatus .infoFontLargeRegular, .additionalStatus .infoFontLargeRegular")]
      .map((node) => node.textContent?.trim() || "")
      .filter(Boolean);
    return {
      registration: text(".heading .largeTextCapitalize"),
      alias: text(".heading .largeTextTertiaryCapitalize"),
      status: [...new Set(statuses)].join(" / "),
      timestampLabel: text(".location .primaryBoldText.PositionText"),
      location: text(".location .PositionText.largeTextCapitalize")
    };
  }));

  for (let index = 0; index < visible.length; index += 1) {
    if (!visible[index].registration) continue;
    try {
      Object.assign(visible[index], await readVehicleDetails(page, index));
    } catch (error) {
      console.warn("Tracker vehicle details unavailable", { registration: visible[index].registration, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const previousByRegistration = new Map<string, TrackerVehicleSnapshot>();
  for (const record of previousRecords) {
    const key = normalizeTrackerIdentifier(record.registration);
    if (!key || previousByRegistration.has(key)) continue;
    previousByRegistration.set(key, record);
  }

  const records = visible.flatMap((item) => {
    const trackerTimestamp = parseTrackerVisibleTimestamp(item.timestampLabel);
    const key = normalizeTrackerIdentifier(item.registration);
    if (!key || !trackerTimestamp || !item.location) return [];
    const previous = previousByRegistration.get(key);
    return [{
      registration: item.registration,
      alias: preferredAlias(previous, item.alias),
      vin: item.vin || previous?.vin || "",
      product: item.product || previous?.product || "",
      unitSerialNumber: previous?.unitSerialNumber || "",
      odometer: item.odometer ?? previous?.odometer ?? null,
      location: item.location,
      trackerTimestamp,
      status: item.status
    }];
  });

  if (!records.length) throw new Error("Tracker vehicle page contained no readable vehicle rows");
  const reportCreatedAt = new Date().toISOString();
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
  return { records, reportCreatedAt, sourceHash };
}
