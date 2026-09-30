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
    { name: "Number Plate", type: 1, options: [] },
    { name: "Model", type: 1, options: [] },
    { name: "Vehicle Brand", type: 3, options: ["Toyota | 丰田", "Ford | 福特"] },
    { name: "Vehicle Type", type: 3, options: ["HATCH BACK", "SUV"] },
    { name: "Vehicle Status", type: 3, options: ["In Use", "Sold"] },
    { name: "Department", type: 3, options: [ownerOption, "Warehouse | 仓库部"] },
    { name: "Registering authority", type: 3, options: ["Pretoria"] },
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

test("every edited vehicle single-select field is sent as one string", async () => {
  const client = clientForSave();
  client.listVehicles = async () => [{ ...vehicle, registeringAuthorityField: "Registering authority" }];
  let written;
  client.updateRecord = async (recordId, fields) => {
    written = fields;
    return { record_id: recordId, fields };
  };
  await client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, {
    ...input,
    brand: "Ford | 福特", vehicleType: "SUV", status: "Sold",
    owner: "Warehouse | 仓库部", registeringAuthority: "Pretoria", insurance: "NO"
  });
  for (const [field, expected] of Object.entries({
    "Vehicle Brand": "Ford | 福特", "Vehicle Type": "SUV", "Vehicle Status": "Sold",
    Department: "Warehouse | 仓库部", "Registering authority": "Pretoria", Insurance: "NO"
  })) {
    assert.equal(written[field], expected, field);
  }
});

test("a multi-select field keeps the array shape", async () => {
  const client = clientForSave();
  const definitions = await client.listVehicleFieldsWithOptions();
  definitions.find((field) => field.name === "Insurance").type = 4;
  client.listVehicleFieldsWithOptions = async () => definitions;
  let written;
  client.updateRecord = async (recordId, fields) => {
    written = fields;
    return { record_id: recordId, fields };
  };
  await client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, { ...input, insurance: "YES" });
  assert.deepEqual(written.Insurance, ["YES"]);
});

test("new vehicle creation and sold action use the same select encoding", async () => {
  const client = clientForSave();
  client.resolveVehicleTables = async () => [{ tableId: "company", tableName: "Company Vehicle" }];
  let created;
  client.request = async (_path, init) => {
    created = JSON.parse(init.body).fields;
    return { record: { record_id: "created", fields: created } };
  };
  client.listVehicles = async () => [{ ...vehicle, recordId: "created" }];
  await client.createVehicleProfile("company", { ...input, brand: "Ford | 福特", status: "Sold", insurance: "YES" });
  assert.equal(created["Vehicle Brand"], "Ford | 福特");
  assert.equal(created["Vehicle Status"], "Sold");
  assert.equal(created.Insurance, "YES");

  client.listVehicles = async () => [vehicle];
  let sold;
  client.updateRecord = async (_recordId, fields) => {
    sold = fields;
    return { record_id: vehicle.recordId, fields };
  };
  await client.markVehicleSold(vehicle.tableId, vehicle.recordId);
  assert.equal(sold[vehicle.statusField], "Sold");
});

test("an invalid select is rejected before uploading the document", async () => {
  const client = clientForSave();
  client.addVehicleAttachment = async () => { throw new Error("upload should not start"); };
  await assert.rejects(client.updateVehicleProfile(vehicle.tableId, vehicle.recordId, {
    ...input, brand: "Other", logBookDocument: { fileName: "0003_001.pdf", dataUrl: "data:application/pdf;base64,AA==" }
  }), /Vehicle Brand.*不在当前车辆表/);
});
