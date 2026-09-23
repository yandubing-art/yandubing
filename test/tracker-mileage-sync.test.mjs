import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.TRACKER_MILEAGE_SYNC_ENABLED = "true";
const { syncTrackerMileageReport, TrackerMileageSyncStore } = await import("../dist/tracker-mileage-sync.js");

test("retries only failed rows from the same CSV and preserves successful audit rows", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-mileage-retry-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new TrackerMileageSyncStore(path.join(directory, "audit.json"));
  const vehicles = ["A", "B"].map((registration) => ({
    tableId: "vehicles",
    tableName: "Vehicles",
    recordId: registration,
    plate: registration,
    trackerRegistration: registration,
    vehicleIdentificationNumber: "",
    currentMileageField: "Mileage",
    mileage: 100
  }));
  const attempts = [];
  const lark = {
    listVehicles: async () => vehicles,
    syncTrackerReportMileage: async (vehicle, mileage) => {
      attempts.push(vehicle.recordId);
      if (vehicle.recordId === "B" && attempts.filter((id) => id === "B").length === 1) {
        throw new Error("temporary Lark failure");
      }
      return { status: "updated", vehicle: { ...vehicle, mileage }, message: "updated" };
    }
  };
  const report = {
    sourceHash: "same-csv",
    reportStart: "2026-09-23T00:00:00.000Z",
    reportEnd: "2026-09-23T23:59:59.000Z",
    records: ["A", "B"].map((registration) => ({
      registration,
      normalizedRegistration: registration,
      reportStart: "2026-09-23T00:00:00.000Z",
      reportEnd: "2026-09-23T23:59:59.000Z",
      odometerStart: 100,
      odometerEnd: 125,
      odometerEndConsistent: true,
      sourceRows: 1
    }))
  };

  const first = await syncTrackerMileageReport(lark, report, store);
  assert.equal(first.status, "partial");
  assert.deepEqual(first.results.map((result) => result.status), ["updated", "error"]);

  const second = await syncTrackerMileageReport(lark, report, store);
  assert.equal(second.status, "updated");
  assert.deepEqual(second.results.map((result) => result.status), ["updated", "updated"]);
  assert.deepEqual(attempts, ["A", "B", "B"]);

  const third = await syncTrackerMileageReport(lark, report, store);
  assert.equal(third.status, "unchanged");
  assert.deepEqual(attempts, ["A", "B", "B"]);
});
