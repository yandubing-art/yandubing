import { config } from "./config.js";
import { attachmentValues, numberValue, textValue } from "./value.js";
import type { BitableRecord, PhotoUpload, StoreOption, UserOption, VehicleMatchResult, VehicleProfile, VehicleSyncResult } from "./types.js";
type NotificationTarget = { type: "user" | "chat"; id: string; label: string };

type LarkEnvelope<T> = {
  code?: number;
  msg?: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
};

// Kept in the same order as the Store table, so the local preview matches the
// fixed source/destination choices used in the production application.
const previewStoreNames = [
  "DH Discount Hyper", "VC02 PMB", "VC05 Mall@Reds", "VC07 The Glen", "VC08 Northgate",
  "VC10 Cradlestone", "VC11 Parow Center", "VC12 Bayside Mall", "VC13 Watercrest Mall",
  "VC14 Mimosa Mall", "VC15 Baywest Mall", "VC16 Longbeach Mall", "VC17 Tygervalley",
  "VC18 Eastgate", "VC19 Riverside Mall", "VC20 Bester Brown", "VC21 City View",
  "VC22 Pavillion Mall", "VC23 Oudtshoorn", "VC24 Menlyn", "VC25 Fourways", "VC26 Rivonia",
  "VC27 Centurion Mall", "VC28 Clearwater Mall", "VC29 Boulders", "VC30 Wonderboom",
  "VCL01 Randburg", "VCL02 Centurion",
  "VCL03 Alberton", "VCL04 Vaal", "VCL05 Boksburg", "VCL06 Atterbury", "VCL07 Secunda",
  "VCL08 North Rand", "VCL09 Somerset", "VCL10 Blueberry", "VCL11 Polofields", "VCL12 Reef",
  "VCL13 Irene Links", "VCL14 Brackenfell", "VCL15 Ryneveld", "VCL16 Horizon",
  "VCL17 Randfontein", "VCL18 Harvest", "VCL19 Bethlehem", "VCL20 Lambton Gardens",
  "VCL21 Comaro", "VCL22 Randsteam", "VCL23 Waterfall", "Warehouse", "宿舍"
];

type RecordListData = {
  items?: BitableRecord[];
  has_more?: boolean;
  page_token?: string;
};

type TableListData = {
  items?: Array<{ table_id?: string; name?: string }>;
  has_more?: boolean;
  page_token?: string;
};

type RecordData = {
  record?: BitableRecord;
};

type FieldListData = {
  items?: Array<{
    field_id?: string;
    id?: string;
    field_name?: string;
    type?: number | string;
    multiple?: boolean;
    options?: Array<{ name?: string }>;
    property?: { options?: Array<{ name?: string }>; multiple?: boolean };
  }>;
  has_more?: boolean;
  page_token?: string;
};

export type VehicleFieldOptions = {
  brand: string[];
  model: string[];
  type: string[];
  status: string[];
  owner: string[];
  registeringAuthority: string[];
  insurance: string[];
};

export type VehicleFieldDefinition = {
  key: keyof VehicleFieldOptions;
  tableId: string;
  tableName: string;
  fieldId: string;
  fieldName: string;
  type: "select" | "text" | string;
  multiple: boolean;
  options: string[];
};

export type VehicleFieldDefinitions = {
  tables: Array<{
    tableId: string;
    tableName: string;
    fields: VehicleFieldDefinition[];
  }>;
};

type BaseFieldData = { field?: Record<string, unknown> };

type UserListData = {
  items?: Array<{
    open_id?: string;
    name?: string;
    en_name?: string;
    nickname?: string;
    avatar?: { avatar_72?: string };
    department_ids?: string[];
    status?: { is_frozen?: boolean; is_resigned?: boolean; is_exited?: boolean; is_activated?: boolean };
  }>;
  has_more?: boolean;
  page_token?: string;
};

type DepartmentListData = {
  items?: Array<{ open_department_id?: string; department_id?: string; name?: string; i18n_name?: Record<string, string> }>;
  has_more?: boolean;
  page_token?: string;
};

type ChatSearchData = {
  items?: Array<{ id?: string; meta_data?: { chat_id?: string; name?: string; chat_status?: string } }>;
};

type MediaData = { file_token?: string; name?: string; size?: number; tmp_url?: string; type?: string };

type VehicleTable = { tableId: string; tableName: string };

type VehicleProfileInput = {
  plate: string;
  brand: string;
  model: string;
  vehicleType: string;
  status: string;
  owner: string;
  year: string;
  registeringAuthority: string;
  lastServiceDate: string;
  serviceProvider: string;
  spareKey: string;
  registerNumber: string;
  vehicleIdentificationNumber: string;
  trackerRegistration: string;
  certificateExpiry: string;
  logBookDocument?: { fileName: string; dataUrl: string };
  policyNumber: string;
  insurance: string;
  fnbFleetCard: string;
  mileage: number | null;
  nextMaintenanceMileage: number | null;
  nextMaintenanceDate: string;
  photoDataUrl?: string;
  fleetCardPhotoDataUrl?: string;
};

function lookupKey(value: string): string {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function configuredTableNameMatches(actualName: string, configuredName: string): boolean {
  const actual = lookupKey(actualName);
  const configured = lookupKey(configuredName);
  if (!actual || !configured) return false;
  return actual === configured || actual.startsWith(`${configured}|`) || actual.startsWith(`${configured}:`);
}

function vehicleKey(value: unknown): string {
  return textValue(value).toUpperCase().replace(/[\s\-_./]/g, "");
}

function findField(fields: Record<string, unknown>, names: readonly string[]): { name: string; value: unknown } | undefined {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return { name, value: fields[name] };
  }

  const normalized = new Map(Object.keys(fields).map((name) => [lookupKey(name), name]));
  for (const name of names) {
    const actualName = normalized.get(lookupKey(name));
    if (actualName) return { name: actualName, value: fields[actualName] };
  }
  return undefined;
}

function dateInputValue(value: unknown): string {
  const text = textValue(value).trim();
  if (!text) return "";
  const datePrefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePrefix) return datePrefix[1];
  const numeric = Number(text);
  // Empty DateTime cells in some Base tables are returned as 0. They are not
  // Unix epoch dates and must never appear in the editor as 1970-01-01.
  if (Number.isFinite(numeric) && numeric <= 0) return "";
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function dateTimeCellValue(value: string): number | string {
  const date = value.trim();
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00+02:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.getTime();
}

function fieldWriteConfirmed(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") {
    return numberValue(actual) === expected || dateInputValue(actual) === dateInputValue(expected);
  }
  return textValue(actual).trim() === textValue(expected).trim();
}

function dateTimeTimestamp(value: string): number | string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.getTime();
}

function vehicleDescription(brand: string, model: string, vehicleType: string): string {
  return [brand, model, vehicleType].filter(Boolean).join(" · ");
}

function dispatchEligibility(plate: string, model: string, status: string): boolean {
  if (!plate.trim() || !model.trim()) return false;
  const haystack = lookupKey([plate, model, status].join(" "));
  return !config.vehicleInactiveKeywords.some((keyword) => haystack.includes(lookupKey(keyword)));
}

function fieldTypeName(type: unknown): string {
  if (typeof type === "string") return type.toLowerCase() === "single_select" || type.toLowerCase() === "multi_select" ? "select" : type.toLowerCase();
  if (type === 3 || type === 4) return "select";
  if (type === 1) return "text";
  return String(type ?? "unknown");
}

function fieldOptionObjects(field: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = Array.isArray(field.options) ? field.options : null;
  const property = field.property && typeof field.property === "object" && !Array.isArray(field.property)
    ? field.property as Record<string, unknown>
    : null;
  const nested = property && Array.isArray(property.options) ? property.options : null;
  const source = direct || nested || [];
  return source.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function fieldOptionNames(field: Record<string, unknown>): string[] {
  return fieldOptionObjects(field).map((option) => textValue(option.name)).map((name) => name.trim()).filter(Boolean);
}

function vehicleFieldKey(fieldName: string): keyof VehicleFieldOptions | null {
  const matches: Array<[keyof VehicleFieldOptions, readonly string[]]> = [
    ["brand", config.vehicleFields.brand],
    ["model", config.vehicleFields.model],
    ["type", config.vehicleFields.type],
    ["status", config.vehicleFields.status],
    ["owner", config.vehicleFields.owner],
    ["registeringAuthority", config.vehicleFields.registeringAuthority],
    ["insurance", config.vehicleFields.insurance]
  ];
  for (const [key, names] of matches) if (names.some((name) => lookupKey(name) === lookupKey(fieldName))) return key;
  return null;
}

type CacheEntry<T> = {
  value?: T;
  expiresAt: number;
  staleUntil: number;
  pending?: Promise<T>;
};

export class LarkClient {
  private tenantAccessToken = "";
  private accessTokenExpiresAt = 0;
  private usersCache: CacheEntry<UserOption[]> = { expiresAt: 0, staleUntil: 0 };
  private vehiclesCache: CacheEntry<VehicleProfile[]> = { expiresAt: 0, staleUntil: 0 };
  private storesCache: CacheEntry<StoreOption[]> = { expiresAt: 0, staleUntil: 0 };
  private vehicleFieldOptionsCache: CacheEntry<VehicleFieldOptions> = { expiresAt: 0, staleUntil: 0 };

  constructor(private readonly photoSyncAccessToken?: () => Promise<string>) {}

  private invalidateVehiclesCache(): void {
    this.vehiclesCache.expiresAt = 0;
    this.vehiclesCache.staleUntil = 0;
  }
  private previewRecords: BitableRecord[] = [
    {
      record_id: "rec_preview_001",
      fields: {
        "任务编号": "20260907001",
        "申请人": [{ id: "ou_preview_001", name: "Dane" }],
        "出发时间": "2099-09-07T09:00:00+02:00",
        "起点": "ValueCo 总部",
        "目的地": "Sandton City",
        "车辆": "MN48PXGP",
        "行程阶段": "出发前",
        "当前公里数": 120500,
        "下次保养公里数": 125000,
        "保养提醒": "正常",
        "调度状态": "待调度",
        "执行结果": "",
        "错误信息": ""
      }
    },
    {
      record_id: "rec_preview_002",
      fields: {
        "任务编号": "20260907002",
        "申请人": [{ id: "ou_preview_002", name: "Mpho" }],
        "出发时间": "2099-09-07T10:30:00+02:00",
        "起点": "Cape Town Office",
        "目的地": "Airport",
        "车辆": "NB30KTGP",
        "当前公里数": 128600,
        "下次保养公里数": 125000,
        "保养提醒": "需要保养",
        "调度状态": "已排程",
        "自建应用任务ID": "dispatch_preview_002",
        "执行结果": "已进入后端调度队列",
        "错误信息": ""
      }
    },
    {
      record_id: "rec_preview_003",
      fields: {
        "任务编号": "20260907003",
        "申请人": [{ id: "ou_preview_003", name: "Thandi" }],
        "出发时间": "2099-09-07T13:00:00+02:00",
        "起点": "Store 01",
        "目的地": "Warehouse",
        "车辆": "LZ35LPGP",
        "当前公里数": 100000,
        "下次保养公里数": 105000,
        "保养提醒": "正常",
        "调度状态": "已完成",
        "自建应用任务ID": "dispatch_preview_003",
        "执行结果": "车辆已派出",
        "错误信息": ""
      }
    },
    {
      record_id: "rec_preview_004",
      fields: {
        "任务编号": "20260907004",
        "申请人": [{ id: "ou_preview_004", name: "Lebo" }],
        "出发时间": "2099-09-07T15:30:00+02:00",
        "起点": "Store 02",
        "目的地": "Pretoria",
        "车辆": "JB61PDGP",
        "当前公里数": 152000,
        "下次保养公里数": 150000,
        "保养提醒": "超期保养",
        "调度状态": "失败",
        "自建应用任务ID": "dispatch_preview_004",
        "执行结果": "调度执行器调用失败",
        "错误信息": "预览示例：执行器暂时不可用"
      }
    }
  ];

  // Mirrors the authorised Company Vehicle table.  Empty values deliberately
  // stay empty: they are shown as information to complete, rather than being
  // guessed from a model name or a VIN.
  private readonly previewVehicleTables: Array<VehicleTable & { records: BitableRecord[] }> = [
    {
      tableId: "tbl_preview_company_vehicle",
      tableName: "Company Vehicle",
      records: [
        { record_id: "rec_vehicle_001", fields: { "Number Plate | 车牌号码": "MN48PXGP", "Register number | 注册号": "BPV069X", "Vehicle identification number | 车辆ID": "W1V44781323705835", "Vehicle Brand | 车辆品牌": "MERCEDES-BENZ | 奔驰", "Model | 车型": "V260d", "Vehicle Type | 车辆类型": "Mini bus", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "Department | 所属部门": "Operations | 运营部", "log book | 车辆登记证书": [], "Fleet card picture": [] } },
        { record_id: "rec_vehicle_002", fields: { "Number Plate | 车牌号码": "NB30KTGP", "Register number | 注册号": "GFB016L", "Vehicle identification number | 车辆ID": "AHTBB0JE700012310", "Vehicle Brand | 车辆品牌": "Toyota | 丰田", "Model | 车型": "Corolla", "Vehicle Type | 车辆类型": "Sedan", "Vehicle Status | 车辆状态": "In Use", "FNB Fleet Card": "7080488588100018019", "Year | 年份": "2015-10-01", "Certificate Expiry | 证书有效期": "2027-03-31", "Department | 所属部门": "Operations | 运营部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_003", fields: { "Number Plate | 车牌号码": "NC91CVGP", "Register number | 注册号": "JMX605K", "Vehicle identification number | 车辆ID": "WV2ZZZSKZNX031334", "Vehicle Brand | 车辆品牌": "Volkswagen | 大众", "Model | 车型": "CADDY KOMBI 2.0TDi", "Vehicle Type | 车辆类型": "(7 SEAT)", "Vehicle Status | 车辆状态": "In Use", "Insurance": "yes", "Year | 年份": "2022", "Department | 所属部门": "Operations | 运营部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_004", fields: { "Number Plate | 车牌号码": "", "Register number | 注册号": "KCS631K", "Vehicle identification number | 车辆ID": "WV1ZZZSY5S9025548", "Vehicle Brand | 车辆品牌": "Volkswagen | 大众", "Model | 车型": "VN 54X- CRAFTER", "Vehicle Type | 车辆类型": "PANEL VAN", "Vehicle Status | 车辆状态": "待补录", "Insurance": "YES", "Year | 年份": "2025-08-22", "Department | 所属部门": "Operations | 运营部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_005", fields: { "Number Plate | 车牌号码": "LZ35LPGP", "Register number | 注册号": "KLF449L", "Vehicle identification number | 车辆ID": "LGWDCF19XPJ628555", "Vehicle Brand | 车辆品牌": "GWM | 长城", "Model | 车型": "P-SERIES", "Vehicle Type | 车辆类型": "Bakkie", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "Year | 年份": "2024-10-22", "Certificate Expiry | 证书有效期": "2026-09-30", "Department | 所属部门": "Procurement | 采购部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_006", fields: { "Number Plate | 车牌号码": "JB61PDGP", "Register number | 注册号": "ZSL404W", "Vehicle identification number | 车辆ID": "MAKDG18E0H4001185", "Vehicle Brand | 车辆品牌": "Honda | 本田", "Model | 车型": "BR-V", "Vehicle Type | 车辆类型": "SUV", "Vehicle Status | 车辆状态": "In Use", "FNB Fleet Card": "7080488588100007012", "Year | 年份": "2019-06-26", "Certificate Expiry | 证书有效期": "2026-12-31", "Department | 所属部门": "Administration | 行政部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_007", fields: { "Number Plate | 车牌号码": "MN00DKGP", "Register number | 注册号": "KCF596L", "Vehicle identification number | 车辆ID": "AHTSS22P007155747", "Vehicle Brand | 车辆品牌": "Toyota | 丰田", "Model | 车型": "HIACE", "Vehicle Type | 车辆类型": "Mini bus", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "FNB Fleet Card": "7080488588100005016", "Year | 年份": "2023-11-08", "Certificate Expiry | 证书有效期": "2026-08-31", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_008", fields: { "Number Plate | 车牌号码": "KB88SVGP (sold)", "Register number | 注册号": "BPT963X (sold)", "Vehicle identification number | 车辆ID": "(sold) MEC0463ALKP002526", "Vehicle Brand | 车辆品牌": "FUSO | 扶桑", "Model | 车型": "FAVIP 914R (sold)", "Vehicle Type | 车辆类型": "5 TON VAN BODY", "Vehicle Status | 车辆状态": "Sold", "Insurance": "Yes", "FNB Fleet Card": "7080488588100013010", "Year | 年份": "2021-07-01", "Certificate Expiry | 证书有效期": "2026-09-30", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_009", fields: { "Number Plate | 车牌号码": "FZ24JBGP", "Register number | 注册号": "GPW604L", "Vehicle identification number | 车辆ID": "AHHYCK0H601003018", "Vehicle Brand | 车辆品牌": "HINO | 丰田日野", "Model | 车型": "HINO 300-814", "Vehicle Type | 车辆类型": "3.5 ton van body", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "FNB Fleet Card": "7080488588100010024", "Year | 年份": "2017-08-14", "Certificate Expiry | 证书有效期": "2026-04-31", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_010", fields: { "Number Plate | 车牌号码": "DD75NWGP", "Register number | 注册号": "TPC343W", "Vehicle identification number | 车辆ID": "ADMFTR34H8G678118", "Vehicle Brand | 车辆品牌": "ISUZU | 五十铃", "Model | 车型": "F-SERIES", "Vehicle Type | 车辆类型": "3.5 ton van body", "Vehicle Status | 车辆状态": "In Use", "FNB Fleet Card": "7080488588100009026", "Year | 年份": "2014-07-11", "Certificate Expiry | 证书有效期": "2026-04-31", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_011", fields: { "Number Plate | 车牌号码": "JF08CRGP", "Register number | 注册号": "YZK675W", "Vehicle identification number | 车辆ID": "ABJFE85PGJEY19155", "Vehicle Brand | 车辆品牌": "FUSO | 扶桑", "Model | 车型": "CANTER", "Vehicle Type | 车辆类型": "3.5 ton van body", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "FNB Fleet Card": "7080488588100015015", "Year | 年份": "2019-08-12", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_012", fields: { "Number Plate | 车牌号码": "JT75WJGP", "Register number | 注册号": "CBD162X", "Vehicle identification number | 车辆ID": "MC2E3GRC0LA459603", "Vehicle Brand | 车辆品牌": "UD | 五十铃 UD", "Model | 车型": "KUZER RKE150", "Vehicle Type | 车辆类型": "5 TON VAN BODY", "Vehicle Status | 车辆状态": "In Use", "Policy Number | 保单号": "No insurance", "FNB Fleet Card": "7080488588100011014", "Year | 年份": "2020-12-01", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_013", fields: { "Number Plate | 车牌号码": "MP36BXGP", "Register number | 注册号": "BNH109X", "Vehicle identification number | 车辆ID": "MEC2162BKKP002329", "Vehicle Brand | 车辆品牌": "FUSO | 扶桑", "Model | 车型": "FJ26-280R", "Vehicle Type | 车辆类型": "16 ton vanbody", "Vehicle Status | 车辆状态": "In Use", "FNB Fleet Card": "7080488588100014018", "Year | 年份": "2020-10-28", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_014", fields: { "Number Plate | 车牌号码": "JC77FVGP", "Register number | 注册号": "ZVH345W", "Vehicle identification number | 车辆ID": "ACVFTR34H8G029959", "Vehicle Brand | 车辆品牌": "ISUZU | 五十铃", "Model | 车型": "850", "Vehicle Type | 车辆类型": "8 TON VANBODY", "Vehicle Status | 车辆状态": "In Use", "Policy Number | 保单号": "No insurance", "FNB Fleet Card": "7080488588100012012", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_015", fields: { "Number Plate | 车牌号码": "KZ44LDGP", "Register number | 注册号": "JNL391L", "Vehicle identification number | 车辆ID": "AHHZCL2F301007193", "Vehicle Brand | 车辆品牌": "HINO | 丰田日野", "Model | 车型": "HINO 916", "Vehicle Type | 车辆类型": "4 TON VANBODY", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "FNB Fleet Card": "7080488588100008010", "Year | 年份": "2023-02-07", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_016", fields: { "Number Plate | 车牌号码": "HS04DKGP (sold)", "Register number | 注册号": "VNW043W", "Vehicle identification number | 车辆ID": "(sold) WDF63970323910986", "Vehicle Brand | 车辆品牌": "MERCEDES-BENZ | 奔驰", "Model | 车型": "Vito (Sold)", "Vehicle Type | 车辆类型": "Mini bus", "Vehicle Status | 车辆状态": "Sold", "Insurance": "Yes", "Year | 年份": "2018-10-08", "Certificate Expiry | 证书有效期": "2026-09-30", "Department | 所属部门": "Warehouse | 仓库部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_017", fields: { "Number Plate | 车牌号码": "KH92BWGP", "Register number | 注册号": "DGD832X", "Vehicle identification number | 车辆ID": "ADNUSN1D5U0199115", "Vehicle Brand | 车辆品牌": "NISSAN | 尼桑", "Model | 车型": "NP200 1.6", "Vehicle Type | 车辆类型": "Bakkie", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "Year | 年份": "2021-12-11", "Certificate Expiry | 证书有效期": "2026-08-31", "Department | 所属部门": "Maintenance | 维护部", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_018", fields: { "Number Plate | 车牌号码": "JN55ZRGP", "Register number | 注册号": "CTH591K", "Vehicle identification number | 车辆ID": "WV1ZZZZEZ86040681", "Vehicle Brand | 车辆品牌": "Volkswagen | 大众", "Model | 车型": "VN 830", "Vehicle Type | 车辆类型": "PANEL VAN", "Vehicle Status | 车辆状态": "In Use", "Year | 年份": "2008-07-01", "Certificate Expiry | 证书有效期": "2026-06-30", "Department | 所属部门": "Store | 门店", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_019", fields: { "Number Plate | 车牌号码": "MGN360GP", "Register number | 注册号": "BCF550V", "Vehicle identification number | 车辆ID": "AECGD07LPYJ14529", "Vehicle Brand | 车辆品牌": "CARAVAN", "Model | 车型": "GYPSEY", "Vehicle Type | 车辆类型": "CARAVAN", "Vehicle Status | 车辆状态": "In Use", "Year | 年份": "2001-01-03", "Department | 所属部门": "Store | 门店", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_020", fields: { "Number Plate | 车牌号码": "CB02DTGP", "Register number | 注册号": "F66H771", "Vehicle identification number | 车辆ID": "WMWXU52070TH94457", "Vehicle Brand | 车辆品牌": "MINI | 宝马迷你", "Model | 车型": "F55 COPER ONE 1.5", "Vehicle Type | 车辆类型": "HATCH BACK", "Vehicle Status | 车辆状态": "In Use", "Insurance": "Yes", "Year | 年份": "2018-11-17", "Certificate Expiry | 证书有效期": "2025-11-30", "Department | 所属部门": "Store | 门店", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_021", fields: { "Number Plate | 车牌号码": "LT44WTGP", "Register number | 注册号": "GGF142X", "Vehicle identification number | 车辆ID": "ACVFRR90LNN142234", "Vehicle Brand | 车辆品牌": "ISUZU | 五十铃", "Model | 车型": "FRR 600", "Vehicle Type | 车辆类型": "6 TON VAN BODY", "Vehicle Status | 车辆状态": "In Use", "Year | 年份": "2026-03-23", "Certificate Expiry | 证书有效期": "2026-07-31", "Department | 所属部门": "Tophida", "Fleet card picture": [] } },
        { record_id: "rec_vehicle_022", fields: { "Number Plate | 车牌号码": "MG33GNGP", "Vehicle identification number | 车辆ID": "ADNCCAD23Z0034315", "Vehicle Brand | 车辆品牌": "Toyota | 丰田", "Model | 车型": "NISSAN NAVARA 2.5", "Vehicle Type | 车辆类型": "PANEL VAN", "Vehicle Status | 车辆状态": "In Use", "Insurance": "yes", "Year | 年份": "24/03/2025", "Department | 所属部门": "Tophida", "Fleet card picture": [] } }
      ]
    },
    { tableId: "tbl_preview_stores_vehicle", tableName: "Stores Vehicle", records: [] }
  ];

  // Preview data keeps the mobile route selectors usable without Lark credentials.
  private readonly previewStores: BitableRecord[] = previewStoreNames.map((name, index) => ({
    record_id: `rec_store_${String(index + 1).padStart(3, "0")}`,
    fields: { "Single Option": [name] }
  }));

  private readonly previewUsers: UserOption[] = [
    { id: "ou_preview_001", name: "Dane", enName: "Dane", department: "Operations", avatarUrl: "" },
    { id: "ou_preview_002", name: "Mpho", enName: "Mpho", department: "Operations", avatarUrl: "" },
    { id: "ou_preview_003", name: "Thandi", enName: "Thandi", department: "Transport", avatarUrl: "" },
    { id: "ou_preview_004", name: "Lebo", enName: "Lebo", department: "Transport", avatarUrl: "" },
    { id: "ou_preview_driver_001", name: "Driver A", enName: "Driver A", department: "Drivers", avatarUrl: "" },
    { id: "ou_preview_driver_002", name: "Driver B", enName: "Driver B", department: "Drivers", avatarUrl: "" },
    { id: "ou_preview_driver_003", name: "Driver C", enName: "Driver C", department: "Drivers", avatarUrl: "" }
  ];

  private async getAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.tenantAccessToken;
    }

    const response = await fetch("https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: config.larkAppId, app_secret: config.larkAppSecret })
    });
    const payload = (await response.json()) as LarkEnvelope<unknown>;
    if (!response.ok || !payload.tenant_access_token) {
      throw new Error(`Lark token request failed: HTTP ${response.status}, ${payload.msg || "unknown error"}`);
    }

    this.tenantAccessToken = payload.tenant_access_token;
    const expiresIn = Math.max((payload.expire || 7200) - 300, 60);
    this.accessTokenExpiresAt = Date.now() + expiresIn * 1000;
    return this.tenantAccessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json; charset=utf-8");

    const response = await fetch(`https://open.larksuite.com${path}`, { ...init, headers });
    const payload = (await response.json()) as LarkEnvelope<T>;
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(`Lark API failed: HTTP ${response.status}, ${payload.msg || "unknown error"}`);
    }
    return payload.data as T;
  }

  private async requestWithAccessToken<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("Content-Type", "application/json; charset=utf-8");
    const response = await fetch(`https://open.larksuite.com${path}`, { ...init, headers });
    const payload = (await response.json()) as LarkEnvelope<T>;
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(`Lark user API failed: HTTP ${response.status}, ${payload.msg || "unknown error"}`);
    }
    return payload.data as T;
  }

  private async cached<T>(cache: CacheEntry<T>, label: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (cache.value !== undefined && now < cache.expiresAt) return cache.value;
    if (cache.pending) return cache.pending;

    const startedAt = now;
    const ttl = Math.max(config.optionsCacheTtlMs, 30_000);
    cache.pending = loader().then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + ttl;
      // If Lark has a transient error after expiry, keep the last good list
      // available for a short grace period instead of blanking the selectors.
      cache.staleUntil = cache.expiresAt + ttl * 12;
      console.info(`Lark ${label} cache refreshed`, { count: Array.isArray(value) ? value.length : undefined, ms: Date.now() - startedAt });
      return value;
    }).catch((error) => {
      if (cache.value !== undefined && Date.now() < cache.staleUntil) {
        console.warn(`Lark ${label} refresh failed; serving cached data:`, error instanceof Error ? error.message : String(error));
        return cache.value;
      }
      throw error;
    }).finally(() => {
      cache.pending = undefined;
    });
    return cache.pending;
  }

  private async uploadMedia(fileName: string, dataUrl: string): Promise<MediaData> {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) throw new Error(`Invalid photo data for ${fileName}`);
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    const form = new FormData();
    form.set("file_name", fileName);
    form.set("parent_type", "bitable_file");
    form.set("parent_node", config.bitableAppToken);
    form.set("size", String(buffer.byteLength));
    form.set("file", new Blob([buffer], { type: mimeType }), fileName);
    const token = await this.photoSyncToken();
    const response = await fetch("https://open.larksuite.com/open-apis/drive/v1/medias/upload_all", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const payload = (await response.json()) as LarkEnvelope<MediaData>;
    if (!response.ok || (payload.code !== undefined && payload.code !== 0) || !payload.data?.file_token) {
      throw new Error(`Lark media upload failed: HTTP ${response.status}, ${payload.msg || "no file token returned"}`);
    }
    return payload.data;
  }

  private async photoSyncToken(): Promise<string> {
    if (!this.photoSyncAccessToken) {
      throw new Error("飞书照片同步尚未配置，请先在后台通知设置中连接拥有车辆表权限的 Base 管理员");
    }
    return this.photoSyncAccessToken();
  }

  private async addVehicleAttachment(
    fields: Record<string, unknown>,
    fieldName: string,
    fileName: string,
    dataUrl: string
  ): Promise<void> {
    const media = await this.uploadMedia(fileName, dataUrl);
    fields[fieldName] = [{ file_token: media.file_token, name: fileName }];
  }

  async downloadVehicleLogBook(tableId: string, recordId: string, fileToken: string): Promise<{ fileName: string; mimeType: string; content: Buffer }> {
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === recordId);
    const file = vehicle?.logBookAttachments.find((item) => item.fileToken === fileToken);
    if (!vehicle || !file) throw new Error("未找到该车辆的大本附件");
    return this.downloadVehicleMedia(tableId, recordId, vehicle.logBookField, fileToken, file.name, "飞书大本下载失败");
  }

  async downloadVehicleImage(tableId: string, recordId: string, fileToken: string): Promise<{ fileName: string; mimeType: string; content: Buffer }> {
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === recordId);
    const allowed = vehicle ? [vehicle.photoFileToken, vehicle.fleetCardPhotoFileToken].filter(Boolean) : [];
    if (!vehicle || !allowed.includes(fileToken)) throw new Error("未找到该车辆图片附件");
    const isPhoto = fileToken === vehicle.photoFileToken;
    const name = isPhoto ? "vehicle-photo" : "fleet-card-photo";
    const fieldName = isPhoto ? vehicle.photoField : vehicle.fleetCardPhotoField;
    return this.downloadVehicleMedia(tableId, recordId, fieldName, fileToken, name, "飞书车辆图片下载失败");
  }

  private async downloadVehicleMedia(tableId: string, recordId: string, fieldName: string, fileToken: string, fileName: string, errorLabel: string): Promise<{ fileName: string; mimeType: string; content: Buffer }> {
    const field = (await this.listVehicleFieldsWithOptions(tableId)).find((item) => lookupKey(item.name) === lookupKey(fieldName));
    if (!field?.id) throw new Error(`${errorLabel}：未找到附件字段`);
    const extra = encodeURIComponent(JSON.stringify({
      bitablePerm: {
        tableId,
        attachments: { [field.id]: { [recordId]: [fileToken] } }
      }
    }));
    const path = `/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download?extra=${extra}`;
    // Vehicle-profile writes already use the connected Base administrator. Use
    // the same identity for attachments, then retain the app-token fallback
    // for deployments that were configured before the OAuth upload flow.
    let response: Response;
    try {
      response = await fetch(`https://open.larksuite.com${path}`, { headers: { Authorization: `Bearer ${await this.photoSyncToken()}` } });
      if (!response.ok) response = await fetch(`https://open.larksuite.com${path}`, { headers: { Authorization: `Bearer ${await this.getAccessToken()}` } });
    } catch {
      response = await fetch(`https://open.larksuite.com${path}`, { headers: { Authorization: `Bearer ${await this.getAccessToken()}` } });
    }
    if (!response.ok) throw new Error(`${errorLabel}：HTTP ${response.status}`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    return { fileName, mimeType, content: Buffer.from(await response.arrayBuffer()) };
  }

  async listRecords(): Promise<BitableRecord[]> {
    return this.listRecordsForTable(config.bitableTableId, this.previewRecords);
  }

  async getRecord(recordId: string): Promise<BitableRecord> {
    if (config.previewMode) {
      const record = this.previewRecords.find((item) => item.record_id === recordId);
      if (!record) throw new Error("Preview record not found");
      return record;
    }
    const query = new URLSearchParams({ user_id_type: "open_id" });
    const data = await this.request<RecordData>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(config.bitableTableId)}/records/${encodeURIComponent(recordId)}?${query}`
    );
    if (!data.record) throw new Error("Lark get record returned no record");
    return data.record;
  }

  async listUsers(): Promise<UserOption[]> {
    if (config.previewMode) return [...this.previewUsers];
    return this.cached(this.usersCache, "directory", () => this.listUsersFrom(async <T>(path: string, init?: RequestInit) => this.request<T>(path, init)));
  }

  async searchNotificationTargets(type: "user" | "chat", query: string): Promise<NotificationTarget[]> {
    const term = lookupKey(query).slice(0, 50);
    if (!term) return [];
    if (type === "user") {
      const users = await this.listUsers();
      return users.filter((user) => [user.name, user.enName, user.id, user.department].some((value) => lookupKey(value).includes(term)))
        .slice(0, 20).map((user) => ({ type, id: user.id, label: user.department ? `${user.name} · ${user.department}` : user.name }));
    }
    if (config.previewMode) {
      const groups = [
        { type, id: "oc_preview_operations", label: "Operations 通知群" },
        { type, id: "oc_preview_maintenance", label: "Maintenance 通知群" }
      ];
      return groups.filter((group) => lookupKey(`${group.label} ${group.id}`).includes(term));
    }
    const params = new URLSearchParams({ page_size: "20" });
    const searchQuery = query.trim().slice(0, 48);
    const data = await this.request<ChatSearchData>(`/open-apis/im/v2/chats/search?${params}`, {
      method: "POST",
      body: JSON.stringify({ query: searchQuery.includes("-") ? `"${searchQuery}"` : searchQuery, filter: { search_types: ["private", "public_joined", "external"], chat_modes: ["group", "topic"], disable_search_by_user: true } })
    });
    return (data.items || []).flatMap((item) => {
      const id = item.meta_data?.chat_id || item.id || "";
      if (!/^oc_[A-Za-z0-9_-]+$/.test(id) || (item.meta_data?.chat_status && item.meta_data.chat_status !== "normal")) return [];
      return [{ type, id, label: item.meta_data?.name || id }];
    });
  }

  async listUsersWithAccessToken(accessToken: string): Promise<UserOption[]> {
    if (!accessToken) throw new Error("Lark user access token is empty");
    return this.listUsersFrom(async <T>(path: string, init?: RequestInit) => this.requestWithAccessToken<T>(accessToken, path, init));
  }

  async warmOptions(): Promise<void> {
    if (config.previewMode) return;
    await Promise.all([this.listUsers(), this.listVehicles(), this.listStores(), this.listVehicleFieldOptions()]);
  }

  async refreshBaseData(): Promise<{ users: number; vehicles: number; stores: number; optionValues: number }> {
    this.usersCache = { expiresAt: 0, staleUntil: 0 };
    this.vehiclesCache = { expiresAt: 0, staleUntil: 0 };
    this.storesCache = { expiresAt: 0, staleUntil: 0 };
    this.vehicleFieldOptionsCache = { expiresAt: 0, staleUntil: 0 };
    const [users, vehicles, stores, options] = await Promise.all([
      this.listUsers(), this.listVehicles(), this.listStores(), this.listVehicleFieldOptions()
    ]);
    return {
      users: users.length,
      vehicles: vehicles.length,
      stores: stores.length,
      optionValues: Object.values(options).reduce((count, values) => count + values.length, 0)
    };
  }

  private async listUsersFrom(requester: <T>(path: string, init?: RequestInit) => Promise<T>): Promise<UserOption[]> {
    const departmentIds = [config.contactRootDepartmentId];
    const departmentNames = new Map<string, string>();
    let departmentPageToken = "";
    do {
      const query = new URLSearchParams({
        user_id_type: "open_id",
        department_id_type: "open_department_id",
        department_id: config.contactRootDepartmentId,
        fetch_child: "true",
        page_size: "50"
      });
      if (departmentPageToken) query.set("page_token", departmentPageToken);
      const data = await requester<DepartmentListData>(`/open-apis/contact/v3/departments/${encodeURIComponent(config.contactRootDepartmentId)}/children?${query}`);
      for (const department of data.items || []) {
        const departmentId = department.open_department_id || department.department_id;
        if (departmentId) {
          if (!departmentIds.includes(departmentId)) departmentIds.push(departmentId);
          const departmentName = department.name || department.i18n_name?.en_us || department.i18n_name?.zh_cn || "";
          if (departmentName) departmentNames.set(departmentId, departmentName);
        }
      }
      departmentPageToken = data.has_more ? data.page_token || "" : "";
    } while (departmentPageToken);

    const users = new Map<string, UserOption>();
    const loadDepartmentUsers = async (departmentId: string): Promise<UserOption[]> => {
      const departmentUsers: UserOption[] = [];
      let pageToken = "";
      do {
        const query = new URLSearchParams({
          user_id_type: "open_id",
          department_id_type: "open_department_id",
          department_id: departmentId,
          page_size: "50"
        });
        if (pageToken) query.set("page_token", pageToken);
        const data = await requester<UserListData>(`/open-apis/contact/v3/users/find_by_department?${query}`);
        for (const user of data.items || []) {
          const id = user.open_id || "";
          const status = user.status;
          if (!id || status?.is_frozen || status?.is_resigned || status?.is_exited || status?.is_activated === false) continue;
          departmentUsers.push({
            id,
            name: user.name || user.nickname || user.en_name || id,
            enName: user.en_name || "",
            department: (user.department_ids || []).map((departmentId) => departmentNames.get(departmentId) || "").find(Boolean) || "",
            avatarUrl: user.avatar?.avatar_72 || ""
          });
      }
        pageToken = data.has_more ? data.page_token || "" : "";
      } while (pageToken);
      return departmentUsers;
    };

    // The directory can contain more than one hundred departments. The old
    // serial loop made the first page wait for one request per department;
    // bounded batches keep the request count safe while reducing latency.
    const departmentConcurrency = 16;
    for (let offset = 0; offset < departmentIds.length; offset += departmentConcurrency) {
      const batch = departmentIds.slice(offset, offset + departmentConcurrency);
      const batchUsers = await Promise.all(batch.map((departmentId) => loadDepartmentUsers(departmentId)));
      for (const departmentUsers of batchUsers) {
        for (const user of departmentUsers) users.set(user.id, user);
      }
    }
    console.info("Lark directory scan", { rootDepartment: config.contactRootDepartmentId, departments: departmentIds.length, users: users.size });
    return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async listRecordsForTable(tableId: string, previewRecords?: BitableRecord[], appToken = config.bitableAppToken): Promise<BitableRecord[]> {
    if (config.previewMode) {
      return previewRecords || this.previewVehicleTables.find((table) => table.tableId === tableId)?.records || [];
    }
    const records: BitableRecord[] = [];
    let pageToken = "";

    do {
      const query = new URLSearchParams({ page_size: "500", user_id_type: "open_id" });
      if (pageToken) query.set("page_token", pageToken);
      const data = await this.request<RecordListData>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`
      );
      records.push(...(data.items || []));
      pageToken = data.has_more ? data.page_token || "" : "";
    } while (pageToken);

    return records;
  }

  async listStores(): Promise<StoreOption[]> {
    if (!config.previewMode) return this.cached(this.storesCache, "stores", () => this.loadStores());
    return this.loadStores();
  }

  private async loadStores(): Promise<StoreOption[]> {
    let records: BitableRecord[];
    try {
      records = await this.listRecordsForTable(config.storeTableId, this.previewStores, config.storeBitableAppToken);
    } catch (error) {
      // The Store Base may be administered separately from the dispatch Base.
      // Its verified store list remains a safe, functional shortcut catalogue
      // until that Base is shared with this application.
      console.warn("Lark Store Base unavailable; using verified store shortcuts:", error instanceof Error ? error.message : String(error));
      records = this.previewStores;
    }
    const choicesFrom = (source: BitableRecord[]) => {
      const seen = new Set<string>();
      const stores: StoreOption[] = [];
      for (const record of source) {
        const name = textValue(findField(record.fields, config.storeNameFields)?.value).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        stores.push({ id: record.record_id, name });
      }
      return stores;
    };
    const stores = choicesFrom(records);
    if (!stores.length) {
      console.warn("Lark Store Base returned no usable store records; using verified store shortcuts");
      return choicesFrom(this.previewStores);
    }
    // Keep the maintainer's order in the Store table rather than silently
    // alphabetising it; it is the order used by the dispatch team.
    return stores;
  }

  private async listTables(): Promise<VehicleTable[]> {
    if (config.previewMode) return this.previewVehicleTables.map(({ tableId, tableName }) => ({ tableId, tableName }));
    const tables: VehicleTable[] = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const data = await this.request<TableListData>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables?${query}`
      );
      for (const item of data.items || []) {
        if (item.table_id) tables.push({ tableId: item.table_id, tableName: item.name || item.table_id });
      }
      pageToken = data.has_more ? data.page_token || "" : "";
    } while (pageToken);
    return tables;
  }

  private async resolveVehicleTables(): Promise<VehicleTable[]> {
    if (config.previewMode) return this.previewVehicleTables.map(({ tableId, tableName }) => ({ tableId, tableName }));
    if (config.vehicleTableIds.length) {
      return config.vehicleTableIds.map((tableId, index) => ({ tableId, tableName: config.vehicleTableNames[index] || tableId }));
    }
    const tables = await this.listTables();
    return tables.filter((table) => config.vehicleTableNames.some((name) => configuredTableNameMatches(table.tableName, name)));
  }

  private async listVehicleFields(tableId: string): Promise<Array<{ name: string; type: number }>> {
    if (config.previewMode) {
      const table = this.previewVehicleTables.find((item) => item.tableId === tableId);
      const names = new Set<string>();
      table?.records.forEach((record) => Object.keys(record.fields).forEach((name) => names.add(name)));
      return [...names].map((name) => ({ name, type: 1 }));
    }
    const fields: Array<{ name: string; type: number }> = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const data = await this.request<FieldListData>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/fields?${query}`
      );
      for (const field of data.items || []) {
        if (!field.field_name) continue;
        const rawType = typeof field.type === "number" ? field.type : field.type === "select" ? 3 : 1;
        fields.push({ name: field.field_name, type: rawType });
      }
      pageToken = data.has_more ? data.page_token || "" : "";
    } while (pageToken);
    return fields;
  }

  async listVehicleFieldOptions(): Promise<VehicleFieldOptions> {
    if (config.previewMode) {
      return {
        brand: ["MERCEDES-BENZ | 奔驰", "Toyota | 丰田", "Volkswagen | 大众", "GWM | 长城", "Honda | 本田"],
        model: ["CADDY KOMBI 2.0TDi", "VN 54X- CRAFTER", "P-SERIES", "BR-V", "HIACE", "HINO 300-814", "NP200 1.6"],
        type: ["Mini bus", "Bakkie", "SUV", "Sedan", "PANEL VAN", "3.5 ton van body"],
        status: ["In Use", "Available for Use", "Under Maintenance", "Out of Service", "Sold", "待补录"],
        owner: ["Administration | 行政部", "Maintenance | 维护部", "Operations | 运营部", "Procurement | 采购部", "Warehouse | 仓库部", "Store | 门店", ...previewStoreNames],
        registeringAuthority: ["约翰内斯堡 | Johannesburg", "比勒陀利亚 | Pretoria", "开普敦 | Cape Town", "德班 | Durban"],
        insurance: ["YES", "NO"]
      };
    }
    return this.cached(this.vehicleFieldOptionsCache, "vehicle field options", () => this.loadVehicleFieldOptions());
  }

  private async loadVehicleFieldOptions(): Promise<VehicleFieldOptions> {
    const result: VehicleFieldOptions = { brand: [], model: [], type: [], status: [], owner: [], registeringAuthority: [], insurance: [] };
    const seen: Record<keyof VehicleFieldOptions, Set<string>> = {
      brand: new Set(), model: new Set(), type: new Set(), status: new Set(), owner: new Set(), registeringAuthority: new Set(), insurance: new Set()
    };
    const add = (key: keyof VehicleFieldOptions, value: string): void => {
      const clean = value.trim();
      if (!clean || seen[key].has(clean)) return;
      seen[key].add(clean);
      result[key].push(clean);
    };
    const fieldMatches = (fieldName: string, candidates: readonly string[]): boolean => candidates.some((candidate) => lookupKey(candidate) === lookupKey(fieldName));
    const tables = await this.resolveVehicleTables();
    const definitions = await Promise.all(tables.map(async (table) => ({ table, fields: await this.listVehicleFieldsWithOptions(table.tableId) })));
    for (const { fields } of definitions) {
      for (const field of fields) {
        const key = fieldMatches(field.name, config.vehicleFields.brand) ? "brand"
          : fieldMatches(field.name, config.vehicleFields.model) ? "model"
            : fieldMatches(field.name, config.vehicleFields.type) ? "type"
            : fieldMatches(field.name, config.vehicleFields.status) ? "status"
              : fieldMatches(field.name, config.vehicleFields.owner) ? "owner"
                : fieldMatches(field.name, config.vehicleFields.registeringAuthority) ? "registeringAuthority"
                  : fieldMatches(field.name, config.vehicleFields.insurance) ? "insurance" : null;
        if (!key) continue;
        field.options.forEach((option) => add(key, option));
      }
    }
    // Select options alone are not enough: several vehicle tables store these
    // fields as text. Include the values already present in every configured
    // vehicle table so the editor can offer the same choices consistently.
    const vehicles = await this.listVehicles();
    for (const vehicle of vehicles) {
      add("brand", vehicle.brand);
      add("model", vehicle.model);
      add("type", vehicle.vehicleType);
      add("status", vehicle.status);
      add("owner", vehicle.owner);
      add("registeringAuthority", vehicle.registeringAuthority);
      add("insurance", vehicle.insurance);
    }
    // Store Base is the source of truth for the complete store catalogue.
    // Merge it into the owner choices so a vehicle can be assigned to a store
    // even when that store is not yet used by an existing vehicle record.
    const stores = await this.listStores();
    stores.forEach((store) => add("owner", store.name));
    return result;
  }

  async listVehicleFieldDefinitions(): Promise<VehicleFieldDefinitions> {
    const tables = await this.resolveVehicleTables();
    const definitions = await Promise.all(tables.map(async (table) => {
      const fields = await this.listVehicleFieldsWithOptions(table.tableId);
      return {
        tableId: table.tableId,
        tableName: table.tableName,
        fields: fields.map((field) => ({
          key: vehicleFieldKey(field.name) || "model",
          tableId: table.tableId,
          tableName: table.tableName,
          fieldId: field.id,
          fieldName: field.name,
          type: fieldTypeName(field.type),
          multiple: field.multiple || field.type === 4,
          options: field.options
        })).filter((field) => Boolean(field.fieldId) && vehicleFieldKey(field.fieldName) !== null)
      };
    }));
    return { tables: definitions };
  }

  private async getVehicleFieldRaw(tableId: string, fieldId: string): Promise<Record<string, unknown>> {
    if (config.previewMode) throw new Error("预览模式不支持修改多维表格字段选项");
    const data = await this.request<BaseFieldData>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}`
    );
    if (!data.field) throw new Error("多维表格字段读取失败");
    return data.field;
  }

  async updateVehicleFieldOptions(tableId: string, fieldId: string, requestedOptions: string[]): Promise<VehicleFieldDefinition> {
    const table = (await this.resolveVehicleTables()).find((item) => item.tableId === tableId);
    if (!table) throw new Error("请选择已配置的车辆档案表");
    const raw = await this.getVehicleFieldRaw(tableId, fieldId);
    const fieldName = textValue(raw.field_name ?? raw.name).trim();
    const key = vehicleFieldKey(fieldName);
    if (!key) throw new Error("只能编辑车辆档案中的预设选项字段");
    if (fieldTypeName(raw.type) !== "select") {
      const error = new Error(`字段“${fieldName}”当前是文本字段。为保护已有数据，请先在多维表格中将它转换为单选字段。`);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    const options = [...new Set(requestedOptions.map((value) => String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()).filter(Boolean))];
    if (!options.length) throw new Error("至少保留一个选项");
    if (options.length > 10000) throw new Error("单个字段最多支持 10000 个选项");
    const currentOptionObjects = fieldOptionObjects(raw);
    const currentNames = currentOptionObjects.map((option) => textValue(option.name).trim()).filter(Boolean);
    const removed = new Set(currentNames.filter((name) => !options.includes(name)));
    if (removed.size) {
      const records = await this.listRecordsForTable(tableId);
      const used = new Map<string, number>();
      for (const record of records) {
        const value = record.fields[fieldName];
        const values = Array.isArray(value) ? value.map((item) => textValue(item).trim()).filter(Boolean) : [textValue(value).trim()].filter(Boolean);
        for (const item of values) if (removed.has(item)) used.set(item, (used.get(item) || 0) + 1);
      }
      if (used.size) {
        const summary = [...used.entries()].map(([name, count]) => `${name}（${count}条）`).join("、");
        const error = new Error(`无法删除正在使用的选项：${summary}。请先修改这些车辆记录。`);
        (error as Error & { statusCode?: number }).statusCode = 409;
        throw error;
      }
    }
    const existingByName = new Map(currentOptionObjects.map((option) => [textValue(option.name).trim(), option]));
    const nextOptionObjects = options.map((name) => existingByName.get(name) || { name });
    const payload: Record<string, unknown> = { ...raw };
    delete payload.field_id;
    delete payload.id;
    delete payload.name;
    delete payload.options;
    payload.field_name = fieldName;
    if (payload.property && typeof payload.property === "object" && !Array.isArray(payload.property)) {
      payload.property = { ...(payload.property as Record<string, unknown>), options: nextOptionObjects };
    } else {
      payload.options = nextOptionObjects;
    }
    await this.request<BaseFieldData>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}`,
      { method: "PUT", body: JSON.stringify(payload) }
    );
    this.vehicleFieldOptionsCache.expiresAt = 0;
    this.vehicleFieldOptionsCache.staleUntil = 0;
    this.invalidateVehiclesCache();
    return {
      key,
      tableId,
      tableName: table.tableName,
      fieldId,
      fieldName,
      type: "select",
      multiple: Boolean(fieldTypeName(raw.type) === "select" && (raw.multiple === true || raw.property && typeof raw.property === "object" && (raw.property as Record<string, unknown>).multiple === true || raw.type === 4)),
      options
    };
  }

  private async listVehicleFieldsWithOptions(tableId: string): Promise<Array<{ id: string; name: string; type: number | string; multiple: boolean; options: string[] }>> {
    if (config.previewMode) {
      const options = await this.listVehicleFieldOptions();
      return (await this.listVehicleFields(tableId)).map((field) => {
        const key = vehicleFieldKey(field.name);
        return {
          ...field,
          id: `preview-${tableId}-${lookupKey(field.name).replace(/[^a-z0-9]+/g, "-")}`,
          type: key ? 3 : field.type,
          multiple: false,
          options: key ? options[key] : []
        };
      });
    }
    const fields: Array<{ id: string; name: string; type: number | string; multiple: boolean; options: string[] }> = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const data = await this.request<FieldListData>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/fields?${query}`
      );
      for (const field of data.items || []) {
        if (!field.field_name) continue;
        const rawType = typeof field.type === "number" ? field.type : field.type === "select" ? 3 : 1;
        const rawOptions = field.options || field.property?.options || [];
        fields.push({
          id: field.field_id || field.id || "",
          name: field.field_name,
          type: field.type ?? rawType,
          multiple: field.multiple ?? field.property?.multiple ?? false,
          options: rawOptions.map((option) => option.name || "").filter(Boolean)
        });
      }
      pageToken = data.has_more ? data.page_token || "" : "";
    } while (pageToken);
    return fields;
  }

  async listVehicles(): Promise<VehicleProfile[]> {
    if (!config.previewMode) return this.cached(this.vehiclesCache, "vehicles", () => this.loadVehicles());
    return this.loadVehicles();
  }

  private async loadVehicles(): Promise<VehicleProfile[]> {
    const vehicles: VehicleProfile[] = [];
    const tables = await this.resolveVehicleTables();
    const [tableRecords, tableFields] = await Promise.all([
      Promise.all(tables.map((table) => this.listRecordsForTable(table.tableId))),
      Promise.all(tables.map((table) => this.listVehicleFields(table.tableId)))
    ]);
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
      const table = tables[tableIndex];
      const dateFieldNames = tableFields[tableIndex].filter((field) => field.type === 5).map((field) => field.name);
      for (const record of tableRecords[tableIndex]) {
        const plateField = findField(record.fields, [
          ...config.vehicleFields.plate,
          "Number Plate",
          "Plate Number",
          "Registration Number",
          "Registration",
          "License Plate",
          "车牌号"
        ]);
        // Keep records with a blank plate in the overview so the fleet team can
        // complete the profile; dispatchEligibility will keep them out of
        // dispatch selectors until a plate is supplied.
        if (!plateField) continue;
        const mileageField = findField(record.fields, config.vehicleFields.mileage);
        const nextField = findField(record.fields, config.vehicleFields.nextMaintenanceMileage);
        const nextDateField = findField(record.fields, config.vehicleFields.nextMaintenanceDate);
        const brandField = findField(record.fields, config.vehicleFields.brand);
        const modelField = findField(record.fields, config.vehicleFields.model);
        const typeField = findField(record.fields, config.vehicleFields.type);
        const statusField = findField(record.fields, config.vehicleFields.status);
        const ownerField = findField(record.fields, config.vehicleFields.owner);
        const yearField = findField(record.fields, config.vehicleFields.year);
        const registeringAuthorityField = findField(record.fields, config.vehicleFields.registeringAuthority);
        const lastServiceDateField = findField(record.fields, config.vehicleFields.lastServiceDate);
        const serviceProviderField = findField(record.fields, config.vehicleFields.serviceProvider);
        const spareKeyField = findField(record.fields, config.vehicleFields.spareKey);
        const registerNumberField = findField(record.fields, config.vehicleFields.registerNumber);
        const vehicleIdentificationNumberField = findField(record.fields, config.vehicleFields.vehicleIdentificationNumber);
        const trackerRegistrationField = findField(record.fields, config.vehicleFields.tracker);
        const trackerFieldDefinition = tableFields[tableIndex].find((field) => config.vehicleFields.tracker.some((name) => lookupKey(name) === lookupKey(field.name)));
        const resolvedTrackerField = trackerRegistrationField || (trackerFieldDefinition ? { name: trackerFieldDefinition.name, value: "" } : undefined);
        const certificateExpiryField = findField(record.fields, config.vehicleFields.certificateExpiry);
        const logBookField = findField(record.fields, config.vehicleFields.logBook);
        const policyNumberField = findField(record.fields, config.vehicleFields.policyNumber);
        const insuranceField = findField(record.fields, config.vehicleFields.insurance);
        const fleetCardPhotoField = findField(record.fields, config.vehicleFields.fleetCardPhoto);
        const fnbFleetCardField = findField(record.fields, config.vehicleFields.fnbFleetCard);
        const photoField = findField(record.fields, config.vehicleFields.photo);
        const photos = attachmentValues(photoField?.value);
        const logBookAttachments = attachmentValues(logBookField?.value);
        const fleetCardPhotos = attachmentValues(fleetCardPhotoField?.value);
        const plate = textValue(plateField.value);
        const brand = textValue(brandField?.value);
        const model = textValue(modelField?.value);
        const vehicleType = textValue(typeField?.value);
        const status = textValue(statusField?.value);
        vehicles.push({
          tableId: table.tableId,
          tableName: table.tableName,
          recordId: record.record_id,
          plate,
          brand,
          model,
          modelDescription: vehicleDescription(brand, model, vehicleType),
          brandField: brandField?.name || "",
          vehicleType,
          typeField: typeField?.name || "",
          status,
          statusField: statusField?.name || "",
          owner: textValue(ownerField?.value),
          ownerField: ownerField?.name || "",
          year: textValue(yearField?.value),
          yearField: yearField?.name || "",
          registeringAuthority: textValue(registeringAuthorityField?.value),
          registeringAuthorityField: registeringAuthorityField?.name || "",
          lastServiceDate: textValue(lastServiceDateField?.value),
          lastServiceDateField: lastServiceDateField?.name || "",
          serviceProvider: textValue(serviceProviderField?.value),
          serviceProviderField: serviceProviderField?.name || "",
          spareKey: textValue(spareKeyField?.value),
          spareKeyField: spareKeyField?.name || "",
          registerNumber: textValue(registerNumberField?.value),
          registerNumberField: registerNumberField?.name || "",
          vehicleIdentificationNumber: textValue(vehicleIdentificationNumberField?.value),
          vehicleIdentificationNumberField: vehicleIdentificationNumberField?.name || "",
          trackerRegistration: textValue(resolvedTrackerField?.value),
          trackerRegistrationField: resolvedTrackerField?.name || "",
          certificateExpiry: textValue(certificateExpiryField?.value),
          certificateExpiryField: certificateExpiryField?.name || "",
          logBookAttachments,
          logBookField: logBookField?.name || "",
          policyNumber: textValue(policyNumberField?.value),
          policyNumberField: policyNumberField?.name || "",
          insurance: textValue(insuranceField?.value),
          insuranceField: insuranceField?.name || "",
          fnbFleetCard: textValue(fnbFleetCardField?.value),
          fnbFleetCardField: fnbFleetCardField?.name || "",
          fleetCardPhotoUrl: fleetCardPhotos[0]?.url || "",
          fleetCardPhotoField: fleetCardPhotoField?.name || "",
          selectFieldNames: [brandField, typeField, statusField, ownerField, yearField, registeringAuthorityField, insuranceField, resolvedTrackerField].filter((field): field is { name: string; value: unknown } => Boolean(field && Array.isArray(field.value))).map((field) => field.name),
          dispatchEligible: dispatchEligibility(plate, model, status),
          photoUrl: photos[0]?.url || "",
          photoFileToken: photos[0]?.fileToken,
          fleetCardPhotoFileToken: fleetCardPhotos[0]?.fileToken,
          mileage: numberValue(mileageField?.value),
          nextMaintenanceMileage: numberValue(nextField?.value),
          nextMaintenanceDate: dateInputValue(nextDateField?.value),
          dateFieldNames,
          plateField: plateField.name,
          modelField: modelField?.name || config.vehicleFields.model[0],
          photoField: photoField?.name || config.vehicleFields.photo[0],
          // Keep absent columns empty. A Store Vehicle table without mileage
          // columns must never receive an update for a made-up field name.
          currentMileageField: mileageField?.name || "",
          nextMaintenanceMileageField: nextField?.name || "",
          nextMaintenanceDateField: nextDateField?.name || "",
          photoFieldConfigured: Boolean(photoField?.name)
        });
      }
    }
    console.info("Lark vehicle sync", {
      tables: tables.map((table) => ({ id: table.tableId, name: table.tableName })),
      records: tableRecords.reduce((count, records) => count + records.length, 0),
      vehicles: vehicles.length,
      withPlate: vehicles.filter((vehicle) => vehicle.plate.trim()).length,
      missingPlate: vehicles.filter((vehicle) => !vehicle.plate.trim()).length
    });
    return vehicles;
  }

  async findVehicle(vehicleNumber: string): Promise<VehicleMatchResult> {
    const query = textValue(vehicleNumber).trim();
    const wantedKey = vehicleKey(query);
    if (!wantedKey) return { status: "not_found", query, message: "未提供车牌号码" };

    const matches = (await this.listVehicles()).filter((vehicle) => vehicle.dispatchEligible && vehicleKey(vehicle.plate) === wantedKey);

    if (matches.length === 0) return { status: "not_found", query, message: `未找到车牌 ${query} 对应的车辆档案` };
    if (matches.length > 1) return { status: "ambiguous", query, message: `车牌 ${query} 在车辆档案中匹配到多条记录，请先去重` };
    return { status: "matched", query, message: `已匹配 ${matches[0].tableName} 车辆档案`, vehicle: matches[0] };
  }

  async prepareTaskFields(fields: Record<string, unknown>): Promise<{ fields: Record<string, unknown>; match: VehicleMatchResult }> {
    const prepared = { ...fields };
    const vehicleNumber = textValue(prepared[config.fields.vehicle]);
    const match = await this.findVehicle(vehicleNumber);
    if (match.status === "matched" && match.vehicle && numberValue(prepared[config.fields.nextMaintenanceMileage]) === null && match.vehicle.nextMaintenanceMileage !== null) {
      prepared[config.fields.nextMaintenanceMileage] = match.vehicle.nextMaintenanceMileage;
    }
    return { fields: prepared, match };
  }

  async syncVehicleMileage(vehicleNumber: string, mileage: number | null, match?: VehicleMatchResult): Promise<VehicleSyncResult> {
    if (!textValue(vehicleNumber).trim() || mileage === null) {
      return { status: "skipped", matched: false, updated: false, message: "缺少车牌或当前公里数，跳过车辆档案回写" };
    }
    const resolved = match || await this.findVehicle(vehicleNumber);
    if (resolved.status === "not_found") return { status: "not_found", matched: false, updated: false, message: resolved.message };
    if (resolved.status === "ambiguous" || !resolved.vehicle) return { status: "ambiguous", matched: false, updated: false, message: resolved.message };

    const vehicle = resolved.vehicle;
    if (!vehicle.currentMileageField) {
      return { status: "skipped", matched: true, updated: false, vehicle, message: `${vehicle.tableName} 尚未建立当前公里数字段，未回写车辆档案` };
    }
    if (vehicle.mileage !== null && mileage < vehicle.mileage) {
      return { status: "unchanged", matched: true, updated: false, vehicle, message: `提交公里数 ${mileage} 小于车辆档案当前公里数 ${vehicle.mileage}，未回退档案` };
    }
    if (vehicle.mileage === mileage) return { status: "unchanged", matched: true, updated: false, vehicle, message: "车辆档案公里数已经是最新值" };

    await this.updateRecord(vehicle.recordId, { [vehicle.currentMileageField]: String(mileage) }, vehicle.tableId);
    const updatedVehicle = { ...vehicle, mileage };
    return { status: "updated", matched: true, updated: true, vehicle: updatedVehicle, message: `已将 ${vehicle.plate} 车辆档案公里数更新为 ${mileage}` };
  }

  /**
   * Update a mileage from a historical Tracker report. Reload the vehicle
   * record immediately before writing so a concurrent departure/return
   * submission cannot be overwritten by a stale report value.
   */
  async syncTrackerReportMileage(vehicle: VehicleProfile, mileage: number): Promise<VehicleSyncResult> {
    this.invalidateVehiclesCache();
    const current = (await this.loadVehicles()).find((item) => item.tableId === vehicle.tableId && item.recordId === vehicle.recordId);
    if (!current) return { status: "not_found", matched: false, updated: false, message: "车辆档案在写回前已不存在" };
    if (!current.currentMileageField) {
      return { status: "skipped", matched: true, updated: false, vehicle: current, message: `${current.tableName} 尚未建立当前公里数字段，未回写车辆档案` };
    }
    if (current.mileage !== null && mileage < current.mileage) {
      return { status: "lower_than_current", matched: true, updated: false, vehicle: current, message: `Tracker 报表公里数 ${mileage} 小于车辆档案当前公里数 ${current.mileage}，未回退档案` };
    }
    if (current.mileage === mileage) {
      return { status: "unchanged", matched: true, updated: false, vehicle: current, message: "车辆档案公里数已经是最新值" };
    }
    await this.updateRecord(current.recordId, { [current.currentMileageField]: String(mileage) }, current.tableId);
    this.invalidateVehiclesCache();
    return { status: "updated", matched: true, updated: true, vehicle: { ...current, mileage }, message: `已将 ${current.plate} 车辆档案公里数更新为 ${mileage}` };
  }

  async syncBackendVehiclePhoto(vehicle: VehicleProfile, upload: { fileName: string; dataUrl: string }): Promise<string> {
    if (!vehicle.photoFieldConfigured) throw new Error(`${vehicle.tableName} 尚未配置车辆照片字段`);
    const fields: Record<string, unknown> = {};
    if (config.previewMode) {
      fields[vehicle.photoField] = [{ name: upload.fileName, url: upload.dataUrl, file_token: `preview_file_${crypto.randomUUID()}` }];
    } else {
      await this.addVehicleAttachment(fields, vehicle.photoField, upload.fileName, upload.dataUrl);
    }
    const updatedRecord = await this.updateRecord(vehicle.recordId, fields, vehicle.tableId, !config.previewMode);
    const remoteToken = attachmentValues(updatedRecord?.fields[vehicle.photoField])[0]?.fileToken || "";
    if (!remoteToken) throw new Error("飞书未返回同步后的车辆照片附件 token");
    this.invalidateVehiclesCache();
    return remoteToken;
  }

  async updateVehicleProfile(tableId: string, recordId: string, input: VehicleProfileInput): Promise<VehicleProfile> {
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === recordId);
    if (!vehicle) throw new Error("未找到要编辑的车辆档案");
    const plate = input.plate.trim();
    const brand = input.brand.trim();
    const model = input.model.trim();
    const vehicleType = input.vehicleType.trim();
    const status = input.status.trim();
    const owner = input.owner.trim();
    const year = input.year.trim();
    if (!plate || !model) throw new Error("车牌和车型不能为空");
    const fields: Record<string, unknown> = {
      [vehicle.plateField]: plate,
      [vehicle.modelField]: model
    };
    const writeLikeCurrent = (fieldName: string, value: string): void => {
      if (!fieldName || !value) return;
      fields[fieldName] = vehicle.selectFieldNames.includes(fieldName) ? [value] : value;
    };
    writeLikeCurrent(vehicle.brandField, brand);
    writeLikeCurrent(vehicle.typeField, vehicleType);
    writeLikeCurrent(vehicle.statusField, status);
    writeLikeCurrent(vehicle.ownerField, owner);
    writeLikeCurrent(vehicle.yearField, year);
    writeLikeCurrent(vehicle.registeringAuthorityField, input.registeringAuthority.trim());
    const writeTextField = (fieldName: string, value: string): void => {
      if (!fieldName || !value) return;
      fields[fieldName] = vehicle.dateFieldNames.includes(fieldName) ? dateTimeCellValue(value) : value;
    };
    writeTextField(vehicle.lastServiceDateField, input.lastServiceDate.trim());
    writeTextField(vehicle.serviceProviderField, input.serviceProvider.trim());
    writeTextField(vehicle.spareKeyField, input.spareKey.trim());
    writeTextField(vehicle.registerNumberField, input.registerNumber.trim());
    writeTextField(vehicle.vehicleIdentificationNumberField, input.vehicleIdentificationNumber.trim());
    const trackerRegistration = input.trackerRegistration.trim();
    if (vehicle.trackerRegistrationField && trackerRegistration !== vehicle.trackerRegistration) {
      fields[vehicle.trackerRegistrationField] = vehicle.selectFieldNames.includes(vehicle.trackerRegistrationField)
        ? (trackerRegistration ? [trackerRegistration] : [])
        : trackerRegistration;
    }
    writeTextField(vehicle.certificateExpiryField, input.certificateExpiry.trim());
    writeTextField(vehicle.policyNumberField, input.policyNumber.trim());
    const insurance = input.insurance.trim();
    const normalizedInsurance = /^yes$/i.test(insurance) ? "YES" : /^no$/i.test(insurance) ? "NO" : insurance;
    if (vehicle.insuranceField && normalizedInsurance) {
      fields[vehicle.insuranceField] = vehicle.selectFieldNames.includes(vehicle.insuranceField) ? [normalizedInsurance] : normalizedInsurance;
    }
    writeTextField(vehicle.fnbFleetCardField, input.fnbFleetCard.trim());
    const mileage = input.mileage ?? vehicle.mileage;
    const nextMaintenanceMileage = input.nextMaintenanceMileage ?? vehicle.nextMaintenanceMileage;
    if (input.mileage !== null) {
      if (!vehicle.currentMileageField) throw new Error(`${vehicle.tableName} 尚未建立当前公里数字段`);
      fields[vehicle.currentMileageField] = String(input.mileage);
    }
    if (input.nextMaintenanceMileage !== null) {
      if (!vehicle.nextMaintenanceMileageField) throw new Error(`${vehicle.tableName} 尚未建立下次保养里程字段`);
      fields[vehicle.nextMaintenanceMileageField] = String(input.nextMaintenanceMileage);
    }
    const nextMaintenanceDate = input.nextMaintenanceDate.trim();
    if (nextMaintenanceDate) {
      if (!vehicle.nextMaintenanceDateField) throw new Error(`${vehicle.tableName} 尚未建立下次保养日期字段`);
      fields[vehicle.nextMaintenanceDateField] = dateTimeCellValue(nextMaintenanceDate);
    }
    let logBookAttachments = vehicle.logBookAttachments;
    if (input.logBookDocument) {
      if (!vehicle.logBookField) throw new Error(`${vehicle.tableName} 尚未建立车辆大本字段`);
      await this.addVehicleAttachment(fields, vehicle.logBookField, input.logBookDocument.fileName, input.logBookDocument.dataUrl);
      logBookAttachments = [{ name: input.logBookDocument.fileName, url: "" }];
    }
    let photoUrl = vehicle.photoUrl;
    if (input.photoDataUrl && vehicle.photoFieldConfigured) {
      const fileName = `vehicle-profile-${Date.now()}.jpg`;
      if (config.previewMode) {
        fields[vehicle.photoField] = [{ name: fileName, url: input.photoDataUrl, file_token: `preview_file_${crypto.randomUUID()}` }];
        photoUrl = input.photoDataUrl;
      } else {
        await this.addVehicleAttachment(fields, vehicle.photoField, fileName, input.photoDataUrl);
      }
    }
    let fleetCardPhotoUrl = vehicle.fleetCardPhotoUrl;
    if (input.fleetCardPhotoDataUrl) {
      if (!vehicle.fleetCardPhotoField) throw new Error(`${vehicle.tableName} 尚未建立加油油卡图片字段`);
      const fileName = `fleet-card-${Date.now()}.jpg`;
      if (config.previewMode) {
        fields[vehicle.fleetCardPhotoField] = [{ name: fileName, url: input.fleetCardPhotoDataUrl, file_token: `preview_file_${crypto.randomUUID()}` }];
        fleetCardPhotoUrl = input.fleetCardPhotoDataUrl;
      } else {
        await this.addVehicleAttachment(fields, vehicle.fleetCardPhotoField, fileName, input.fleetCardPhotoDataUrl);
      }
    }
    // The Base administrator OAuth grant is used for all profile writes,
    // not just media upload. This bypasses a tenant app record-role limit
    // when the authorized administrator can edit this vehicle record.
    const updatedRecord = await this.updateRecord(recordId, fields, tableId, !config.previewMode);
    if (!updatedRecord || updatedRecord.record_id !== recordId) {
      throw new Error("飞书未返回已更新的车辆记录，请勿将本次操作视为成功");
    }
    const unconfirmedFields = Object.entries(fields)
      .filter(([fieldName, expectedValue]) => !fieldWriteConfirmed(updatedRecord.fields[fieldName], expectedValue))
      .map(([fieldName]) => fieldName);
    if (unconfirmedFields.length) {
      throw new Error(`飞书未确认写入字段：${unconfirmedFields.join("、")}`);
    }
    this.invalidateVehiclesCache();
    return {
      ...vehicle,
      plate,
      brand: brand || vehicle.brand,
      model,
      vehicleType: vehicleType || vehicle.vehicleType,
      status: status || vehicle.status,
      owner: owner || vehicle.owner,
      year: year || vehicle.year,
      registeringAuthority: input.registeringAuthority.trim() || vehicle.registeringAuthority,
      lastServiceDate: input.lastServiceDate.trim() || vehicle.lastServiceDate,
      serviceProvider: input.serviceProvider.trim() || vehicle.serviceProvider,
      spareKey: input.spareKey.trim() || vehicle.spareKey,
      registerNumber: input.registerNumber.trim() || vehicle.registerNumber,
      vehicleIdentificationNumber: input.vehicleIdentificationNumber.trim() || vehicle.vehicleIdentificationNumber,
      trackerRegistration: trackerRegistration || vehicle.trackerRegistration,
      certificateExpiry: input.certificateExpiry.trim() || vehicle.certificateExpiry,
      logBookAttachments,
      policyNumber: input.policyNumber.trim() || vehicle.policyNumber,
      insurance: normalizedInsurance || vehicle.insurance,
      fnbFleetCard: input.fnbFleetCard.trim() || vehicle.fnbFleetCard,
      fleetCardPhotoUrl,
      modelDescription: vehicleDescription(brand || vehicle.brand, model, vehicleType || vehicle.vehicleType),
      photoUrl,
      mileage,
      nextMaintenanceMileage,
      nextMaintenanceDate: nextMaintenanceDate || vehicle.nextMaintenanceDate,
      dispatchEligible: dispatchEligibility(plate, model, status || vehicle.status)
    };
  }

  async markVehicleSold(tableId: string, recordId: string): Promise<VehicleProfile> {
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === recordId);
    if (!vehicle) throw new Error("未找到要标记为已售的车辆档案");
    if (!vehicle.statusField) throw new Error("当前车辆档案表未配置车辆状态字段");
    const statusValue = vehicle.selectFieldNames.includes(vehicle.statusField) ? ["Sold"] : "Sold";
    await this.updateRecord(recordId, { [vehicle.statusField]: statusValue }, tableId, !config.previewMode);
    this.invalidateVehiclesCache();
    return { ...vehicle, status: "Sold", dispatchEligible: false };
  }

  async deleteVehicleProfile(tableId: string, recordId: string): Promise<VehicleProfile> {
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === recordId);
    if (!vehicle) throw new Error("未找到要删除的车辆档案");

    if (config.previewMode) {
      const table = this.previewVehicleTables.find((item) => item.tableId === tableId);
      const index = table?.records.findIndex((item) => item.record_id === recordId) ?? -1;
      if (!table || index < 0) throw new Error("未找到要删除的预览车辆档案");
      table.records.splice(index, 1);
      this.invalidateVehiclesCache();
      return vehicle;
    }

    const query = new URLSearchParams({ user_id_type: "open_id" });
    const path = `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}?${query}`;
    try {
      await this.request<unknown>(path, { method: "DELETE" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/(401|403|unauthorized|forbidden|RolePermNotAllow)/i.test(message) || !this.photoSyncAccessToken) throw error;
      await this.requestWithAccessToken<unknown>(await this.photoSyncToken(), path, { method: "DELETE" });
    }
    this.invalidateVehiclesCache();
    return vehicle;
  }

  async createVehicleProfile(tableId: string, input: VehicleProfileInput): Promise<VehicleProfile> {
    const table = (await this.resolveVehicleTables()).find((item) => item.tableId === tableId);
    if (!table) throw new Error("请选择已配置的车辆档案表");
    const plate = input.plate.trim();
    const model = input.model.trim();
    if (!plate || !model) throw new Error("车牌和车型不能为空");
    const fields: Record<string, unknown> = {};

    if (config.previewMode) {
      const previewTable = this.previewVehicleTables.find((item) => item.tableId === tableId);
      if (!previewTable) throw new Error("未找到预览车辆档案表");
      previewTable.records.push({
        record_id: `rec_vehicle_${crypto.randomUUID()}`,
        fields: {
          [config.vehicleFields.plate[0]]: plate,
          [config.vehicleFields.brand[0]]: input.brand.trim(),
          [config.vehicleFields.model[0]]: model,
          [config.vehicleFields.type[0]]: input.vehicleType.trim(),
          [config.vehicleFields.status[0]]: input.status.trim() || "Sold",
          [config.vehicleFields.owner[0]]: input.owner.trim(),
          [config.vehicleFields.year[0]]: input.year.trim(),
          [config.vehicleFields.tracker[0]]: input.trackerRegistration.trim(),
          [config.vehicleFields.mileage[0]]: input.mileage ?? "",
          [config.vehicleFields.nextMaintenanceMileage[0]]: input.nextMaintenanceMileage ?? "",
          [config.vehicleFields.nextMaintenanceDate[0]]: input.nextMaintenanceDate ? dateTimeCellValue(input.nextMaintenanceDate) : ""
        }
      });
      this.invalidateVehiclesCache();
      const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.plate === plate);
      if (!vehicle) throw new Error("预览车辆创建后无法读取");
      return vehicle;
    }

    const definitions = await this.listVehicleFields(tableId);
    const normalized = new Map(definitions.map((item) => [lookupKey(item.name), item]));
    const matchingField = (names: readonly string[]): { name: string; type: number } | undefined => {
      for (const candidate of names) {
        const definition = normalized.get(lookupKey(candidate));
        if (definition) return definition;
      }
      return undefined;
    };
    const write = (names: readonly string[], value: string | number | null): void => {
      if (value === null || value === "") return;
      const field = matchingField(names);
      if (!field) return;
      fields[field.name] = field.type === 3 || field.type === 4 ? [value] : value;
    };
    write(config.vehicleFields.plate, plate);
    write(config.vehicleFields.model, model);
    write(config.vehicleFields.brand, input.brand.trim());
    write(config.vehicleFields.type, input.vehicleType.trim());
    write(config.vehicleFields.status, input.status.trim() || "Sold");
    write(config.vehicleFields.owner, input.owner.trim());
    write(config.vehicleFields.year, input.year.trim());
    write(config.vehicleFields.registeringAuthority, input.registeringAuthority.trim());
    write(config.vehicleFields.lastServiceDate, input.lastServiceDate.trim());
    write(config.vehicleFields.serviceProvider, input.serviceProvider.trim());
    write(config.vehicleFields.spareKey, input.spareKey.trim());
    write(config.vehicleFields.registerNumber, input.registerNumber.trim());
    write(config.vehicleFields.vehicleIdentificationNumber, input.vehicleIdentificationNumber.trim());
    write(config.vehicleFields.tracker, input.trackerRegistration.trim());
    write(config.vehicleFields.certificateExpiry, input.certificateExpiry.trim());
    if (input.logBookDocument) {
      const logBookField = matchingField(config.vehicleFields.logBook);
      if (logBookField) await this.addVehicleAttachment(fields, logBookField.name, input.logBookDocument.fileName, input.logBookDocument.dataUrl);
    }
    write(config.vehicleFields.policyNumber, input.policyNumber.trim());
    write(config.vehicleFields.insurance, input.insurance.trim());
    write(config.vehicleFields.fnbFleetCard, input.fnbFleetCard.trim());
    write(config.vehicleFields.mileage, input.mileage);
    write(config.vehicleFields.nextMaintenanceMileage, input.nextMaintenanceMileage);
    write(config.vehicleFields.nextMaintenanceDate, input.nextMaintenanceDate ? dateTimeCellValue(input.nextMaintenanceDate) : "");
    if (input.photoDataUrl) {
      const photoField = matchingField(config.vehicleFields.photo);
      if (photoField) {
        const fileName = `vehicle-profile-${Date.now()}.jpg`;
        await this.addVehicleAttachment(fields, photoField.name, fileName, input.photoDataUrl);
      }
    }
    const data = await this.request<RecordData>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/records?${new URLSearchParams({ user_id_type: "open_id", client_token: crypto.randomUUID() })}`,
      { method: "POST", body: JSON.stringify({ fields }) }
    );
    if (!data.record) throw new Error("Lark 创建车辆档案未返回记录");
    this.invalidateVehiclesCache();
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === data.record?.record_id);
    if (!vehicle) throw new Error("车辆档案已创建，但暂未能重新读取");
    return vehicle;
  }

  async confirmVehicleMaintenance(tableId: string, recordId: string, input: { serviceDate: string; mileage: number | null; provider: string; notes: string; nextMaintenanceDate: string; nextMaintenanceMileage: number | null }): Promise<{ updatedBaseFields: string[]; vehicle: VehicleProfile }> {
    const vehicle = (await this.listVehicles()).find((item) => item.tableId === tableId && item.recordId === recordId);
    if (!vehicle) throw new Error("未找到要确认保养的车辆档案");
    const serviceDate = input.serviceDate.trim();
    const provider = input.provider.trim();
    const notes = input.notes.trim();
    const nextMaintenanceDate = input.nextMaintenanceDate.trim();
    if (!serviceDate) throw new Error("请填写保养日期");
    if (input.mileage !== null && (!Number.isFinite(input.mileage) || input.mileage < 0)) throw new Error("保养公里数必须是非负数字");
    if (!nextMaintenanceDate) throw new Error("请填写下次保养日期");
    if (Number.isNaN(new Date(nextMaintenanceDate).getTime())) throw new Error("请填写有效的下次保养日期");
    if (input.nextMaintenanceMileage === null || !Number.isFinite(input.nextMaintenanceMileage) || input.nextMaintenanceMileage < 0) throw new Error("请填写有效的下次保养公里数");

    const fields: Record<string, unknown> = {};
    const updatedBaseFields: string[] = [];
    if (vehicle.lastServiceDateField) { fields[vehicle.lastServiceDateField] = serviceDate; updatedBaseFields.push(vehicle.lastServiceDateField); }
    if (provider && vehicle.serviceProviderField) { fields[vehicle.serviceProviderField] = provider; updatedBaseFields.push(vehicle.serviceProviderField); }
    if (input.mileage !== null && vehicle.currentMileageField) { fields[vehicle.currentMileageField] = String(input.mileage); updatedBaseFields.push(vehicle.currentMileageField); }
    if (!vehicle.nextMaintenanceDateField) throw new Error(`${vehicle.tableName} 尚未建立下次保养日期字段`);
    if (!vehicle.nextMaintenanceMileageField) throw new Error(`${vehicle.tableName} 尚未建立下次保养公里数字段`);
    fields[vehicle.nextMaintenanceDateField] = dateTimeCellValue(nextMaintenanceDate);
    fields[vehicle.nextMaintenanceMileageField] = String(input.nextMaintenanceMileage);
    updatedBaseFields.push(vehicle.nextMaintenanceDateField, vehicle.nextMaintenanceMileageField);
    if (updatedBaseFields.length) {
      await this.updateRecord(recordId, fields, tableId, !config.previewMode);
      this.invalidateVehiclesCache();
    }
    return {
      updatedBaseFields,
      vehicle: {
        ...vehicle,
        lastServiceDate: serviceDate || vehicle.lastServiceDate,
        serviceProvider: provider || vehicle.serviceProvider,
        mileage: input.mileage === null ? vehicle.mileage : input.mileage,
        nextMaintenanceDate,
        nextMaintenanceMileage: input.nextMaintenanceMileage
      }
    };
  }

  async createRecord(fields: Record<string, unknown>, clientToken: string = crypto.randomUUID()): Promise<BitableRecord> {
    if (config.previewMode) {
      const record: BitableRecord = { record_id: `rec_preview_${crypto.randomUUID()}`, fields: this.previewTaskFields(fields) };
      this.previewRecords.push(record);
      return record;
    }
    const query = new URLSearchParams({ user_id_type: "open_id", client_token: clientToken });
    const data = await this.request<RecordData>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(config.bitableTableId)}/records?${query}`,
      { method: "POST", body: JSON.stringify({ fields }) }
    );
    if (!data.record) throw new Error("Lark create record returned no record");
    return data.record;
  }

  async updateRecord(
    recordId: string,
    fields: Record<string, unknown>,
    tableId = config.bitableTableId,
    usePhotoSyncAuthorization = false
  ): Promise<BitableRecord | undefined> {
    if (config.previewMode) {
      const record = this.previewRecords.find((item) => item.record_id === recordId);
      if (record) {
        record.fields = this.previewTaskFields({ ...record.fields, ...fields });
        return record;
      }
      for (const table of this.previewVehicleTables) {
        if (table.tableId !== tableId) continue;
        const vehicleRecord = table.records.find((item) => item.record_id === recordId);
        if (!vehicleRecord) continue;
        vehicleRecord.fields = { ...vehicleRecord.fields, ...fields };
        return vehicleRecord;
      }
      throw new Error("Preview record not found");
    }
    const query = new URLSearchParams({ user_id_type: "open_id" });
    const path = `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}?${query}`;
    const init = { method: "PUT", body: JSON.stringify({ fields }) };
    const data = usePhotoSyncAuthorization
      ? await this.requestWithAccessToken<RecordData>(await this.photoSyncToken(), path, init)
      : await this.request<RecordData>(path, init);
    return data.record;
  }

  async deleteRecord(recordId: string, tableId = config.bitableTableId): Promise<{ deleted: boolean; softDeleted: boolean }> {
    if (config.previewMode) {
      const index = this.previewRecords.findIndex((item) => item.record_id === recordId);
      if (index >= 0) {
        this.previewRecords.splice(index, 1);
        return { deleted: true, softDeleted: false };
      }
      throw new Error("Preview record not found");
    }
    const query = new URLSearchParams({ user_id_type: "open_id" });
    const path = `/open-apis/bitable/v1/apps/${encodeURIComponent(config.bitableAppToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}?${query}`;
    try {
      await this.request<unknown>(path, { method: "DELETE" });
      return { deleted: true, softDeleted: false };
    } catch (error) {
      // The tenant app may be allowed to read/update the Base while record
      // deletion is restricted to the Base administrator. Reuse the explicit
      // administrator OAuth grant used by vehicle profile writes when the app
      // identity is rejected, so the desktop delete action remains usable.
      const message = error instanceof Error ? error.message : String(error);
      if (!/(401|403|unauthorized|forbidden|RolePermNotAllow)/i.test(message)) throw error;
      if (this.photoSyncAccessToken) {
        try {
          await this.requestWithAccessToken<unknown>(await this.photoSyncToken(), path, { method: "DELETE" });
          return { deleted: true, softDeleted: false };
        } catch (adminError) {
          const adminMessage = adminError instanceof Error ? adminError.message : String(adminError);
          if (!/(401|403|unauthorized|forbidden|RolePermNotAllow)/i.test(adminMessage)) throw adminError;
        }
      }

      // Deletion may be disabled by the Base role even when record updates are
      // allowed. Keep the task auditable by falling back to a reversible
      // cancellation in the same table instead of losing the trip record.
      try {
        await this.updateRecord(recordId, { [config.fields.status]: "取消", [config.fields.result]: "已取消（删除权限不足，已归档）", [config.fields.error]: null }, tableId, !config.previewMode);
        return { deleted: false, softDeleted: true };
      } catch {
        throw error;
      }
    }
  }

  async sendTextMessage(target: NotificationTarget, text: string): Promise<void> {
    if (config.previewMode) return;
    const receiveIdType = target.type === "chat" ? "chat_id" : "open_id";
    const query = new URLSearchParams({ receive_id_type: receiveIdType });
    await this.request<unknown>(
      `/open-apis/im/v1/messages?${query}`,
      {
        method: "POST",
        body: JSON.stringify({
          receive_id: target.id,
          msg_type: "text",
          content: JSON.stringify({ text })
        })
      }
    );
  }

  async attachPhotos(recordId: string, phase: "departure" | "return", photos: PhotoUpload[], photoMeta: { checkResult?: string; notes?: string } = {}): Promise<{ recordId: string; uploaded: number; photoTime: string }> {
    if (!photos.length) throw new Error("至少需要上传一张车辆照片");
    const positions = new Set(photos.map((photo) => photo.position));
    if (positions.size !== photos.length) throw new Error("车辆照片方位不能重复");
    const now = new Date().toISOString();
    const first = photos[0];
    const photoTime = first.capturedAt || now;
    const attachmentField = phase === "departure" ? config.fields.departurePhotos : config.fields.returnPhotos;
    const timeField = phase === "departure" ? config.fields.departurePhotoTime : config.fields.returnPhotoTime;
    const checkResultField = phase === "departure" ? config.fields.departureCheckResult : config.fields.returnCheckResult;
    const notesField = phase === "departure" ? config.fields.departurePhotoNotes : config.fields.returnPhotoNotes;
    const attachments = await Promise.all(photos.map(async (photo): Promise<Record<string, unknown>> => {
      const fileName = `vehicle-${phase}-${photo.position}-${Date.now()}.jpg`;
      if (config.previewMode) {
        return { name: fileName, url: photo.dataUrl, file_token: `preview_file_${crypto.randomUUID()}` };
      }
      const media = await this.uploadMedia(fileName, photo.dataUrl);
      return { file_token: media.file_token, name: fileName };
    }));
    const fields: Record<string, unknown> = {
      [attachmentField]: attachments,
      [timeField]: dateTimeTimestamp(photoTime),
      [config.fields.stage]: phase === "departure" ? "出发前" : "返程待登记"
    };
    if (photoMeta.checkResult?.trim()) fields[checkResultField] = photoMeta.checkResult.trim();
    if (photoMeta.notes?.trim()) fields[notesField] = photoMeta.notes.trim();
    await this.updateRecord(recordId, fields, config.bitableTableId, !config.previewMode);
    return { recordId, uploaded: attachments.length, photoTime };
  }

  async completeReturn(recordId: string, returnOrigin: string, returnDestination: string, returnMileage: number, damageDescription: string, photoMeta: { checkResult?: string; notes?: string }, photos: PhotoUpload[]): Promise<{ recordId: string; vehicleSync: VehicleSyncResult; photoResult?: Awaited<ReturnType<LarkClient["attachPhotos"]>> }> {
    if (!Number.isFinite(returnMileage) || returnMileage < 0) throw new Error("返程公里数必须是非负数字");
    const record = await this.getRecord(recordId);
    const vehicle = textValue(record.fields[config.fields.vehicle]);
    await this.updateRecord(recordId, {
      [config.fields.returnOrigin]: returnOrigin.trim(),
      [config.fields.returnDestination]: returnDestination.trim(),
      [config.fields.returnMileage]: returnMileage,
      [config.fields.damageDescription]: damageDescription.trim(),
      [config.fields.returnCheckResult]: photoMeta.checkResult?.trim() || null,
      [config.fields.returnPhotoNotes]: photoMeta.notes?.trim() || null,
      [config.fields.stage]: "已返程",
      [config.fields.status]: "已完成"
    });
    const photoResult = photos.length ? await this.attachPhotos(recordId, "return", photos, photoMeta) : undefined;
    await this.updateRecord(recordId, { [config.fields.stage]: "已返程" });
    const match = vehicle ? await this.findVehicle(vehicle) : undefined;
    const vehicleSync = await this.syncVehicleMileage(vehicle, returnMileage, match);
    return { recordId, vehicleSync, photoResult };
  }

  private previewTaskFields(fields: Record<string, unknown>): Record<string, unknown> {
    if (!config.previewMode) return { ...fields };
    const current = numberValue(fields[config.fields.mileage]);
    const next = numberValue(fields[config.fields.nextMaintenanceMileage]);
    const reminder = current === null || next === null || current === 0 || next === 0
      ? "未设置"
      : current >= next ? "需要保养" : "正常";
    return { ...fields, [config.fields.maintenanceReminder]: reminder };
  }
}
