import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type TrackerVehicleSnapshot = {
  registration: string;
  alias: string;
  vin: string;
  product: string;
  unitSerialNumber: string;
  odometer: number | null;
  location: string;
  trackerTimestamp: string;
  status?: string;
};

export type TrackerSyncAuditEntry = {
  attemptedAt: string;
  completedAt: string;
  success: boolean;
  source: "report" | "live" | "unknown";
  recordCount: number;
  sourceHash: string;
  error: string;
};

export type TrackerRefreshRequest = {
  id: string;
  requestedAt: string;
  requestedBy: string;
};

export type TrackerSyncState = {
  version: 2;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string;
  reportCreatedAt: string | null;
  source: "report" | "live" | "unknown";
  sourceHash: string;
  records: TrackerVehicleSnapshot[];
  refreshRequest: TrackerRefreshRequest | null;
  lastRefreshCompletedAt: string | null;
  audit: TrackerSyncAuditEntry[];
};

const EMPTY_STATE: TrackerSyncState = {
  version: 2,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: "",
  reportCreatedAt: null,
  source: "unknown",
  sourceHash: "",
  records: [],
  refreshRequest: null,
  lastRefreshCompletedAt: null,
  audit: []
};

export type TrackerVehicleMatch = {
  vehicleKey: string;
  tableId: string;
  recordId: string;
  status: "matched" | "unmatched" | "pending_confirmation";
  reason: "vin" | "plate" | "not_found" | "duplicate_vin" | "duplicate_plate" | "vin_conflict";
  snapshot?: TrackerVehicleSnapshot;
};

export function normalizeTrackerIdentifier(value: string | undefined | null): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function trackerVehicleKey(vehicle: { tableId: string; recordId: string }): string {
  return `${vehicle.tableId}:${vehicle.recordId}`;
}

export function matchTrackerVehicle(
  records: TrackerVehicleSnapshot[],
  vehicle: { tableId: string; recordId: string; plate?: string; vehicleIdentificationNumber?: string }
): TrackerVehicleMatch {
  const base = { vehicleKey: trackerVehicleKey(vehicle), tableId: vehicle.tableId, recordId: vehicle.recordId };
  const vin = normalizeTrackerIdentifier(vehicle.vehicleIdentificationNumber);
  const plate = normalizeTrackerIdentifier(vehicle.plate);
  const plateMatches = plate ? records.filter((record) => normalizeTrackerIdentifier(record.registration) === plate) : [];
  if (plateMatches.length > 1) return { ...base, status: "pending_confirmation", reason: "duplicate_plate" };
  if (vin) {
    const byVin = records.filter((record) => normalizeTrackerIdentifier(record.vin) === vin);
    if (byVin.length > 1) return { ...base, status: "pending_confirmation", reason: "duplicate_vin" };
    if (byVin.length === 1) return { ...base, status: "matched", reason: "vin", snapshot: byVin[0] };
  }
  if (plateMatches.length === 1) {
    const trackerVin = normalizeTrackerIdentifier(plateMatches[0].vin);
    if (vin && trackerVin && vin !== trackerVin) return { ...base, status: "pending_confirmation", reason: "vin_conflict" };
    return { ...base, status: "matched", reason: "plate", snapshot: plateMatches[0] };
  }
  return { ...base, status: "unmatched", reason: "not_found" };
}

export function matchTrackerSnapshot(
  records: TrackerVehicleSnapshot[],
  vehicle: { plate?: string; vehicleIdentificationNumber?: string }
): TrackerVehicleSnapshot | undefined {
  return matchTrackerVehicle(records, { tableId: "", recordId: "", ...vehicle }).snapshot;
}

export class TrackerStatusStore {
  private readonly filePath: string;
  private cached: TrackerSyncState = { ...EMPTY_STATE };

  constructor(filePath = config.trackerStatusPath) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.cached = this.load();
  }

  private load(): TrackerSyncState {
    if (!fs.existsSync(this.filePath)) return { ...EMPTY_STATE };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TrackerSyncState>;
      return {
        ...EMPTY_STATE,
        ...parsed,
        version: 2,
        records: Array.isArray(parsed.records) ? parsed.records as TrackerVehicleSnapshot[] : [],
        refreshRequest: parsed.refreshRequest && typeof parsed.refreshRequest === "object" ? parsed.refreshRequest as TrackerRefreshRequest : null,
        audit: Array.isArray(parsed.audit) ? (parsed.audit as TrackerSyncAuditEntry[]).slice(-100) : []
      };
    } catch {
      return this.cached;
    }
  }

  read(): TrackerSyncState {
    this.cached = this.load();
    return this.cached;
  }

  writeAttempt(error?: string): TrackerSyncState {
    const current = this.read();
    return this.persist({ ...current, lastAttemptAt: new Date().toISOString(), lastError: error === undefined ? current.lastError : error });
  }

  writeSuccess(input: { records: TrackerVehicleSnapshot[]; reportCreatedAt: string | null; sourceHash: string; source?: "report" | "live"; completedRefreshRequestId?: string }): TrackerSyncState {
    const now = new Date().toISOString();
    const current = this.read();
    const source: TrackerSyncAuditEntry["source"] = input.source || "unknown";
    const completedRefresh = Boolean(input.completedRefreshRequestId && current.refreshRequest?.id === input.completedRefreshRequestId);
    return this.persist({
      ...current,
      version: 2,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: "",
      reportCreatedAt: input.reportCreatedAt,
      source,
      sourceHash: input.sourceHash,
      records: input.records,
      refreshRequest: completedRefresh ? null : current.refreshRequest,
      lastRefreshCompletedAt: completedRefresh ? now : current.lastRefreshCompletedAt,
      audit: [...current.audit, {
        attemptedAt: current.lastAttemptAt || now,
        completedAt: now,
        success: true,
        source,
        recordCount: input.records.length,
        sourceHash: input.sourceHash,
        error: ""
      }].slice(-100)
    });
  }

  writeFailure(error: string, completedRefreshRequestId?: string): TrackerSyncState {
    const now = new Date().toISOString();
    const current = this.read();
    const completedRefresh = Boolean(completedRefreshRequestId && current.refreshRequest?.id === completedRefreshRequestId);
    return this.persist({
      ...current,
      version: 2,
      lastAttemptAt: now,
      lastError: error,
      refreshRequest: completedRefresh ? null : current.refreshRequest,
      lastRefreshCompletedAt: completedRefresh ? now : current.lastRefreshCompletedAt,
      audit: [...current.audit, {
        attemptedAt: current.lastAttemptAt || now,
        completedAt: now,
        success: false,
        source: current.source,
        recordCount: current.records.length,
        sourceHash: current.sourceHash,
        error
      }].slice(-100)
    });
  }

  requestRefresh(requestedBy: string): TrackerSyncState {
    const current = this.read();
    if (current.refreshRequest) return current;
    return this.persist({
      ...current,
      refreshRequest: {
        id: crypto.randomUUID(),
        requestedAt: new Date().toISOString(),
        requestedBy: requestedBy.trim().slice(0, 120) || "administrator"
      }
    });
  }

  private persist(state: TrackerSyncState): TrackerSyncState {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    this.cached = state;
    return state;
  }
}
