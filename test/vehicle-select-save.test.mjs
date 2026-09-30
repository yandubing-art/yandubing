import assert from "node:assert/strict";
import test from "node:test";

const { LarkClient } = await import("../dist/lark.js");

const ownerOption = "Operations\u200b\u200b | \u200b\u200b运营部\u200b";
const vehicle = {
  tableId: "company", recordId: "vehicle-1", tableName: "Company Vehicle",
  plate: "KZ18GMGP", plateField: "Number Plate",
  model: "Corolla", modelField: "Model",
  brand: "Toyota | 丰田", brandField: "Vehicle Brand",
  vehicleType: "HATCH BACK", typeField: "Vehicle Type",
  status: "In Use", statusField: "Vehicle Status",
  owner: ownerOption, ownerField: "Department",
  year: "", yearField: "",
  registeringAuthority: "", registeringAuthorityField: "",
  trackerRegistration: "", trackerRegistrationField: "",
  insurance: "", insuranceField: "Insurance",
  mileage: null, nextMaintenanceMileage: null, nextMaintenanceDate: "",
  logBookAttachments: [], logBookField: "log book",
  dateFieldNames: [], photoFieldConfigured: false
};

const input = {
  plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model,
  vehicleType: vehicle.vehicleType, status: vehicle.status,
  owner: "Operations | 运营部", year: "", registeringAuthority: "",
  lastServiceDate: "", serviceProvider: "", spareKey: "", registerNumber: "",
  vehicleIdentificationNumber: "", trackerRegistration: "", certificateExpiry: "",
  policyNumber: "", insurance: "", fnbFleetCard: "",
  mileage: null, nextMaintenanceMileage: null, nextMaintenanceDate: ""
};

function clientForSave() {
  const client = new LarkClient();
  client.listVehicles = async () => [vehicle];
  client.listVehicleFieldsWithOptions = async () => [
    { name: "Vehicle Brand", type: 3, options: ["Toyota | 丰田", "Ford | 福特"] },
    { name: "Vehicle Type", type: 3, options: ["HATCH BACK"] },
    { name: "Vehicle Status", type: 3, options: ["In Use"] },
    { name: "Department", type: 3, options: [ownerOption] },
    { name: "Insurance", type: 3, options: ["YES", "NO"] }
  ];
  return client;
}

test("saving a document does not rewrite a visually unchanged select option", async () => {
  const client = clientForSave();
  let written;
  client.addVehicleAttachment = async (fields, fieldName) => { fields[fieldName] = [{ file_token: "pdf-token", name: "0003_001.pdf" }]; };
  client.updateRecord = async (recordId, fields) => {
    written = fields;
    return { record_id: recordId, fields };
  };
  await client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, {
    ...input, logBookDocument: { fileName: "0003_001.pdf", dataUrl: "data:application/pdf;base64,AA==" }
  });
  assert.equal(written.Department, undefined);
  assert.deepEqual(written[vehicle.logBookField], [{ file_token: "pdf-token", name: "0003_001.pdf" }]);
});

test("a changed select writes the exact option stored in the target table", async () => {
  const client = clientForSave();
  let written;
  client.updateRecord = async (recordId, fields) => {
    written = fields;
    return { record_id: recordId, fields };
  };
  await client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, { ...input, brand: "Ford | 福特" });
  assert.equal(written[vehicle.brandField], "Ford | 福特");
  assert.equal(written.Department, undefined);
});

test("insurance status uses the raw API single-select string format", async () => {
  const client = clientForSave();
  let written;
  client.updateRecord = async (recordId, fields) => {
    written = fields;
    return { record_id: recordId, fields: { ...fields, Insurance: [fields.Insurance] } };
  };
  await client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, { ...input, insurance: "YES" });
  assert.equal(written.Insurance, "YES");
  assert.equal(written.Department, undefined);
});

test("an invalid select is rejected before uploading the document", async () => {
  const client = clientForSave();
  client.addVehicleAttachment = async () => { throw new Error("upload should not start"); };
  await assert.rejects(client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, {
    ...input, brand: "Other", logBookDocument: { fileName: "0003_001.pdf", dataUrl: "data:application/pdf;base64,AA==" }
  }), /Vehicle Brand.*不在当前车辆表/);
});
