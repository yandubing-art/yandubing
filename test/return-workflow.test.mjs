import assert from "node:assert/strict";
import test from "node:test";

const { LarkClient } = await import("../dist/lark.js");
const { config } = await import("../dist/config.js");

function returnClient({ failPhotos = false, failMileage = false } = {}) {
  const client = new LarkClient();
  const calls = [];
  client.getRecord = async () => ({ record_id: "task", fields: { [config.fields.vehicle]: "TEST123GP" } });
  client.attachPhotos = async () => {
    calls.push("photos");
    if (failPhotos) throw new Error("photo upload failed");
    return { recordId: "task", uploaded: 4, photoTime: "2026-09-28T00:00:00.000Z" };
  };
  client.findVehicle = async () => ({ status: "matched", vehicle: { plate: "TEST123GP", mileage: 100 } });
  client.syncVehicleMileage = async () => {
    calls.push("mileage");
    if (failMileage) throw new Error("mileage sync failed");
    return { status: "updated", matched: true, updated: true, vehicle: { plate: "TEST123GP", mileage: 120 } };
  };
  client.updateRecord = async (_recordId, fields) => { calls.push(["complete", fields]); };
  return { client, calls };
}

const photos = [{ position: "front", dataUrl: "data:image/jpeg;base64,AA==" }];
const complete = (client) => client.completeReturn("task", "Branch", "Warehouse", 120, "", {}, photos);

test("a failed return photo upload leaves the task open and mileage unchanged", async () => {
  const { client, calls } = returnClient({ failPhotos: true });
  await assert.rejects(complete(client), /photo upload failed/);
  assert.deepEqual(calls, ["photos"]);
});

test("a failed mileage sync leaves the return task open for retry", async () => {
  const { client, calls } = returnClient({ failMileage: true });
  await assert.rejects(complete(client), /mileage sync failed/);
  assert.deepEqual(calls, ["photos", "mileage"]);
});

test("return task completes after photos and mileage succeed", async () => {
  const { client, calls } = returnClient();
  const result = await complete(client);
  assert.deepEqual(calls.slice(0, 2), ["photos", "mileage"]);
  assert.equal(calls[2][0], "complete");
  assert.equal(calls[2][1][config.fields.status], "已完成");
  assert.equal(calls[2][1][config.fields.returnMileage], 120);
  assert.equal(result.vehicleSync.updated, true);
});
