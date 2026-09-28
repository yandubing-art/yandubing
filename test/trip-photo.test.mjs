import assert from "node:assert/strict";
import test from "node:test";

const { LarkClient } = await import("../dist/lark.js");
const { config } = await import("../dist/config.js");

const record = {
  record_id: "task-1",
  fields: {
    [config.fields.departurePhotos]: [{ name: "front.jpg", file_token: "front-token", tmp_url: "https://expired.example/front.jpg" }],
    [config.fields.returnPhotos]: [{ name: "return.jpg", file_token: "return-token" }]
  }
};

test("task photo download uses the attached file token and Base field", async () => {
  const client = new LarkClient();
  client.getRecord = async () => { throw new Error("record should be reused"); };
  client.downloadVehicleMedia = async (...args) => {
    assert.deepEqual(args.slice(0, 5), [config.bitableTableId, "task-1", config.fields.departurePhotos, "front-token", "front.jpg"]);
    return { fileName: "front.jpg", mimeType: "image/jpeg", content: Buffer.from([0xff, 0xd8]) };
  };
  const file = await client.downloadTaskPhoto("task-1", "departure", "front-token", record);
  assert.equal(file.mimeType, "image/jpeg");
});

test("task photo download rejects tokens absent from the requested phase", async () => {
  const client = new LarkClient();
  client.downloadVehicleMedia = async () => { throw new Error("must not download an unrelated attachment"); };
  await assert.rejects(client.downloadTaskPhoto("task-1", "return", "front-token", record), { statusCode: 404 });
  await assert.rejects(client.downloadTaskPhoto("task-1", "departure", "unknown-token", record), { statusCode: 404 });
});
