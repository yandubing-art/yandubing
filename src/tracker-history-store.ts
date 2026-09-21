import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { normalizeTrackerIdentifier, type TrackerVehicleSnapshot } from "./tracker-status-store.js";

export type TrackerHistoryEntry = TrackerVehicleSnapshot & {
  id: string;
  recordedAt: string;
};

type TrackerHistoryIndex = {
  version: 1;
  latest: Record<string, { fingerprint: string; trackerTimestamp: string }>;
};

export type TrackerHistoryQuery = {
  from: Date;
  to: Date;
  order: "asc" | "desc";
  limit: number;
  offset: number;
  query?: string;
  status?: string;
  allowedRegistrations?: Set<string>;
  allowedVins?: Set<string>;
  selectedRegistrations?: Set<string>;
  selectedVins?: Set<string>;
};

export type TrackerHistoryQueryResult = {
  entries: TrackerHistoryEntry[];
  hasMore: boolean;
  nextOffset: number | null;
  routeLocations: string[];
  routePointCount: number;
  retentionDays: number;
  availableFrom: string;
};

const INDEX_FILE = "index.json";
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.ndjson$/;

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function snapshotFingerprint(snapshot: TrackerVehicleSnapshot): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    registration: normalizeTrackerIdentifier(snapshot.registration),
    alias: snapshot.alias || "",
    vin: normalizeTrackerIdentifier(snapshot.vin),
    odometer: snapshot.odometer,
    location: snapshot.location || "",
    trackerTimestamp: snapshot.trackerTimestamp,
    status: snapshot.status || ""
  })).digest("hex");
}

function identityMatches(entry: TrackerHistoryEntry, registrations?: Set<string>, vins?: Set<string>): boolean {
  if (!registrations && !vins) return true;
  const registration = normalizeTrackerIdentifier(entry.registration);
  const vin = normalizeTrackerIdentifier(entry.vin);
  return Boolean((registrations?.has(registration)) || (vin && vins?.has(vin)));
}

function sampleLocations(entries: TrackerHistoryEntry[], maximum = 10): { locations: string[]; pointCount: number } {
  const locations: string[] = [];
  for (const entry of [...entries].sort((left, right) => Date.parse(left.trackerTimestamp) - Date.parse(right.trackerTimestamp))) {
    const location = entry.location.trim();
    if (location && locations.at(-1)?.toLowerCase() !== location.toLowerCase()) locations.push(location);
  }
  if (locations.length <= maximum) return { locations, pointCount: locations.length };
  const sampled = Array.from({ length: maximum }, (_, index) => locations[Math.round(index * (locations.length - 1) / (maximum - 1))]);
  return { locations: sampled.filter((location, index) => index === 0 || location !== sampled[index - 1]), pointCount: locations.length };
}

function preferHistoryEntry(current: TrackerHistoryEntry, candidate: TrackerHistoryEntry): TrackerHistoryEntry {
  const currentNumbered = /\s*[（(]\s*\d+\s*[）)]\s*$/.test(current.registration);
  const candidateNumbered = /\s*[（(]\s*\d+\s*[）)]\s*$/.test(candidate.registration);
  return currentNumbered && !candidateNumbered ? candidate : current;
}

export class TrackerHistoryStore {
  private readonly directory: string;
  private readonly retentionDays: number;
  private readonly indexPath: string;
  private index: TrackerHistoryIndex;

  constructor(directory = config.trackerHistoryDirectory, retentionDays = config.trackerHistoryRetentionDays) {
    this.directory = path.resolve(directory);
    this.retentionDays = Math.max(1, Math.min(365, Math.trunc(retentionDays)));
    this.indexPath = path.join(this.directory, INDEX_FILE);
    fs.mkdirSync(this.directory, { recursive: true });
    this.index = this.loadIndex();
  }

  appendSnapshots(snapshots: TrackerVehicleSnapshot[], recordedAt = new Date()): number {
    this.prune(recordedAt);
    const cutoff = recordedAt.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    const grouped = new Map<string, TrackerHistoryEntry[]>();
    let appended = 0;
    for (const snapshot of snapshots) {
      const registration = normalizeTrackerIdentifier(snapshot.registration);
      const timestamp = Date.parse(snapshot.trackerTimestamp);
      if (!registration || !snapshot.location?.trim() || !Number.isFinite(timestamp) || timestamp < cutoff) continue;
      const fingerprint = snapshotFingerprint(snapshot);
      if (this.index.latest[registration]?.fingerprint === fingerprint) continue;
      const entry: TrackerHistoryEntry = {
        ...snapshot,
        id: fingerprint.slice(0, 24),
        recordedAt: recordedAt.toISOString()
      };
      const key = dayKey(timestamp);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(entry);
      this.index.latest[registration] = { fingerprint, trackerTimestamp: snapshot.trackerTimestamp };
      appended += 1;
    }
    for (const [key, entries] of grouped) {
      fs.appendFileSync(path.join(this.directory, `${key}.ndjson`), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
    }
    if (appended) this.persistIndex();
    return appended;
  }

  async query(options: TrackerHistoryQuery): Promise<TrackerHistoryQueryResult> {
    const from = Math.max(options.from.getTime(), Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const to = Math.min(options.to.getTime(), Date.now());
    const selected = Boolean(options.selectedRegistrations || options.selectedVins);
    const files = this.filesBetween(from, to);
    const keyword = options.query?.trim().toLowerCase() || "";
    const status = options.status?.trim().toLowerCase() || "";
    const selectedEntries: TrackerHistoryEntry[] = [];
    const pageEntries: TrackerHistoryEntry[] = [];
    let matched = 0;
    let hasMore = false;
    const orderedFiles = options.order === "desc" ? [...files].reverse() : files;

    for (const filePath of orderedFiles) {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const dayEntries = raw.split(/\r?\n/).flatMap((line) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as TrackerHistoryEntry]; } catch { return []; }
      }).filter((entry) => {
        const timestamp = Date.parse(entry.trackerTimestamp);
        if (!Number.isFinite(timestamp) || timestamp < from || timestamp > to) return false;
        if (!identityMatches(entry, options.allowedRegistrations, options.allowedVins)) return false;
        if (!identityMatches(entry, options.selectedRegistrations, options.selectedVins)) return false;
        if (status && !String(entry.status || "").toLowerCase().includes(status)) return false;
        if (!keyword) return true;
        return [entry.registration, entry.alias, entry.vin, entry.location, entry.status]
          .some((value) => String(value || "").toLowerCase().includes(keyword));
      }).sort((left, right) => Date.parse(left.trackerTimestamp) - Date.parse(right.trackerTimestamp));
      const uniqueEntries = new Map<string, TrackerHistoryEntry>();
      for (const entry of dayEntries) {
        const key = `${normalizeTrackerIdentifier(entry.registration)}|${entry.trackerTimestamp}`;
        const previous = uniqueEntries.get(key);
        uniqueEntries.set(key, previous ? preferHistoryEntry(previous, entry) : entry);
      }
      dayEntries.splice(0, dayEntries.length, ...uniqueEntries.values());
      if (options.order === "desc") dayEntries.reverse();

      for (const entry of dayEntries) {
        if (selected) selectedEntries.push(entry);
        if (matched >= options.offset && pageEntries.length < options.limit) pageEntries.push(entry);
        else if (matched >= options.offset + options.limit) hasMore = true;
        matched += 1;
        if (!selected && hasMore) break;
      }
      if (!selected && hasMore) break;
    }

    const route = selected ? sampleLocations(selectedEntries) : { locations: [], pointCount: 0 };
    return {
      entries: pageEntries,
      hasMore,
      nextOffset: hasMore ? options.offset + pageEntries.length : null,
      routeLocations: route.locations,
      routePointCount: route.pointCount,
      retentionDays: this.retentionDays,
      availableFrom: new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  private filesBetween(from: number, to: number): string[] {
    const fromKey = dayKey(from);
    const toKey = dayKey(to);
    return fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && DAY_FILE.test(entry.name))
      .filter((entry) => entry.name.slice(0, 10) >= fromKey && entry.name.slice(0, 10) <= toKey)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => path.join(this.directory, entry.name));
  }

  private prune(now: Date): void {
    const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffKey = dayKey(cutoff);
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !DAY_FILE.test(entry.name)) continue;
      const fileKey = entry.name.slice(0, 10);
      const filePath = path.join(this.directory, entry.name);
      if (fileKey < cutoffKey) {
        fs.rmSync(filePath, { force: true });
        continue;
      }
      if (fileKey !== cutoffKey) continue;
      const retained = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => {
        if (!line.trim()) return false;
        try {
          const timestamp = Date.parse((JSON.parse(line) as TrackerHistoryEntry).trackerTimestamp);
          return Number.isFinite(timestamp) && timestamp >= cutoff;
        } catch {
          return false;
        }
      });
      if (!retained.length) {
        fs.rmSync(filePath, { force: true });
        continue;
      }
      const temporaryPath = `${filePath}.${process.pid}.prune.tmp`;
      fs.writeFileSync(temporaryPath, `${retained.join("\n")}\n`, "utf8");
      fs.renameSync(temporaryPath, filePath);
    }

    let indexChanged = false;
    for (const [registration, latest] of Object.entries(this.index.latest)) {
      const timestamp = Date.parse(latest.trackerTimestamp);
      if (Number.isFinite(timestamp) && timestamp >= cutoff) continue;
      delete this.index.latest[registration];
      indexChanged = true;
    }
    if (indexChanged) this.persistIndex();
  }

  private loadIndex(): TrackerHistoryIndex {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as Partial<TrackerHistoryIndex>;
      return { version: 1, latest: parsed.latest && typeof parsed.latest === "object" ? parsed.latest : {} };
    } catch {
      return { version: 1, latest: {} };
    }
  }

  private persistIndex(): void {
    const temporaryPath = `${this.indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.index, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.indexPath);
  }
}
