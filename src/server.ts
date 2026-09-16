import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { assertLarkConfiguration, config } from "./config.js";
import { AuthStore, type AccountRole, type AuthPrincipal, type Permission } from "./auth.js";
import { LarkClient } from "./lark.js";
import { JobStore } from "./store.js";
import { DispatchScheduler, taskFromRecord } from "./scheduler.js";
import { canAccessTask } from "./task.js";
import { numberValue, textValue } from "./value.js";
import { NotificationSettingsStore, type NotificationStage } from "./notification-settings.js";
import { VehicleAssetsStore } from "./vehicle-assets-store.js";
import { LarkPhotoSyncStore, oauthTokenData, tokenLifetimeMs } from "./lark-photo-sync-store.js";
import { TrackerHistoryStore } from "./tracker-history-store.js";
import { matchTrackerVehicle, normalizeTrackerIdentifier, trackerVehicleKey, TrackerStatusStore } from "./tracker-status-store.js";
import type { VehicleProfile } from "./types.js";

assertLarkConfiguration();
const photoSync = new LarkPhotoSyncStore();
const lark = new LarkClient(() => photoSync.accessToken());
const store = new JobStore();
const authStore = new AuthStore();
const scheduler = new DispatchScheduler(lark, store);
const notificationSettings = new NotificationSettingsStore();
const vehicleAssets = new VehicleAssetsStore();
const trackerStatus = new TrackerStatusStore();
const trackerHistory = new TrackerHistoryStore();
const app = express();
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");

// Vehicle inspection photos are intentionally kept at their original
// resolution.  Five originals can exceed 25 MB once encoded as a JSON
// data URL payload, so leave enough headroom for the JSON envelope too.
app.use(express.json({ limit: "60mb" }));

type RequestPrincipal = AuthPrincipal & { system: boolean };

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function vehicleWithLocalAssets<T extends { tableId: string; recordId: string; photoUrl: string }>(vehicle: T): T {
  const photo = vehicleAssets.profilePhoto(vehicle.tableId, vehicle.recordId);
  if (!photo) return vehicle;
  const base = `/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}/photo`;
  // The binary endpoint is cacheable, so its URL must change when a new
  // profile photo replaces the old file.  Without this token, browsers can
  // keep showing the previous thumbnail for up to a day.
  return {
    ...vehicle,
    photoUrl: `${base}/thumbnail?v=${encodeURIComponent(photo.thumbnail.id)}`,
    photoFullUrl: `${base}/full?v=${encodeURIComponent(photo.full.id)}`
  };
}

function vehiclesWithLocalAssets<T extends { tableId: string; recordId: string; photoUrl: string }>(vehicles: T[]): T[] {
  return vehicles.map(vehicleWithLocalAssets);
}

function normalizedDepartment(value: string): string {
  return value.toLowerCase().replace(/department|division|dept|部门|部/g, "").replace(/[^a-z0-9\u3400-\u9fff]/g, "");
}

function departmentScope(value: string): string {
  const normalized = normalizedDepartment(value);
  if (/administration|admin|行政/.test(normalized)) return "administration";
  if (/maintenance|repair|维护|维修/.test(normalized)) return "maintenance";
  if (/operations?|operation|运营/.test(normalized)) return "operations";
  if (/procurement|purchasing|采购/.test(normalized)) return "procurement";
  if (/warehouse|仓库/.test(normalized)) return "warehouse";
  if (/stores?|retail|门店/.test(normalized)) return "store";
  if (/tophida/.test(normalized)) return "tophida";
  return normalized;
}

function canViewAllVehicles(principal: RequestPrincipal): boolean {
  return principal.system || principal.role === "admin";
}

function canViewVehicle(principal: RequestPrincipal, vehicle: Pick<VehicleProfile, "owner">): boolean {
  if (canViewAllVehicles(principal)) return true;
  const principalDepartment = departmentScope(principal.department || "");
  const vehicleDepartment = departmentScope(vehicle.owner || "");
  if (!principalDepartment || !vehicleDepartment) return false;
  return principalDepartment === vehicleDepartment
    || (principalDepartment.length >= 3 && vehicleDepartment.includes(principalDepartment))
    || (vehicleDepartment.length >= 3 && principalDepartment.includes(vehicleDepartment));
}

function visibleVehicles(principal: RequestPrincipal, vehicles: VehicleProfile[]): VehicleProfile[] {
  return canViewAllVehicles(principal) ? vehicles : vehicles.filter((vehicle) => canViewVehicle(principal, vehicle));
}

function trackerStatusFor(principal: RequestPrincipal, vehicles: VehicleProfile[]) {
  const state = trackerStatus.read();
  const previousAttempt = Date.parse(state.lastAttemptAt || state.lastSuccessAt || "");
  const nextEligibleAt = Number.isFinite(previousAttempt)
    ? new Date(previousAttempt + config.trackerMinimumSyncIntervalMs).toISOString()
    : new Date().toISOString();
  const lastAttempt = Date.parse(state.lastAttemptAt || "");
  const lastSuccess = Date.parse(state.lastSuccessAt || "");
  return {
    version: state.version,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    syncFailed: Boolean(state.lastError && Number.isFinite(lastAttempt) && (!Number.isFinite(lastSuccess) || lastAttempt >= lastSuccess)),
    reportCreatedAt: state.reportCreatedAt,
    source: state.source,
    matches: vehicles.map((vehicle) => matchTrackerVehicle(state.records, vehicle)),
    refresh: {
      pending: Boolean(state.refreshRequest),
      requestedAt: state.refreshRequest?.requestedAt || null,
      nextEligibleAt,
      lastCompletedAt: state.lastRefreshCompletedAt
    },
    ...(principal.permissions.includes("manage_vehicles") ? { audit: state.audit.slice(-20) } : {})
  };
}

function uploadPayload(value: unknown, fallbackFileName: string): { fileName: string; dataUrl: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.dataUrl !== "string" || !item.dataUrl) return undefined;
  return { fileName: typeof item.fileName === "string" && item.fileName.trim() ? item.fileName.trim() : fallbackFileName, dataUrl: item.dataUrl };
}

function vehicleLogBookPayload(value: unknown): { fileName: string; dataUrl: string } | undefined {
  const upload = uploadPayload(value, `vehicle-log-book-${Date.now()}`);
  if (!upload) return undefined;
  const match = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/s.exec(upload.dataUrl);
  if (!match) throw new Error("车辆大本仅支持 PDF、JPG、PNG 或 WebP 文件");
  const size = Buffer.from(match[2], "base64").length;
  if (!size || size > 12 * 1024 * 1024) throw new Error("车辆大本文件大小必须介于 1 B 和 12 MB 之间");
  return upload;
}

function normalizeBitableDateTime(value: unknown): unknown {
  if (value === "" || value === null || value === undefined || typeof value === "number") return value ?? "";
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : value;
}

function normalizeTaskFields(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields, [config.fields.departureTime]: normalizeBitableDateTime(fields[config.fields.departureTime]) };
}

function cookieValue(req: Request, name: string): string {
  const header = req.header("cookie") || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function sessionPrincipal(req: Request): RequestPrincipal | null {
  const principal = authStore.getPrincipalBySession(cookieValue(req, "dispatch_session"));
  return principal ? { ...principal, system: false } : null;
}

function authorized(req: Request): boolean {
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const supplied = bearer || req.header("x-internal-api-token") || "";
  const expected = Buffer.from(config.internalApiToken);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function principalForRequest(req: Request): RequestPrincipal | null {
  if (authorized(req)) {
    return { accountId: "system", username: "system", displayName: "System", department: "", source: "local", role: "admin", permissions: ["mobile_dispatch", "desktop_console", "sync_dispatch", "manage_vehicles", "manage_accounts"], system: true };
  }
  return sessionPrincipal(req);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const principal = principalForRequest(req);
  if (!principal) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.locals.principal = principal;
  next();
}

function requirePermission(permission: Permission): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const principal = principalForRequest(req);
    if (!principal) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!principal.permissions.includes(permission)) {
      res.status(403).json({ error: "forbidden", permission });
      return;
    }
    res.locals.principal = principal;
    next();
  };
}

function safeNext(value: unknown): string {
  const target = typeof value === "string" ? value : "/?view=apply";
  return target.startsWith("/") && !target.startsWith("//") ? target : "/?view=apply";
}

function larkLoginRedirect(nextTarget: string): string {
  if (nextTarget === "/" || nextTarget === "/index.html" || nextTarget === "/?view=overview") return "/?view=apply";
  return nextTarget;
}

function applyDefaultRequester(fields: Record<string, unknown>, principal: RequestPrincipal): void {
  const current = fields[config.fields.requester];
  if (Array.isArray(current) && current.length > 0) return;
  const openId = principal.larkOpenId?.trim();
  if (openId) fields[config.fields.requester] = [{ id: openId }];
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = config.authCookieSecure ? "; Secure" : "";
  return `dispatch_session=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie(): string {
  const secure = config.authCookieSecure ? "; Secure" : "";
  return `dispatch_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

const oauthStates = new Map<string, { next: string; expiresAt: number; purpose: "login" | "photo_sync" | "account_add"; role?: AccountRole }>();

function notificationMessage(stage: NotificationStage, record: Awaited<ReturnType<LarkClient["getRecord"]>>): string {
  const task = taskFromRecord(record);
  const title = stage === "departure" ? "车辆出发" : stage === "return" ? "车辆返程" : "车辆预约";
  const time = stage === "return" ? new Date().toLocaleString("zh-CN", { hour12: false }) : task.departureTime?.toLocaleString("zh-CN", { hour12: false }) || "未填写";
  const mileage = stage === "return" ? (task.returnMileage === null ? "未填写" : `${task.returnMileage} km`) : (task.mileage === null ? "未填写" : `${task.mileage} km`);
  const details = stage === "return" && task.damageDescription ? `\n其他损伤：${task.damageDescription}` : "";
  const route = stage === "return" ? `${task.returnOrigin || task.destination || "未填写"} → ${task.returnDestination || task.origin || "未填写"}` : `${task.origin || "未填写"} → ${task.destination || "未填写"}`;
  return `【${title}】\n任务编号：${task.taskNumber || "未编号"}\n驾驶人：${task.requester || "未填写"}\n车辆：${task.vehicle || "未分配"}${task.vehicleModel ? `（${task.vehicleModel}）` : ""}\n时间：${time}\n路线：${route}\n公里数：${mileage}${details}`;
}

async function sendNotification(stage: NotificationStage, record: Awaited<ReturnType<LarkClient["getRecord"]>>, owner = ""): Promise<{ department: string; sent: number; failed: number; skipped?: string }> {
  const eventId = `${stage}:${record.record_id}`;
  const selected = notificationSettings.targetsFor(owner, stage);
  if (!selected.targets.length) return { department: selected.department, sent: 0, failed: 0, skipped: "未配置通知目标" };
  if (notificationSettings.wasSent(eventId)) return { department: selected.department, sent: 0, failed: 0, skipped: "该事件已发送" };
  const results = await Promise.allSettled(selected.targets.map((target) => lark.sendTextMessage(target, notificationMessage(stage, record))));
  const sent = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - sent;
  if (failed === 0 && sent > 0) notificationSettings.markSent(eventId, sent);
  if (failed > 0) console.warn("Lark notification delivery partially failed", { eventId, department: selected.department, sent, failed });
  return { department: selected.department, sent, failed };
}

function pruneOAuthStates(): void {
  const timestamp = Date.now();
  for (const [state, item] of oauthStates) if (item.expiresAt <= timestamp) oauthStates.delete(state);
}

function finishLogin(res: Response, principal: AuthPrincipal, nextTarget: string): void {
  const session = authStore.createSession(principal);
  const maxAge = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
  res.setHeader("Set-Cookie", sessionCookie(session.token, maxAge));
  res.json({ ok: true, redirect: nextTarget, user: principal });
}

function authErrorMessage(value: unknown): string {
  return typeof value === "string" && value.length < 180 ? value : "Lark 登录失败，请稍后重试";
}

app.get("/login", (_req, res) => {
  noStore(res);
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.sendFile(path.join(webRoot, "login.html"));
});

app.get("/admin-login", (_req, res) => {
  noStore(res);
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.sendFile(path.join(webRoot, "admin-login.html"));
});

app.get("/accounts", (req, res) => {
  const principal = sessionPrincipal(req);
  if (!principal) {
    res.redirect(`/admin-login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  if (!principal.permissions.includes("manage_accounts")) {
    res.status(403).send("账号管理需要管理员权限");
    return;
  }
  res.sendFile(path.join(webRoot, "accounts.html"));
});

app.get(["/", "/index.html"], (req, res) => {
  const principal = sessionPrincipal(req);
  if (!principal) {
    const requestedView = typeof req.query.view === "string" ? req.query.view : "apply";
    if (requestedView === "booking") {
      res.redirect(`/api/auth/lark/continue?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  const requestedView = typeof req.query.view === "string" ? req.query.view : "apply";
  if (!["apply", "departure", "transfer", "return", "overview", "booking", "history", "tracker-history", "settings", "vehicle-options", "edit", "vehicle", "vehicle-edit"].includes(requestedView)) {
    res.redirect("/?view=apply");
    return;
  }
  if (!["apply", "departure", "transfer", "return", "booking"].includes(requestedView) && !principal.permissions.includes("desktop_console")) {
    res.redirect("/?view=apply");
    return;
  }
  if (requestedView === "settings" && !principal.permissions.includes("manage_accounts")) {
    res.redirect("/?view=apply");
    return;
  }
  res.sendFile(path.join(webRoot, "index.html"));
});

app.use(express.static(webRoot, { index: false }));

app.get("/api/auth/providers", (_req, res) => {
  res.json({ ok: true, local: true, lark: Boolean(config.larkOAuthRedirectUri), preview: config.previewMode });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: res.locals.principal });
});

app.post("/api/auth/login", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const principal = authStore.authenticateLocal(username, password);
  if (!principal) {
    res.status(401).json({ error: "账号或密码错误，或账号已停用" });
    return;
  }
  const requested = safeNext(req.body?.next);
  const redirect = requested === "/" && !principal.permissions.includes("desktop_console") ? "/?view=apply" : requested;
  finishLogin(res, principal, redirect);
});

app.post("/api/auth/admin-login", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const principal = authStore.authenticateLocal(username, password);
  if (!principal || principal.role !== "admin") {
    res.status(401).json({ error: "管理员账号或密码错误" });
    return;
  }
  const requested = safeNext(req.body?.next);
  finishLogin(res, principal, requested === "/" ? "/?view=overview" : requested);
});

app.post("/api/auth/preview-login", (req, res) => {
  if (!config.previewMode) {
    res.status(404).json({ error: "preview login is disabled" });
    return;
  }
  const principal = authStore.authenticateLocal(config.authBootstrapAdminUsername, config.authBootstrapAdminPassword);
  if (!principal) {
    res.status(503).json({ error: "预览管理员账号未初始化" });
    return;
  }
  finishLogin(res, principal, safeNext(req.body?.next));
});

app.post("/api/auth/logout", (req, res) => {
  const token = cookieValue(req, "dispatch_session");
  if (token) authStore.deleteSession(token);
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/auth/lark/continue", (req, res) => {
  const nextTarget = larkLoginRedirect(safeNext(req.query.next));
  if (sessionPrincipal(req)) {
    res.redirect(nextTarget);
    return;
  }
  if (!config.larkOAuthRedirectUri) {
    res.redirect(`/login?next=${encodeURIComponent(nextTarget)}`);
    return;
  }
  res.redirect(`/api/auth/lark/start?next=${encodeURIComponent(nextTarget)}`);
});

app.get("/api/auth/lark/start", (req, res) => {
  if (!config.larkOAuthRedirectUri) {
    res.status(503).json({ error: "Lark OAuth 未配置，请设置 LARK_OAUTH_REDIRECT_URI" });
    return;
  }
  pruneOAuthStates();
  const nextTarget = safeNext(req.query.next);
  const state = crypto.randomBytes(32).toString("base64url");
  oauthStates.set(state, { next: nextTarget, expiresAt: Date.now() + 10 * 60 * 1000, purpose: "login" });
  console.info("Lark OAuth start", { next: nextTarget, redirectUri: config.larkOAuthRedirectUri });
  const authorizeUrl = new URL("https://accounts.larksuite.com/open-apis/authen/v1/authorize");
  authorizeUrl.searchParams.set("client_id", config.larkAppId);
  authorizeUrl.searchParams.set("redirect_uri", config.larkOAuthRedirectUri);
  authorizeUrl.searchParams.set("state", state);
  if (config.larkOAuthScopes) authorizeUrl.searchParams.set("scope", config.larkOAuthScopes);
  res.redirect(authorizeUrl.toString());
});

app.get("/api/admin/lark-photo-sync/status", requirePermission("manage_vehicles"), (_req, res) => {
  res.json({ ok: true, sync: photoSync.status() });
});

app.get("/api/admin/lark-photo-sync/start", requirePermission("manage_vehicles"), (_req, res) => {
  if (!config.larkOAuthRedirectUri) {
    res.status(503).send("Lark OAuth 未配置，请设置 LARK_OAUTH_REDIRECT_URI");
    return;
  }
  pruneOAuthStates();
  const state = crypto.randomBytes(32).toString("base64url");
  oauthStates.set(state, { next: "/?view=settings", expiresAt: Date.now() + 10 * 60 * 1000, purpose: "photo_sync" });
  const authorizeUrl = new URL("https://accounts.larksuite.com/open-apis/authen/v1/authorize");
  authorizeUrl.searchParams.set("client_id", config.larkAppId);
  authorizeUrl.searchParams.set("redirect_uri", config.larkOAuthRedirectUri);
  authorizeUrl.searchParams.set("state", state);
  if (config.larkPhotoSyncScopes) authorizeUrl.searchParams.set("scope", config.larkPhotoSyncScopes);
  res.redirect(authorizeUrl.toString());
});

app.get("/api/admin/lark-account/start", requirePermission("manage_accounts"), (req, res) => {
  if (!config.larkOAuthRedirectUri) {
    res.status(503).send("Lark OAuth 未配置，请设置 LARK_OAUTH_REDIRECT_URI");
    return;
  }
  pruneOAuthStates();
  const requestedRole = typeof req.query.role === "string" ? req.query.role : "dispatcher";
  const role: AccountRole = ["dispatcher", "scheduler", "fleet_manager", "admin"].includes(requestedRole) ? requestedRole as AccountRole : "dispatcher";
  const state = crypto.randomBytes(32).toString("base64url");
  oauthStates.set(state, { next: "/?view=apply&lark_account=added", expiresAt: Date.now() + 10 * 60 * 1000, purpose: "account_add", role });
  const authorizeUrl = new URL("https://accounts.larksuite.com/open-apis/authen/v1/authorize");
  authorizeUrl.searchParams.set("client_id", config.larkAppId);
  authorizeUrl.searchParams.set("redirect_uri", config.larkOAuthRedirectUri);
  authorizeUrl.searchParams.set("state", state);
  if (config.larkOAuthScopes) authorizeUrl.searchParams.set("scope", config.larkOAuthScopes);
  res.json({ ok: true, url: authorizeUrl.toString(), role });
});

app.get("/api/auth/lark/callback", async (req, res) => {
  pruneOAuthStates();
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stateData = oauthStates.get(state);
  oauthStates.delete(state);
  console.info("Lark OAuth callback", {
    hasState: Boolean(state),
    stateFound: Boolean(stateData),
    hasCode: typeof req.query.code === "string" && Boolean(req.query.code),
    error: typeof req.query.error === "string" ? req.query.error : ""
  });
  if (!stateData) {
    res.redirect("/login?error=登录状态已失效，请重新发起 Lark 登录");
    return;
  }
  const isPhotoSync = stateData.purpose === "photo_sync";
  const isAccountAdd = stateData.purpose === "account_add";
  const failureRedirect = (message: string): void => {
    console.warn("Lark OAuth failed", { purpose: stateData?.purpose || "unknown", message });
    const target = isPhotoSync ? `/?view=settings&photo_sync_error=${encodeURIComponent(message)}` : isAccountAdd ? `/accounts?lark_error=${encodeURIComponent(message)}` : `/login?error=${encodeURIComponent(message)}`;
    res.redirect(target);
  };
  if (typeof req.query.error === "string") {
    failureRedirect(isPhotoSync ? "飞书照片同步授权已取消" : "Lark 登录已取消");
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    failureRedirect(isPhotoSync ? "飞书未返回照片同步授权码" : "Lark 未返回授权码");
    return;
  }
  try {
    const tokenResponse = await fetch("https://open.larksuite.com/open-apis/authen/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ grant_type: "authorization_code", client_id: config.larkAppId, client_secret: config.larkAppSecret, code, redirect_uri: config.larkOAuthRedirectUri })
    });
    const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
    if (!tokenResponse.ok || (tokenPayload.code !== undefined && String(tokenPayload.code) !== "0")) throw new Error(authErrorMessage(tokenPayload.error_description || tokenPayload.error));
    const tokens = oauthTokenData(tokenPayload);
    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
    if (!accessToken) throw new Error("Lark 未返回访问令牌");
    if (isPhotoSync) {
      let authorizedBy = "已授权的 Base 管理员";
      try {
        const profileResponse = await fetch("https://open.larksuite.com/open-apis/authen/v1/user_info", { headers: { Authorization: `Bearer ${accessToken}` } });
        const profilePayload = await profileResponse.json() as Record<string, unknown>;
        const profile = profilePayload.data as Record<string, unknown> | undefined;
        if (profileResponse.ok && String(profilePayload.code) === "0") authorizedBy = String(profile?.name || profile?.en_name || authorizedBy);
      } catch {
        // The user identity is cosmetic. Drive sync remains valid without it.
      }
      photoSync.save({ accessToken, refreshToken, expiresAt: Date.now() + tokenLifetimeMs(tokens), authorizedAt: Date.now(), authorizedBy });
      res.redirect("/?view=settings&photo_sync=connected");
      return;
    }
    const userResponse = await fetch("https://open.larksuite.com/open-apis/authen/v1/user_info", { headers: { Authorization: `Bearer ${accessToken}` } });
    const userPayload = await userResponse.json() as Record<string, unknown>;
    const userData = userPayload.data as Record<string, unknown> | undefined;
    if (!userResponse.ok || String(userPayload.code) !== "0" || !userData?.open_id) throw new Error(authErrorMessage(userPayload.msg));
    const principal = authStore.upsertLarkAccount({ openId: String(userData.open_id), name: String(userData.name || ""), enName: String(userData.en_name || ""), email: String(userData.enterprise_email || userData.email || "") });
    if (isAccountAdd && stateData.role) authStore.updateAccount(principal.accountId, { role: stateData.role, active: true });
    if (isAccountAdd) {
      const grantedPrincipal = authStore.getPrincipal(principal.accountId) || principal;
      const session = authStore.createSession(grantedPrincipal);
      const maxAge = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
      res.setHeader("Set-Cookie", sessionCookie(session.token, maxAge));
      res.redirect(`${stateData.next}&name=${encodeURIComponent(grantedPrincipal.displayName)}`);
      return;
    }
    const session = authStore.createSession(principal);
    const maxAge = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
    res.setHeader("Set-Cookie", sessionCookie(session.token, maxAge));
    res.redirect(larkLoginRedirect(stateData.next));
  } catch (error) {
    const message = authErrorMessage(error instanceof Error ? error.message : error);
    if (isPhotoSync) console.warn("Lark photo-sync OAuth callback failed:", message);
    failureRedirect(message);
  }
});

app.get("/api/auth/accounts", requirePermission("manage_accounts"), (_req, res) => {
  res.json({ ok: true, accounts: authStore.listAccounts() });
});

app.post("/api/auth/accounts", requirePermission("manage_accounts"), (req, res, next) => {
  try {
    const role = typeof req.body?.role === "string" ? req.body.role : "dispatcher";
    const account = authStore.createLocalAccount(String(req.body?.username || ""), String(req.body?.displayName || ""), String(req.body?.department || ""), String(req.body?.password || ""), role as Parameters<AuthStore["createLocalAccount"]>[4]);
    res.status(201).json({ ok: true, account });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/auth/accounts/:accountId", requirePermission("manage_accounts"), (req, res, next) => {
  try {
    const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
    const patch: { displayName?: string; department?: string; role?: string; active?: boolean } = {};
    if (typeof req.body?.displayName === "string") patch.displayName = req.body.displayName;
    if (typeof req.body?.department === "string") patch.department = req.body.department;
    if (typeof req.body?.role === "string") patch.role = req.body.role;
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    res.json({ ok: true, account: authStore.updateAccount(accountId, patch) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/notification-settings", requirePermission("manage_accounts"), (_req, res) => {
  res.json({ ok: true, departments: notificationSettings.list() });
});

app.put("/api/admin/notification-settings", requirePermission("manage_accounts"), (req, res, next) => {
  try {
    if (!Array.isArray(req.body?.departments)) {
      res.status(400).json({ error: "departments array is required" });
      return;
    }
    res.json({ ok: true, departments: notificationSettings.update(req.body.departments) });
  } catch (error) {
    next(error);
  }
});

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const statusCode = error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;
  res.status(statusCode).json({ error: message });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "lark-dispatch-backend", previewMode: config.previewMode, executorConfigured: Boolean(config.dispatchExecutorUrl) });
});

app.get("/api/tasks", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const records = await lark.listRecords();
    const principal = res.locals.principal as RequestPrincipal;
    const tasks = records.map(taskFromRecord).filter((task) => canAccessTask(task, principal));
    res.json({ ok: true, tasks });
  } catch (error) {
    next(error);
  }
});

app.post("/api/bookings", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const input = req.body?.fields;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      res.status(400).json({ error: "fields object is required" });
      return;
    }
    const principal = res.locals.principal as RequestPrincipal;
    const fields: Record<string, unknown> = normalizeTaskFields({
      ...(input as Record<string, unknown>),
      [config.fields.status]: "已预约",
      [config.fields.result]: "预约待确认"
    });
    applyDefaultRequester(fields, principal);
    const required = [config.fields.departureTime, config.fields.origin, config.fields.destination, config.fields.vehicle];
    if (required.some((field) => !textValue(fields[field]).trim())) {
      res.status(400).json({ error: "预约出发时间、起点、目的地和车辆均为必填项" });
      return;
    }
    const requester = fields[config.fields.requester];
    if (!Array.isArray(requester) || requester.length === 0) {
      res.status(400).json({ error: "请选择驾驶人" });
      return;
    }
    const prepared = await lark.prepareTaskFields(fields);
    const record = await lark.createRecord(prepared.fields, typeof req.body?.clientToken === "string" ? req.body.clientToken : undefined);
    const notification = await sendNotification("booking", record, prepared.match.vehicle?.owner || "");
    res.status(201).json({ ok: true, recordId: record.record_id, vehicleMatch: prepared.match, notification });
  } catch (error) {
    next(error);
  }
});

app.post("/api/bookings/:recordId/decision", requirePermission("sync_dispatch"), async (req, res, next) => {
  try {
    const recordId = routeParam(req.params.recordId);
    const decision = req.body?.decision === "approve" ? "approve" : req.body?.decision === "reject" ? "reject" : "";
    if (!decision) {
      res.status(400).json({ error: "decision must be approve or reject" });
      return;
    }
    const current = await lark.getRecord(recordId);
    const task = taskFromRecord(current);
    if (task.status !== "已预约") {
      res.status(409).json({ error: "仅可处理待确认的车辆预约" });
      return;
    }
    const approved = decision === "approve";
    const record = await lark.updateRecord(recordId, {
      [config.fields.status]: approved ? "已排程" : "取消",
      [config.fields.result]: approved ? "预约已同意，等待出发" : "预约未同意",
      [config.fields.error]: null
    });
    res.json({ ok: true, recordId: record?.record_id || recordId, status: approved ? "已排程" : "取消" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/options", requirePermission("mobile_dispatch"), async (_req, res, next) => {
  try {
    const principal = res.locals.principal as RequestPrincipal;
    const warnings: string[] = [];
    const [users, vehicles, stores] = await Promise.all([
      lark.listUsers(),
      lark.listVehicles(),
      lark.listStores().catch((error) => {
        warnings.push(`门店快捷选项暂不可用：${error instanceof Error ? error.message : String(error)}`);
        return [];
      })
    ]);
    res.json({ ok: true, users, vehicles: vehiclesWithLocalAssets(visibleVehicles(principal, vehicles)), stores, warnings });
  } catch (error) {
    next(error);
  }
});

// Keep the option sources independently loadable. The directory can take
// longer than the fleet tables, so the UI can render vehicles and stores
// without waiting for every contact page to finish.
app.get("/api/options/users", requirePermission("mobile_dispatch"), async (_req, res, next) => {
  try {
    res.json({ ok: true, users: await lark.listUsers() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/options/vehicles", requirePermission("mobile_dispatch"), async (_req, res, next) => {
  try {
    const principal = res.locals.principal as RequestPrincipal;
    res.json({ ok: true, vehicles: vehiclesWithLocalAssets(visibleVehicles(principal, await lark.listVehicles())) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/options/stores", requirePermission("mobile_dispatch"), async (_req, res, next) => {
  try {
    res.json({ ok: true, stores: await lark.listStores() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/options/vehicle-fields", requirePermission("manage_vehicles"), async (_req, res, next) => {
  try {
    res.json({ ok: true, options: await lark.listVehicleFieldOptions() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/vehicle-field-options", requirePermission("manage_vehicles"), async (_req, res, next) => {
  try {
    res.json({ ok: true, ...(await lark.listVehicleFieldDefinitions()) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/vehicle-field-options", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const tableId = typeof req.body?.tableId === "string" ? req.body.tableId.trim() : "";
    const fieldId = typeof req.body?.fieldId === "string" ? req.body.fieldId.trim() : "";
    const options = Array.isArray(req.body?.options) ? req.body.options.filter((value: unknown): value is string => typeof value === "string") : [];
    if (!tableId || !fieldId || !options.length) {
      res.status(400).json({ error: "tableId、fieldId 和 options 为必填项" });
      return;
    }
    res.json({ ok: true, field: await lark.updateVehicleFieldOptions(tableId, fieldId, options) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/vehicles", requirePermission("mobile_dispatch"), async (_req, res, next) => {
  try {
    const principal = res.locals.principal as RequestPrincipal;
    res.json({ ok: true, vehicles: vehiclesWithLocalAssets(visibleVehicles(principal, await lark.listVehicles())) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tracker/status", requirePermission("mobile_dispatch"), async (_req, res, next) => {
  try {
    noStore(res);
    const principal = res.locals.principal as RequestPrincipal;
    const vehicles = visibleVehicles(principal, await lark.listVehicles());
    res.json({ ok: true, enabled: config.trackerSyncEnabled, trackerStatus: trackerStatusFor(principal, vehicles) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tracker/history", requirePermission("desktop_console"), async (req, res, next) => {
  try {
    noStore(res);
    const principal = res.locals.principal as RequestPrincipal;
    const vehicles = visibleVehicles(principal, await lark.listVehicles());
    const trackerState = trackerStatus.read();
    const metadataByRegistration = new Map<string, VehicleProfile>();
    const metadataByVin = new Map<string, VehicleProfile>();
    const allowedRegistrations = canViewAllVehicles(principal) ? undefined : new Set<string>();
    const allowedVins = canViewAllVehicles(principal) ? undefined : new Set<string>();

    for (const vehicle of vehicles) {
      const match = matchTrackerVehicle(trackerState.records, vehicle);
      const registrations = [vehicle.plate, match.snapshot?.registration]
        .map(normalizeTrackerIdentifier)
        .filter(Boolean);
      const vins = [vehicle.vehicleIdentificationNumber, match.snapshot?.vin]
        .map(normalizeTrackerIdentifier)
        .filter(Boolean);
      for (const registration of registrations) {
        if (!metadataByRegistration.has(registration)) metadataByRegistration.set(registration, vehicle);
        allowedRegistrations?.add(registration);
      }
      for (const vin of vins) {
        if (!metadataByVin.has(vin)) metadataByVin.set(vin, vehicle);
        allowedVins?.add(vin);
      }
    }

    let selectedRegistrations: Set<string> | undefined;
    let selectedVins: Set<string> | undefined;
    const selectedVehicleKey = typeof req.query.vehicleKey === "string" ? req.query.vehicleKey.trim() : "";
    if (selectedVehicleKey) {
      const vehicle = vehicles.find((item) => trackerVehicleKey(item) === selectedVehicleKey);
      if (!vehicle) {
        res.status(404).json({ error: "未找到可访问的车辆" });
        return;
      }
      const match = matchTrackerVehicle(trackerState.records, vehicle);
      selectedRegistrations = new Set([vehicle.plate, match.snapshot?.registration].map(normalizeTrackerIdentifier).filter(Boolean));
      selectedVins = new Set([vehicle.vehicleIdentificationNumber, match.snapshot?.vin].map(normalizeTrackerIdentifier).filter(Boolean));
    }

    const now = new Date();
    const from = new Date(typeof req.query.from === "string" ? req.query.from : now.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(typeof req.query.to === "string" ? req.query.to : now);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getTime() > to.getTime()) {
      res.status(400).json({ error: "查询起止时间无效" });
      return;
    }
    const limit = Math.max(10, Math.min(500, Number.parseInt(String(req.query.limit || "100"), 10) || 100));
    const offset = Math.max(0, Math.min(100_000, Number.parseInt(String(req.query.offset || "0"), 10) || 0));
    const order = req.query.order === "asc" ? "asc" : "desc";
    const result = await trackerHistory.query({
      from,
      to,
      order,
      limit,
      offset,
      query: typeof req.query.q === "string" ? req.query.q.slice(0, 160) : "",
      status: typeof req.query.status === "string" ? req.query.status.slice(0, 80) : "",
      allowedRegistrations,
      allowedVins,
      selectedRegistrations,
      selectedVins
    });
    res.json({
      ok: true,
      query: { vehicleKey: selectedVehicleKey, from: from.toISOString(), to: to.toISOString(), order, limit, offset },
      ...result,
      entries: result.entries.map((entry) => {
        const vehicle = metadataByRegistration.get(normalizeTrackerIdentifier(entry.registration))
          || metadataByVin.get(normalizeTrackerIdentifier(entry.vin));
        return {
          ...entry,
          vehicle: vehicle ? {
            vehicleKey: trackerVehicleKey(vehicle),
            tableId: vehicle.tableId,
            recordId: vehicle.recordId,
            plate: vehicle.plate,
            modelDescription: vehicle.modelDescription,
            owner: vehicle.owner
          } : null
        };
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tracker/refresh", requirePermission("manage_vehicles"), (_req, res) => {
  noStore(res);
  if (!config.trackerSyncEnabled) {
    res.status(409).json({ error: "Tracker 自动同步未启用，无法排队刷新。" });
    return;
  }
  const principal = res.locals.principal as RequestPrincipal;
  const state = trackerStatus.requestRefresh(`${principal.displayName} (${principal.accountId})`);
  const previousAttempt = Date.parse(state.lastAttemptAt || state.lastSuccessAt || "");
  const nextEligibleAt = Number.isFinite(previousAttempt)
    ? new Date(previousAttempt + config.trackerMinimumSyncIntervalMs).toISOString()
    : new Date().toISOString();
  res.status(202).json({
    ok: true,
    message: "Tracker 刷新已排队；系统会在安全间隔到期后执行。",
    refresh: { pending: true, requestedAt: state.refreshRequest?.requestedAt || null, nextEligibleAt }
  });
});

app.get("/api/vehicles/lookup", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const principal = res.locals.principal as RequestPrincipal;
    const plate = typeof req.query.plate === "string" ? req.query.plate.trim() : "";
    if (!plate) {
      res.status(400).json({ error: "plate is required" });
      return;
    }
    const match = await lark.findVehicle(plate);
    if (match.vehicle && !canViewVehicle(principal, match.vehicle)) {
      res.json({ ok: true, match: { status: "not_found", query: plate, message: "当前部门没有可访问的车辆档案" } });
      return;
    }
    res.json({ ok: true, match: match.vehicle ? { ...match, vehicle: vehicleWithLocalAssets(match.vehicle) } : match });
  } catch (error) {
    next(error);
  }
});

app.get("/api/vehicles/:tableId/:recordId/photo/:variant", requirePermission("mobile_dispatch"), (req, res) => {
  const tableId = routeParam(req.params.tableId);
  const recordId = routeParam(req.params.recordId);
  const variant = routeParam(req.params.variant);
  if (variant !== "full" && variant !== "thumbnail") {
    res.status(404).json({ error: "photo variant not found" });
    return;
  }
  const file = vehicleAssets.profilePhotoFile(tableId, recordId, variant);
  const filePath = file ? vehicleAssets.absolutePath(file) : undefined;
  if (!file || !filePath) {
    res.status(404).json({ error: "vehicle photo not found" });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.type(file.mimeType);
  res.sendFile(filePath);
});

app.get("/api/vehicles/:tableId/:recordId/log-book/:fileToken", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const tableId = routeParam(req.params.tableId);
    const recordId = routeParam(req.params.recordId);
    const fileToken = routeParam(req.params.fileToken);
    const file = await lark.downloadVehicleLogBook(tableId, recordId, fileToken);
    const safeName = file.fileName.replace(/[\r\n"\\]/g, "_");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.type(file.mimeType);
    res.send(file.content);
  } catch (error) {
    next(error);
  }
});

app.get("/api/vehicles/:tableId/:recordId/maintenance", requirePermission("manage_vehicles"), (req, res) => {
  const tableId = routeParam(req.params.tableId);
  const recordId = routeParam(req.params.recordId);
  res.json({ ok: true, records: vehicleAssets.maintenanceFor(tableId, recordId) });
});

app.get("/api/vehicles/:tableId/:recordId/maintenance/:maintenanceId/warranty", requirePermission("manage_vehicles"), (req, res) => {
  const tableId = routeParam(req.params.tableId);
  const recordId = routeParam(req.params.recordId);
  const maintenanceId = routeParam(req.params.maintenanceId);
  const file = vehicleAssets.maintenanceDocument(tableId, recordId, maintenanceId);
  const filePath = file ? vehicleAssets.absolutePath(file) : undefined;
  if (!file || !filePath) {
    res.status(404).json({ error: "warranty document not found" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.type(file.mimeType);
  res.sendFile(filePath);
});

app.post("/api/vehicles/:tableId/:recordId/maintenance", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const tableId = routeParam(req.params.tableId);
    const recordId = routeParam(req.params.recordId);
    const serviceDate = typeof req.body?.serviceDate === "string" ? req.body.serviceDate.trim() : "";
    const provider = typeof req.body?.provider === "string" ? req.body.provider.trim() : "";
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    const rawMileage = req.body?.mileage;
    const mileage = rawMileage === "" || rawMileage === null || rawMileage === undefined ? null : Number(rawMileage);
    const nextMaintenanceDate = typeof req.body?.nextMaintenanceDate === "string" ? req.body.nextMaintenanceDate.trim() : "";
    const rawNextMaintenanceMileage = req.body?.nextMaintenanceMileage;
    const nextMaintenanceMileage = rawNextMaintenanceMileage === "" || rawNextMaintenanceMileage === null || rawNextMaintenanceMileage === undefined ? null : Number(rawNextMaintenanceMileage);
    if (!serviceDate || Number.isNaN(new Date(serviceDate).getTime())) throw new Error("请填写有效的保养日期");
    if (mileage !== null && (!Number.isFinite(mileage) || mileage < 0)) throw new Error("保养公里数必须是非负数字");
    if (!nextMaintenanceDate || Number.isNaN(new Date(nextMaintenanceDate).getTime())) throw new Error("请填写有效的下次保养日期");
    if (nextMaintenanceMileage === null || !Number.isFinite(nextMaintenanceMileage) || nextMaintenanceMileage < 0) throw new Error("请填写有效的下次保养公里数");
    if (provider.length > 180 || notes.length > 4000) throw new Error("保养服务商或说明内容过长");
    const warrantyDocument = uploadPayload(req.body?.warrantyDocument, `warranty-${Date.now()}`);
    const result = await lark.confirmVehicleMaintenance(tableId, recordId, { serviceDate, mileage, provider, notes, nextMaintenanceDate, nextMaintenanceMileage });
    const principal = res.locals.principal as RequestPrincipal;
    const record = vehicleAssets.addMaintenance({
      tableId,
      recordId,
      plate: result.vehicle.plate,
      serviceDate,
      mileage,
      nextMaintenanceDate,
      nextMaintenanceMileage,
      provider,
      notes,
      confirmedBy: principal.displayName || principal.username,
      updatedBaseFields: result.updatedBaseFields,
      warrantyDocument
    });
    res.status(201).json({ ok: true, record, vehicle: vehicleWithLocalAssets(result.vehicle) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/vehicles", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const tableId = typeof body.tableId === "string" ? body.tableId : "";
    const numberOrNull = (value: unknown): number | null => {
      if (value === "" || value === null || value === undefined) return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error("公里数必须是非负数字");
      return number;
    };
    const status = typeof body.status === "string" ? body.status.trim() : "";
    if (!/^sold$|^已售$/i.test(status)) throw new Error("通过此入口新增的车辆必须标记为已售");
    const fullPhotoDataUrl = typeof body.photoFullDataUrl === "string" ? body.photoFullDataUrl : "";
    const thumbnailPhotoDataUrl = typeof body.photoThumbnailDataUrl === "string" ? body.photoThumbnailDataUrl : "";
    const logBookDocument = vehicleLogBookPayload(body.logBookDocument);
    if (Boolean(fullPhotoDataUrl) !== Boolean(thumbnailPhotoDataUrl)) throw new Error("车辆照片需要同时提交原图和缩略图");
    const vehicle = await lark.createVehicleProfile(tableId, {
      plate: typeof body.plate === "string" ? body.plate : "",
      brand: typeof body.brand === "string" ? body.brand : "",
      model: typeof body.model === "string" ? body.model : "",
      vehicleType: typeof body.vehicleType === "string" ? body.vehicleType : "",
      status,
      owner: typeof body.owner === "string" ? body.owner : "",
      year: typeof body.year === "string" ? body.year : "",
      registeringAuthority: typeof body.registeringAuthority === "string" ? body.registeringAuthority : "",
      lastServiceDate: typeof body.lastServiceDate === "string" ? body.lastServiceDate : "",
      serviceProvider: typeof body.serviceProvider === "string" ? body.serviceProvider : "",
      spareKey: typeof body.spareKey === "string" ? body.spareKey : "",
      registerNumber: typeof body.registerNumber === "string" ? body.registerNumber : "",
      vehicleIdentificationNumber: typeof body.vehicleIdentificationNumber === "string" ? body.vehicleIdentificationNumber : "",
      certificateExpiry: typeof body.certificateExpiry === "string" ? body.certificateExpiry : "",
      logBookDocument,
      policyNumber: typeof body.policyNumber === "string" ? body.policyNumber : "",
      insurance: typeof body.insurance === "string" ? body.insurance : "",
      fnbFleetCard: typeof body.fnbFleetCard === "string" ? body.fnbFleetCard : "",
      mileage: numberOrNull(body.mileage),
      nextMaintenanceMileage: numberOrNull(body.nextMaintenanceMileage),
      nextMaintenanceDate: typeof body.nextMaintenanceDate === "string" ? body.nextMaintenanceDate : "",
      photoDataUrl: thumbnailPhotoDataUrl || undefined,
      fleetCardPhotoDataUrl: typeof body.fleetCardPhotoDataUrl === "string" ? body.fleetCardPhotoDataUrl : undefined
    });
    if (fullPhotoDataUrl && thumbnailPhotoDataUrl) {
      const fileName = typeof body.photoFileName === "string" ? body.photoFileName : `vehicle-${Date.now()}.jpg`;
      vehicleAssets.saveProfilePhoto(vehicle.tableId, vehicle.recordId, { fileName, dataUrl: fullPhotoDataUrl }, { fileName: `thumbnail-${fileName}`, dataUrl: thumbnailPhotoDataUrl });
    }
    res.status(201).json({ ok: true, vehicle: vehicleWithLocalAssets(vehicle) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/vehicles/:tableId/:recordId", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const tableId = routeParam(req.params.tableId);
    const recordId = routeParam(req.params.recordId);
    const body = req.body || {};
    const numberOrNull = (value: unknown): number | null => {
      if (value === "" || value === null || value === undefined) return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error("公里数必须是非负数字");
      return number;
    };
    const fullPhotoDataUrl = typeof body.photoFullDataUrl === "string" ? body.photoFullDataUrl : typeof body.photoDataUrl === "string" ? body.photoDataUrl : "";
    const thumbnailPhotoDataUrl = typeof body.photoThumbnailDataUrl === "string" ? body.photoThumbnailDataUrl : typeof body.photoDataUrl === "string" ? body.photoDataUrl : "";
    const logBookDocument = vehicleLogBookPayload(body.logBookDocument);
    if (Boolean(fullPhotoDataUrl) !== Boolean(thumbnailPhotoDataUrl)) throw new Error("车辆照片需要同时提交原图和缩略图");
    const vehicle = await lark.updateVehicleProfile(tableId, recordId, {
      plate: typeof body.plate === "string" ? body.plate : "",
      brand: typeof body.brand === "string" ? body.brand : "",
      model: typeof body.model === "string" ? body.model : "",
      vehicleType: typeof body.vehicleType === "string" ? body.vehicleType : "",
      status: typeof body.status === "string" ? body.status : "",
      owner: typeof body.owner === "string" ? body.owner : "",
      year: typeof body.year === "string" ? body.year : "",
      registeringAuthority: typeof body.registeringAuthority === "string" ? body.registeringAuthority : "",
      lastServiceDate: typeof body.lastServiceDate === "string" ? body.lastServiceDate : "",
      serviceProvider: typeof body.serviceProvider === "string" ? body.serviceProvider : "",
      spareKey: typeof body.spareKey === "string" ? body.spareKey : "",
      registerNumber: typeof body.registerNumber === "string" ? body.registerNumber : "",
      vehicleIdentificationNumber: typeof body.vehicleIdentificationNumber === "string" ? body.vehicleIdentificationNumber : "",
      certificateExpiry: typeof body.certificateExpiry === "string" ? body.certificateExpiry : "",
      logBookDocument,
      policyNumber: typeof body.policyNumber === "string" ? body.policyNumber : "",
      insurance: typeof body.insurance === "string" ? body.insurance : "",
      fnbFleetCard: typeof body.fnbFleetCard === "string" ? body.fnbFleetCard : "",
      mileage: numberOrNull(body.mileage),
      nextMaintenanceMileage: numberOrNull(body.nextMaintenanceMileage),
      nextMaintenanceDate: typeof body.nextMaintenanceDate === "string" ? body.nextMaintenanceDate : "",
      // Keep the Base attachment lightweight. The full-resolution source is
      // retained locally and loaded only from the vehicle detail screen.
      photoDataUrl: thumbnailPhotoDataUrl || undefined,
      fleetCardPhotoDataUrl: typeof body.fleetCardPhotoDataUrl === "string" ? body.fleetCardPhotoDataUrl : undefined
    });
    if (fullPhotoDataUrl && thumbnailPhotoDataUrl) {
      const fileName = typeof body.photoFileName === "string" ? body.photoFileName : `vehicle-${Date.now()}.jpg`;
      vehicleAssets.saveProfilePhoto(tableId, recordId, { fileName, dataUrl: fullPhotoDataUrl }, { fileName: `thumbnail-${fileName}`, dataUrl: thumbnailPhotoDataUrl });
    }
    res.json({ ok: true, vehicle: vehicleWithLocalAssets(vehicle) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/vehicles/:tableId/:recordId/sold", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const tableId = routeParam(req.params.tableId);
    const recordId = routeParam(req.params.recordId);
    const vehicle = await lark.markVehicleSold(tableId, recordId);
    res.json({ ok: true, vehicle: vehicleWithLocalAssets(vehicle) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/vehicles/:tableId/:recordId", requirePermission("manage_vehicles"), async (req, res, next) => {
  try {
    const tableId = routeParam(req.params.tableId);
    const recordId = routeParam(req.params.recordId);
    const vehicle = await lark.deleteVehicleProfile(tableId, recordId);
    let assetsCleaned = true;
    try {
      vehicleAssets.deleteVehicleAssets(tableId, recordId);
    } catch (cleanupError) {
      assetsCleaned = false;
      console.error("Vehicle asset cleanup failed after Base deletion", cleanupError);
    }
    res.json({ ok: true, deleted: true, assetsCleaned, vehicle: { tableId: vehicle.tableId, recordId: vehicle.recordId, plate: vehicle.plate } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sync", requirePermission("sync_dispatch"), async (_req, res, next) => {
  try {
    res.json({ ok: true, ...await scheduler.syncOnce() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/executor/callback", requireAuth, async (req, res, next) => {
  try {
    const { jobId, status, result, error } = req.body || {};
    if (typeof jobId !== "string" || typeof status !== "string") {
      res.status(400).json({ error: "jobId and status are required" });
      return;
    }
    await scheduler.updateFromCallback({ jobId, status, result, error });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const fields = req.body?.fields;
    const clientToken = req.body?.clientToken;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      res.status(400).json({ error: "fields object is required" });
      return;
    }
    if (clientToken !== undefined && typeof clientToken !== "string") {
      res.status(400).json({ error: "clientToken must be a uuidv4 string" });
      return;
    }
    const principal = res.locals.principal as RequestPrincipal;
    let preparedFields = normalizeTaskFields(fields as Record<string, unknown>);
    if (!textValue(preparedFields[config.fields.status]).trim()) preparedFields[config.fields.status] = "待调度";
    applyDefaultRequester(preparedFields, principal);
    const requester = preparedFields[config.fields.requester];
    if (!Array.isArray(requester) || requester.length === 0) {
      res.status(400).json({ error: "请选择驾驶人" });
      return;
    }
    let vehicleMatch: unknown = null;
    try {
      const prepared = await lark.prepareTaskFields(preparedFields);
      preparedFields = prepared.fields;
      vehicleMatch = prepared.match;
    } catch (error) {
      vehicleMatch = { status: "unavailable", message: error instanceof Error ? error.message : String(error) };
    }

    const record = await lark.createRecord(preparedFields, clientToken);
    let vehicleSync: unknown = null;
    try {
      const match = vehicleMatch && typeof vehicleMatch === "object" && "status" in vehicleMatch && vehicleMatch.status !== "unavailable" ? vehicleMatch as Parameters<typeof lark.syncVehicleMileage>[2] : undefined;
      vehicleSync = await lark.syncVehicleMileage(textValue(preparedFields[config.fields.vehicle]), numberValue(preparedFields[config.fields.mileage]), match);
    } catch (error) {
      vehicleSync = { status: "unavailable", matched: false, updated: false, message: error instanceof Error ? error.message : String(error) };
    }
    res.status(201).json({ ok: true, recordId: record.record_id, vehicleMatch, vehicleSync });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:recordId", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const fields = req.body?.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      res.status(400).json({ error: "fields object is required" });
      return;
    }
    const recordId = Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId;
    const principal = res.locals.principal as RequestPrincipal;
    const currentRecord = await lark.getRecord(recordId);
    if (!canAccessTask(taskFromRecord(currentRecord), principal)) {
      res.status(403).json({ error: "只能编辑自己的调度记录" });
      return;
    }
    let preparedFields = normalizeTaskFields(fields as Record<string, unknown>);
    let vehicleMatch: unknown = null;
    try {
      const prepared = await lark.prepareTaskFields(preparedFields);
      preparedFields = prepared.fields;
      vehicleMatch = prepared.match;
    } catch (error) {
      vehicleMatch = { status: "unavailable", message: error instanceof Error ? error.message : String(error) };
    }

    const record = await lark.updateRecord(recordId, preparedFields);
    let vehicleSync: unknown = null;
    try {
      const match = vehicleMatch && typeof vehicleMatch === "object" && "status" in vehicleMatch && vehicleMatch.status !== "unavailable" ? vehicleMatch as Parameters<typeof lark.syncVehicleMileage>[2] : undefined;
      vehicleSync = await lark.syncVehicleMileage(textValue(preparedFields[config.fields.vehicle]), numberValue(preparedFields[config.fields.mileage]), match);
    } catch (error) {
      vehicleSync = { status: "unavailable", matched: false, updated: false, message: error instanceof Error ? error.message : String(error) };
    }
    res.json({ ok: true, recordId: record?.record_id || recordId, vehicleMatch, vehicleSync });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:recordId/transfer", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const transferLocation = typeof req.body?.transferLocation === "string" ? req.body.transferLocation.trim() : "";
    if (!transferLocation) {
      res.status(400).json({ error: "transferLocation is required" });
      return;
    }
    const recordId = routeParam(req.params.recordId);
    const principal = res.locals.principal as RequestPrincipal;
    const currentRecord = await lark.getRecord(recordId);
    const task = taskFromRecord(currentRecord);
    if (!canAccessTask(task, principal)) {
      res.status(403).json({ error: "只能办理自己的中转记录" });
      return;
    }
    if (task.status === "已完成" || task.status === "取消" || task.returnMileage !== null || task.stage === "已返程") {
      res.status(409).json({ error: "该调度任务已完成或已返程，不能登记中转" });
      return;
    }
    const record = await lark.updateRecord(recordId, {
      [config.fields.tripMode]: "中转",
      [config.fields.transferLocation]: transferLocation
    });
    res.json({ ok: true, recordId: record?.record_id || recordId, transferLocation });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:recordId", requirePermission("sync_dispatch"), async (req, res, next) => {
  try {
    const recordId = Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId;
    const result = await lark.deleteRecord(recordId);
    res.json({ ok: true, recordId, ...result });
  } catch (error) {
    next(error);
  }
});

const PHOTO_POSITIONS = new Set(["front", "rear", "left", "right", "extra"]);

function photoPayload(value: unknown): Array<{ position: "front" | "rear" | "left" | "right" | "extra"; dataUrl: string; capturedAt?: string }> {
  if (!Array.isArray(value)) throw new Error("photos must be an array");
  if (value.length > 5) throw new Error("最多上传五张车辆照片");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("invalid photo item");
    const object = item as Record<string, unknown>;
    const position = object.position;
    const dataUrl = object.dataUrl;
    if (typeof position !== "string" || !PHOTO_POSITIONS.has(position)) throw new Error("photo position must be front, rear, left, right or extra");
    if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUrl)) throw new Error("photo dataUrl must be a base64 image");
    return {
      position: position as "front" | "rear" | "left" | "right" | "extra",
      dataUrl,
      capturedAt: typeof object.capturedAt === "string" ? object.capturedAt : undefined
    };
  });
}

app.post("/api/tasks/:recordId/photos", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const recordId = Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId;
    const phase = req.body?.phase === "return" ? "return" : req.body?.phase === "departure" ? "departure" : "";
    if (!phase) {
      res.status(400).json({ error: "phase must be departure or return" });
      return;
    }
    const principal = res.locals.principal as RequestPrincipal;
    const currentRecord = await lark.getRecord(recordId);
    if (!canAccessTask(taskFromRecord(currentRecord), principal)) {
      res.status(403).json({ error: "只能上传自己的车辆照片" });
      return;
    }
    const result = await lark.attachPhotos(recordId, phase, photoPayload(req.body?.photos), {
      checkResult: typeof req.body?.checkResult === "string" ? req.body.checkResult : "",
      notes: typeof req.body?.photoNotes === "string" ? req.body.photoNotes : ""
    });
    const record = await lark.getRecord(recordId);
    const vehicle = await lark.findVehicle(textValue(record.fields[config.fields.vehicle]));
    const notification = await sendNotification(phase, record, vehicle.vehicle?.owner || "");
    res.json({ ok: true, ...result, notification });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:recordId/return", requirePermission("mobile_dispatch"), async (req, res, next) => {
  try {
    const recordId = Array.isArray(req.params.recordId) ? req.params.recordId[0] : req.params.recordId;
    const returnOrigin = typeof req.body?.returnOrigin === "string" ? req.body.returnOrigin.trim() : "";
    const returnDestination = typeof req.body?.returnDestination === "string" ? req.body.returnDestination.trim() : "";
    if (!returnOrigin || !returnDestination) {
      res.status(400).json({ error: "returnOrigin and returnDestination are required" });
      return;
    }
    const returnMileage = Number(req.body?.returnMileage);
    if (!Number.isFinite(returnMileage) || returnMileage < 0) {
      res.status(400).json({ error: "returnMileage must be a non-negative number" });
      return;
    }
    const damageDescription = typeof req.body?.damageDescription === "string" ? req.body.damageDescription : "";
    const record = await lark.getRecord(recordId);
    const principal = res.locals.principal as RequestPrincipal;
    const task = taskFromRecord(record);
    if (!canAccessTask(task, principal)) {
      res.status(403).json({ error: "只能办理自己的返程记录" });
      return;
    }
    if (task.status === "已完成" || task.returnMileage !== null) {
      res.status(409).json({ error: "该调度任务已完成返程，不能重复登记" });
      return;
    }
    const result = await lark.completeReturn(recordId, returnOrigin, returnDestination, returnMileage, damageDescription, {
      checkResult: typeof req.body?.checkResult === "string" ? req.body.checkResult : "",
      notes: typeof req.body?.photoNotes === "string" ? req.body.photoNotes : ""
    }, photoPayload(req.body?.photos || []));
    const updatedRecord = await lark.getRecord(recordId);
    const vehicle = await lark.findVehicle(textValue(updatedRecord.fields[config.fields.vehicle]));
    const notification = await sendNotification("return", updatedRecord, vehicle.vehicle?.owner || "");
    res.json({ ok: true, ...result, notification });
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`Lark dispatch backend listening on http://localhost:${config.port}`);
  console.log(`Polling interval: ${config.pollIntervalMs}ms`);
  console.log(`Executor configured: ${Boolean(config.dispatchExecutorUrl)}`);
  // Preload the expensive directory/fleet options in the background. The
  // request cache shares this in-flight promise with the first page load.
  void lark.warmOptions().catch((error) => {
    console.warn("Lark options warm-up failed; the next request will retry:", error instanceof Error ? error.message : String(error));
  });
});

const run = async (): Promise<void> => {
  try {
    await scheduler.syncOnce();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
};

const interval = setInterval(run, config.pollIntervalMs);

function shutdown(): void {
  clearInterval(interval);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
