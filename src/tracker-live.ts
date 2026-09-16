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
};

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
      vin: previous?.vin || "",
      product: previous?.product || "",
      unitSerialNumber: previous?.unitSerialNumber || "",
      odometer: previous?.odometer ?? null,
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
