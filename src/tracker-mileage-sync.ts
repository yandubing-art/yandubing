import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { LarkClient } from "./lark.js";
import { normalizeTrackerIdentifier } from "./tracker-status-store.js";
import { TrackerEmailReportStore } from "./tracker-email-report.js";
import type { ParsedTrackerCsvReport, TrackerCsvMileageRecord } from "./tracker-csv-report.js";
import type { VehicleProfile, VehicleSyncResult } from "./types.js";

export type TrackerMileageAuditStatus =
  | "updated"
  | "unchanged"
  | "lower_than_current"
  | "not_found"
  | "ambiguous"
  | "inconsistent_report"
  | "missing_mileage"
  | "missing_mileage_field"
  | "error";

export type TrackerMileageAuditRecord = {
  registration: string;
  normalizedRegistration: string;
  status: TrackerMileageAuditStatus;
  matchBy?: "tracker" | "vin" | "plate";
  tableId?: string;
  recordId?: string;
  plate?: string;
  currentMileage: number | null;
  reportMileage: number | null;
  message: string;
};

export type TrackerMileageSyncState = {
  version: 1;
  sourceHash: string | null;
  reportStart: string | null;
  reportEnd: string | null;
  completedAt: string | null;
  results: TrackerMileageAuditRecord[];
};

export type TrackerMileageSyncSummary = {
  status: "updated" | "unchanged" | "skipped";
  message: string;
  sourceHash?: string;
  reportStart?: string;
  reportEnd?: string;
  results: TrackerMileageAuditRecord[];
};

const EMPTY_STATE: TrackerMileageSyncState = {
  version: 1,
  sourceHash: null,
  reportStart: null,
  reportEnd: null,
  completedAt: null,
  results: []
};

export class TrackerMileageSyncStore {
  private readonly filePath: string;
  private cached: TrackerMileageSyncState;

  constructor(filePath = config.trackerMileageSyncStatePath) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.cached = this.load();
  }

  read(): TrackerMileageSyncState {
    this.cached = this.load();
    return this.cached;
  }

  write(report: ParsedTrackerCsvReport, results: TrackerMileageAuditRecord[]): TrackerMileageSyncState {
    return this.persist({
      version: 1,
      sourceHash: report.sourceHash,
      reportStart: report.reportStart,
      reportEnd: report.reportEnd,
      completedAt: new Date().toISOString(),
      results
    });
  }

  private load(): TrackerMileageSyncState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TrackerMileageSyncState>;
      return {
        ...EMPTY_STATE,
        ...parsed,
        version: 1,
        results: Array.isArray(parsed.results) ? parsed.results as TrackerMileageAuditRecord[] : []
      };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  private persist(state: TrackerMileageSyncState): TrackerMileageSyncState {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    this.cached = state;
    return state;
  }
}

function matchVehicle(registration: string, vehicles: VehicleProfile[]): { vehicle?: VehicleProfile; matchBy?: "tracker" | "vin" | "plate"; status: "matched" | "not_found" | "ambiguous"; message: string } {
  const key = normalizeTrackerIdentifier(registration);
  const find = (field: keyof Pick<VehicleProfile, "trackerRegistration" | "vehicleIdentificationNumber" | "plate">): VehicleProfile[] =>
    vehicles.filter((vehicle) => normalizeTrackerIdentifier(vehicle[field]) === key);
  const checks: Array<["tracker" | "vin" | "plate", keyof Pick<VehicleProfile, "trackerRegistration" | "vehicleIdentificationNumber" | "plate">, string]> = [
    ["tracker", "trackerRegistration", "Tracker 编号"],
    ["vin", "vehicleIdentificationNumber", "VIN"],
    ["plate", "plate", "车牌"]
  ];
  for (const [matchBy, field, label] of checks) {
    const matches = find(field);
    if (matches.length > 1) return { status: "ambiguous", matchBy, message: `${label} ${registration} 匹配到多条车辆档案` };
    if (matches.length === 1) return { status: "matched", matchBy, vehicle: matches[0], message: `按${label}匹配车辆档案` };
  }
  return { status: "not_found", message: `未找到 Tracker 报表标识 ${registration} 对应的车辆档案` };
}

function baseAudit(record: TrackerCsvMileageRecord): TrackerMileageAuditRecord {
  return {
    registration: record.registration,
    normalizedRegistration: record.normalizedRegistration,
    status: "error",
    currentMileage: null,
    reportMileage: record.odometerEnd,
    message: "未处理"
  };
}

function resultAudit(record: TrackerCsvMileageRecord, vehicle: VehicleProfile | undefined, result: VehicleSyncResult, matchBy?: "tracker" | "vin" | "plate"): TrackerMileageAuditRecord {
  const current = result.vehicle || vehicle;
  const status: TrackerMileageAuditStatus = result.status === "skipped" && !current?.currentMileageField
    ? "missing_mileage_field"
    : result.status === "lower_than_current" ? "lower_than_current"
      : result.status === "not_found" ? "not_found"
        : result.status === "ambiguous" ? "ambiguous"
          : result.status === "updated" ? "updated"
            : result.status === "unchanged" ? "unchanged"
              : "error";
  return {
    ...baseAudit(record),
    status,
    matchBy,
    tableId: current?.tableId,
    recordId: current?.recordId,
    plate: current?.plate,
    currentMileage: current?.mileage ?? null,
    message: result.message
  };
}

export async function syncTrackerMileageReport(
  lark: LarkClient,
  report: ParsedTrackerCsvReport,
  store = new TrackerMileageSyncStore(),
  options: { dryRun?: boolean } = {}
): Promise<TrackerMileageSyncSummary> {
  if (!config.trackerMileageSyncEnabled && !options.dryRun) {
    return { status: "skipped", message: "Tracker 报表公里数自动更新未启用", results: [] };
  }
  const previous = store.read();
  if (!options.dryRun && previous.sourceHash === report.sourceHash && previous.completedAt) {
    return { status: "unchanged", message: "该 Tracker 报表公里数已经处理过", sourceHash: report.sourceHash, reportStart: report.reportStart, reportEnd: report.reportEnd, results: previous.results };
  }

  const vehicles = await lark.listVehicles();
  const results: TrackerMileageAuditRecord[] = [];
  for (const record of report.records) {
    const audit = baseAudit(record);
    if (!record.odometerEndConsistent) {
      results.push({ ...audit, status: "inconsistent_report", message: "同一车辆在报表中的结束公里数不一致，未写回" });
      continue;
    }
    if (record.odometerEnd === null) {
      results.push({ ...audit, status: "missing_mileage", message: "报表没有结束公里数，未写回" });
      continue;
    }
    const match = matchVehicle(record.registration, vehicles);
    if (match.status !== "matched" || !match.vehicle) {
      results.push({ ...audit, status: match.status === "ambiguous" ? "ambiguous" : "not_found", matchBy: match.matchBy, message: match.message });
      continue;
    }
    if (!match.vehicle.currentMileageField) {
      results.push({ ...audit, status: "missing_mileage_field", matchBy: match.matchBy, tableId: match.vehicle.tableId, recordId: match.vehicle.recordId, plate: match.vehicle.plate, currentMileage: match.vehicle.mileage, message: `${match.vehicle.tableName} 尚未建立当前公里数字段，未写回` });
      continue;
    }
    if (match.vehicle.mileage !== null && record.odometerEnd < match.vehicle.mileage) {
      results.push({ ...audit, status: "lower_than_current", matchBy: match.matchBy, tableId: match.vehicle.tableId, recordId: match.vehicle.recordId, plate: match.vehicle.plate, currentMileage: match.vehicle.mileage, message: `Tracker 报表公里数 ${record.odometerEnd} 小于车辆档案当前公里数 ${match.vehicle.mileage}，未回退档案` });
      continue;
    }
    if (options.dryRun || match.vehicle.mileage === record.odometerEnd) {
      results.push({ ...audit, status: match.vehicle.mileage === record.odometerEnd ? "unchanged" : "updated", matchBy: match.matchBy, tableId: match.vehicle.tableId, recordId: match.vehicle.recordId, plate: match.vehicle.plate, currentMileage: match.vehicle.mileage, message: options.dryRun ? `预览：可将车辆档案公里数更新为 ${record.odometerEnd}` : "车辆档案公里数已经是最新值" });
      continue;
    }
    try {
      const result = await lark.syncTrackerReportMileage(match.vehicle, record.odometerEnd);
      results.push(resultAudit(record, match.vehicle, result, match.matchBy));
    } catch (error) {
      results.push({ ...audit, status: "error", matchBy: match.matchBy, tableId: match.vehicle.tableId, recordId: match.vehicle.recordId, plate: match.vehicle.plate, currentMileage: match.vehicle.mileage, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!options.dryRun) store.write(report, results);
  const counts = results.reduce<Record<string, number>>((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
  return {
    status: results.some((item) => item.status === "updated") ? "updated" : "unchanged",
    message: `${options.dryRun ? "Tracker 报表公里数匹配预览" : "Tracker 报表公里数同步完成"}：${JSON.stringify(counts)}`,
    sourceHash: report.sourceHash,
    reportStart: report.reportStart,
    reportEnd: report.reportEnd,
    results
  };
}

export async function syncStoredTrackerEmailMileage(
  lark: LarkClient,
  emailStore = new TrackerEmailReportStore(),
  mileageStore = new TrackerMileageSyncStore(),
  options: { dryRun?: boolean } = {}
): Promise<TrackerMileageSyncSummary> {
  const state = emailStore.read();
  if (!state.sourceHash || !state.reportStart || !state.reportEnd || !state.records.length) {
    return { status: "skipped", message: "没有可用于公里数匹配的已下载 Tracker 报表", results: [] };
  }
  return syncTrackerMileageReport(lark, { sourceHash: state.sourceHash, reportStart: state.reportStart, reportEnd: state.reportEnd, records: state.records }, mileageStore, options);
}
