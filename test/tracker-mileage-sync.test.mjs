import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.TRACKER_MILEAGE_SYNC_ENABLED = "true";
const { syncTrackerLiveMileage, syncTrackerMileageReport, TrackerMileageSyncStore } = await import("../dist/tracker-mileage-sync.js");
const { parseTrackerOdometer } = await import("../dist/tracker-live.js");

test("reads the total odometer shown on a Tracker vehicle detail card", () => {
  assert.equal(parseTrackerOdometer("5 691 km"), 5691);
  assert.equal(parseTrackerOdometer("5,691 km"), 5691);
  assert.equal(parseTrackerOdometer("Private - 893 km"), 893);
  assert.equal(parseTrackerOdometer(""), null);
});

test("automatically matches live Tracker mileage while protecting newer vehicle mileage and VIN", async () => {
  const vehicles = [
    { tableId: "company", recordId: "starlet", plate: "KZ18GMGP", trackerRegistration: "KZ18GMGP", vehicleIdentificationNumber: "JTDJWCA3S00252381", currentMileageField: "Maintenance mileage", mileage: null },
    { tableId: "company", recordId: "newer", plate: "NEWER", trackerRegistration: "NEWER", vehicleIdentificationNumber: "", currentMileageField: "Maintenance mileage", mileage: 7000 },
    { tableId: "company", recordId: "wrong-vin", plate: "WRONG", trackerRegistration: "WRONG", vehicleIdentificationNumber: "EXPECTED", currentMileageField: "Maintenance mileage", mileage: null }
  ];
  const writes = [];
  const lark = {
    listVehicles: async () => vehicles,
    syncTrackerReportMileage: async (vehicle, mileage) => {
      writes.push([vehicle.recordId, mileage]);
      return { status: "updated", vehicle: { ...vehicle, mileage } };
    }
  };
  const records = [
    { registration: "KZ18GMGP", vin: "JTDJWCA3S00252381", odometer: 5691 },
    { registration: "NEWER", vin: "", odometer: 6000 },
    { registration: "WRONG", vin: "DIFFERENT", odometer: 9000 }
  ];
  const result = await syncTrackerLiveMileage(lark, records);
  assert.deepEqual(result, { checked: 3, updated: 1, failed: 0 });
  assert.deepEqual(writes, [["starlet", 5691]]);
});

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

test("retries unmatched and missing-field rows after vehicle metadata is fixed", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-mileage-metadata-retry-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new TrackerMileageSyncStore(path.join(directory, "audit.json"));
  const report = {
    sourceHash: "same-csv-after-metadata-fix",
    reportStart: "2026-09-22T00:00:00.000Z",
    reportEnd: "2026-09-22T23:59:59.000Z",
    records: ["STORE-1", "MM72ZGGP"].map((registration) => ({
      registration,
      normalizedRegistration: registration,
      reportStart: "2026-09-22T00:00:00.000Z",
      reportEnd: "2026-09-22T23:59:59.000Z",
      odometerStart: 100,
      odometerEnd: 125,
      odometerEndConsistent: true,
      sourceRows: 1
    }))
  };
  store.write(report, report.records.map((record, index) => ({
    registration: record.registration,
    normalizedRegistration: record.normalizedRegistration,
    status: index === 0 ? "missing_mileage_field" : "not_found",
    currentMileage: null,
    reportMileage: record.odometerEnd,
    message: "previous metadata issue"
  })));

  const vehicles = report.records.map((record, index) => ({
    tableId: index === 0 ? "stores" : "company",
    tableName: index === 0 ? "Stores Vehicle" : "Company Vehicle",
    recordId: record.registration,
    plate: record.registration === "MM72ZGGP" ? "MM47ZGGP" : record.registration,
    trackerRegistration: record.registration,
    vehicleIdentificationNumber: "",
    currentMileageField: "Maintenance mileage",
    mileage: null
  }));
  const attempts = [];
  const lark = {
    listVehicles: async () => vehicles,
    syncTrackerReportMileage: async (vehicle, mileage) => {
      attempts.push(vehicle.recordId);
      return { status: "updated", vehicle: { ...vehicle, mileage }, message: "updated" };
    }
  };

  const result = await syncTrackerMileageReport(lark, report, store);
  assert.deepEqual(attempts, ["STORE-1", "MM72ZGGP"]);
  assert.deepEqual(result.results.map((item) => item.status), ["updated", "updated"]);
});
