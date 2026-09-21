const runtimeEnvironment = process.env;

function integer(name: string, fallback: number): number {
  const raw = runtimeEnvironment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = runtimeEnvironment[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes"].includes(raw)) return true;
  if (["0", "false", "no"].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function optionalOrPreview(name: string, previewValue: string): string {
  const value = runtimeEnvironment[name]?.trim();
  if (value) return value;
  if (runtimeEnvironment.PREVIEW_MODE?.trim().toLowerCase() === "true") return previewValue;
  return "";
}

function listEnv(name: string, fallback: string): string[] {
  const raw = runtimeEnvironment[name]?.trim() || fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function buildConfig() {
  const previewMode = runtimeEnvironment.PREVIEW_MODE?.trim().toLowerCase() === "true";
  return {
  previewMode,
  larkAppId: optionalOrPreview("LARK_APP_ID", "cli_preview"),
  larkAppSecret: optionalOrPreview("LARK_APP_SECRET", "preview-secret"),
  bitableAppToken: optionalOrPreview("BITABLE_APP_TOKEN", "preview-base"),
  bitableTableId: optionalOrPreview("BITABLE_TABLE_ID", "preview-table"),
  storeBitableAppToken: optionalOrPreview("STORE_BITABLE_APP_TOKEN", "preview-store-base"),
  storeTableId: optionalOrPreview("STORE_TABLE_ID", "preview-store-table"),
  // The supplied Store Base uses `store` as its primary select field. Keep
  // legacy field names as fallbacks for older copies of the Base.
  storeNameFields: listEnv("STORE_NAME_FIELDS", "store,Single Option,门店名称,门店,Store Name,Store,名称,Name"),
  vehicleTableIds: listEnv("VEHICLE_TABLE_IDS", ""),
  vehicleTableNames: listEnv("VEHICLE_TABLE_NAMES", "Company Vehicle,Stores Vehicle"),
  vehicleInactiveKeywords: listEnv("VEHICLE_INACTIVE_KEYWORDS", "sold,已售,under maintenance,out of service,报废,维修中,停用"),
  contactRootDepartmentId: runtimeEnvironment.LARK_CONTACT_ROOT_DEPARTMENT_ID?.trim() || "0",
  internalApiToken: optionalOrPreview("INTERNAL_API_TOKEN", "preview-token"),
  larkOAuthRedirectUri: runtimeEnvironment.LARK_OAUTH_REDIRECT_URI?.trim() || "",
  larkOAuthScopes: runtimeEnvironment.LARK_OAUTH_SCOPES?.trim() || "",
  // Kept separate from normal sign-in so only an explicitly connected Base
  // administrator can grant Drive upload access for vehicle photos.
  // Kept separate from normal sign-in so only an explicitly connected Base
  // administrator can grant Drive upload and the matching Base-record update.
  larkPhotoSyncScopes: runtimeEnvironment.LARK_PHOTO_SYNC_SCOPES?.trim() || "drive:drive base:record:update offline_access",
  larkDefaultRole: runtimeEnvironment.LARK_DEFAULT_ROLE?.trim() || "dispatcher",
  authBootstrapAdminUsername: runtimeEnvironment.AUTH_BOOTSTRAP_ADMIN_USERNAME?.trim() || (previewMode ? "preview-admin" : ""),
  authBootstrapAdminPassword: runtimeEnvironment.AUTH_BOOTSTRAP_ADMIN_PASSWORD?.trim() || (previewMode ? "preview-admin-123" : ""),
  authStorePath: runtimeEnvironment.AUTH_STORE_PATH?.trim() || "./data/auth.json",
  larkPhotoSyncStorePath: runtimeEnvironment.LARK_PHOTO_SYNC_STORE_PATH?.trim() || "./data/lark-photo-sync.json",
  notificationSettingsPath: runtimeEnvironment.NOTIFICATION_SETTINGS_PATH?.trim() || "./data/notification-settings.json",
  vehicleAssetsStorePath: runtimeEnvironment.VEHICLE_ASSETS_STORE_PATH?.trim() || "./data/vehicle-assets.json",
  vehicleAssetsDirectory: runtimeEnvironment.VEHICLE_ASSETS_DIRECTORY?.trim() || "./data/vehicle-assets",
  trackerSyncEnabled: boolean("TRACKER_SYNC_ENABLED", false),
  trackerUsername: runtimeEnvironment.TRACKER_USERNAME?.trim() || "",
  trackerPassword: runtimeEnvironment.TRACKER_PASSWORD || "",
  trackerBaseUrl: runtimeEnvironment.TRACKER_BASE_URL?.trim() || "https://app.tracker.co.za",
  trackerStatusPath: runtimeEnvironment.TRACKER_STATUS_PATH?.trim() || "./data/tracker-status.json",
  trackerHistoryDirectory: runtimeEnvironment.TRACKER_HISTORY_DIRECTORY?.trim() || "./data/tracker-history",
  trackerHistoryRetentionDays: integer("TRACKER_HISTORY_RETENTION_DAYS", 90),
  trackerBrowserProfilePath: runtimeEnvironment.TRACKER_BROWSER_PROFILE_PATH?.trim() || "./data/tracker-browser-profile",
  trackerDownloadDirectory: runtimeEnvironment.TRACKER_DOWNLOAD_DIRECTORY?.trim() || "./data/tracker-downloads",
  trackerBrowserExecutablePath: runtimeEnvironment.TRACKER_BROWSER_EXECUTABLE_PATH?.trim() || "",
  trackerBrowserUserAgent: runtimeEnvironment.TRACKER_BROWSER_USER_AGENT?.trim() || "",
  trackerErrorScreenshotPath: runtimeEnvironment.TRACKER_ERROR_SCREENSHOT_PATH?.trim() || "",
  trackerHeadless: boolean("TRACKER_HEADLESS", true),
  trackerReportDownloadEnabled: boolean("TRACKER_REPORT_DOWNLOAD_ENABLED", false),
  trackerSyncIntervalMs: integer("TRACKER_SYNC_INTERVAL_SECONDS", 300) * 1000,
  trackerActiveSyncIntervalMs: integer("TRACKER_ACTIVE_SYNC_INTERVAL_SECONDS", 300) * 1000,
  trackerMinimumSyncIntervalMs: integer("TRACKER_MIN_SYNC_INTERVAL_SECONDS", 300) * 1000,
  trackerRetryIntervalMs: integer("TRACKER_RETRY_INTERVAL_SECONDS", 120) * 1000,
  trackerPageTimeoutMs: integer("TRACKER_PAGE_TIMEOUT_SECONDS", 90) * 1000,
  trackerActiveStatusKeywords: listEnv("TRACKER_ACTIVE_STATUS_KEYWORDS", "执行中,已出发,running,in progress"),
  trackerActivityUrl: runtimeEnvironment.TRACKER_ACTIVITY_URL?.trim() || "",
  authCookieSecure: boolean("AUTH_COOKIE_SECURE", runtimeEnvironment.NODE_ENV === "production"),
  authSessionTtlMs: integer("AUTH_SESSION_TTL_SECONDS", 60 * 60 * 12) * 1000,
  port: integer("PORT", 3000),
  pollIntervalMs: integer("POLL_INTERVAL_MS", 60_000),
  storePath: runtimeEnvironment.STORE_PATH?.trim() || "./data/dispatch.json",
  dispatchExecutorUrl: runtimeEnvironment.DISPATCH_EXECUTOR_URL?.trim() || "",
  // Directory and fleet reads are relatively expensive in Lark. Cache them
  // briefly so opening a second page does not rescan the same sources.
  optionsCacheTtlMs: integer("OPTIONS_CACHE_TTL_SECONDS", 300) * 1000,
  fields: {
    taskNumber: "任务编号",
    requester: "申请人",
    departureTime: "出发时间",
    origin: "起点",
    destination: "目的地",
    returnOrigin: "返程起点",
    returnDestination: "返程目的地",
    tripMode: "行程方式",
    transferLocation: "中转地点",
    vehicle: "车辆",
    vehicleModel: "车型描述",
    mileage: "当前公里数",
    nextMaintenanceMileage: "下次保养公里数",
    maintenanceReminder: "保养提醒",
    status: "调度状态",
    stage: "行程阶段",
    departurePhotos: "出发车辆照片",
    departurePhotoTime: "出发拍照时间",
    departureCheckResult: "出发检查结果",
    departurePhotoNotes: "出发照片备注",
    returnMileage: "返程公里数",
    returnPhotos: "返程车辆照片",
    returnPhotoTime: "返程拍照时间",
    returnCheckResult: "返程检查结果",
    returnPhotoNotes: "返程照片备注",
    damageDescription: "车辆损伤说明",
    appJobId: "自建应用任务ID",
    result: "执行结果",
    error: "错误信息"
  },
  vehicleFields: {
    plate: listEnv("VEHICLE_PLATE_FIELDS", "Number Plate | 车牌号码,Number Plate,车牌号码,车牌"),
    brand: listEnv("VEHICLE_BRAND_FIELDS", "Vehicle Brand | 车辆品牌,Vehicle Brand,车辆品牌,品牌"),
    model: listEnv("VEHICLE_MODEL_FIELDS", "Model | 车型,车型描述,车型,车辆型号,Vehicle Model,Model Description,Model"),
    type: listEnv("VEHICLE_TYPE_FIELDS", "Vehicle Type | 车辆类型,Vehicle Type,车辆类型"),
    status: listEnv("VEHICLE_STATUS_FIELDS", "Vehicle Status | 车辆状态,Vehicle Status,车辆状态"),
    owner: listEnv("VEHICLE_OWNER_FIELDS", "Store | 所属门店,Department | 所属部门,所属门店,所属部门"),
    year: listEnv("VEHICLE_YEAR_FIELDS", "Year | 年份,Year,年份"),
    photo: listEnv("VEHICLE_PHOTO_FIELDS", "Vehicle Photo | 车辆照片,车辆照片,车辆图片,Vehicle Photo,Photo,照片"),
    mileage: listEnv("VEHICLE_MILEAGE_FIELDS", "Maintenance mileage,当前公里数,当前里程,Mileage"),
    nextMaintenanceMileage: listEnv("VEHICLE_NEXT_MAINTENANCE_FIELDS", "Next Service Due | 下次保养里程,Next Service Due,下次保养里程,下次保养公里数"),
    nextMaintenanceDate: listEnv("VEHICLE_NEXT_MAINTENANCE_DATE_FIELDS", "Next Service Date | 下次保养日期,Next Service Date,下次保养日期"),
    registeringAuthority: listEnv("VEHICLE_REGISTERING_AUTHORITY_FIELDS", "Registering authority | 注册地点,Registering authority,注册地点"),
    lastServiceDate: listEnv("VEHICLE_LAST_SERVICE_DATE_FIELDS", "Last Service Date | 上次保养日期,Last Service Date,上次保养日期,Service Date"),
    serviceProvider: listEnv("VEHICLE_SERVICE_PROVIDER_FIELDS", "Service Provider | 服务提供商,Service Provider,服务提供商"),
    spareKey: listEnv("VEHICLE_SPARE_KEY_FIELDS", "Spare Key | 备用钥匙,Spare Key,备用钥匙"),
    registerNumber: listEnv("VEHICLE_REGISTER_NUMBER_FIELDS", "Register number | 注册号,Register number,注册号"),
    vehicleIdentificationNumber: listEnv("VEHICLE_IDENTIFICATION_NUMBER_FIELDS", "Vehicle identification number | 车辆ID,Vehicle identification number,车辆ID"),
    certificateExpiry: listEnv("VEHICLE_CERTIFICATE_EXPIRY_FIELDS", "Certificate Expiry | 证书有效期,Certificate Expiry,证书有效期"),
    logBook: listEnv("VEHICLE_LOG_BOOK_FIELDS", "log book | 车辆登记证书,log book,车辆登记证书,车辆大本,大本"),
    policyNumber: listEnv("VEHICLE_POLICY_NUMBER_FIELDS", "Policy Number | 保单号,Policy Number,保单号"),
    insurance: listEnv("VEHICLE_INSURANCE_FIELDS", "Insurance,保险"),
      fleetCardPhoto: listEnv("VEHICLE_FLEET_CARD_PHOTO_FIELDS", "Fuel card picture | 加油油卡图片,Fuel card picture,加油油卡图片,Fleet card picture,车队卡照片,车卡照片"),
      fnbFleetCard: listEnv("VEHICLE_FNB_FLEET_CARD_FIELDS", "Fuel Card | 加油油卡号,Fuel Card,加油油卡号,FNB Fleet Card,FNB车队卡,FNB 车队卡")
  }
  };
}

export const config = buildConfig();

export function assertLarkConfiguration(): void {
  const required = ["LARK_APP_ID", "LARK_APP_SECRET", "BITABLE_APP_TOKEN", "BITABLE_TABLE_ID", "STORE_BITABLE_APP_TOKEN", "STORE_TABLE_ID", "INTERNAL_API_TOKEN"];
  const missing = required.filter((name) => !runtimeEnvironment[name]?.trim());
  if (missing.length && !config.previewMode) throw new Error(`Missing required environment variable: ${missing.join(", ")}`);
}
