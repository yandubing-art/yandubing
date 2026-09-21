import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export type AccountRole = "dispatcher" | "scheduler" | "fleet_manager" | "admin";
export type AuthSource = "lark" | "local";
export type Permission =
  | "mobile_dispatch"
  | "desktop_console"
  | "sync_dispatch"
  | "manage_vehicles"
  | "manage_accounts"
  | "view_all_vehicles"
  | "view_own_tasks"
  | "view_all_tasks"
  | "create_dispatch"
  | "edit_own_dispatch"
  | "edit_all_dispatch"
  | "submit_departure"
  | "submit_transfer"
  | "submit_return"
  | "submit_photos"
  | "book_vehicle"
  | "approve_bookings"
  | "delete_dispatch"
  | "manage_vehicle_photos"
  | "manage_maintenance"
  | "view_history"
  | "view_tracker_history"
  | "refresh_tracker"
  | "manage_notifications"
  | "manage_photo_sync";

export type ManagedAccount = {
  id: string;
  username: string;
  displayName: string;
  department: string;
  email: string;
  source: AuthSource;
  larkOpenId: string | null;
  role: AccountRole;
  permissions: Permission[];
  permissionsVersion?: number;
  permissionMode?: "role" | "custom";
  active: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type PublicAccount = Omit<ManagedAccount, "passwordHash" | "passwordSalt">;

export type AuthPrincipal = {
  accountId: string;
  username: string;
  displayName: string;
  department: string;
  source: AuthSource;
  larkOpenId?: string | null;
  role: AccountRole;
  permissions: Permission[];
};

export type AuthStoreLike = {
  getPrincipalBySession(token: string): AuthPrincipal | null | Promise<AuthPrincipal | null>;
  authenticateLocal(username: string, password: string): AuthPrincipal | null | Promise<AuthPrincipal | null>;
  createSession(principal: AuthPrincipal): { token: string; expiresAt: number } | Promise<{ token: string; expiresAt: number }>;
  deleteSession(token: string): void | Promise<void>;
  listAccounts(): PublicAccount[] | Promise<PublicAccount[]>;
  createLocalAccount(username: string, displayName: string, department: string, password: string, role: AccountRole): PublicAccount | Promise<PublicAccount>;
  updateAccount(accountId: string, patch: { displayName?: string; department?: string; role?: string; permissions?: Permission[]; resetPermissions?: boolean; active?: boolean }): PublicAccount | Promise<PublicAccount>;
  upsertLarkAccount(input: { openId: string; name: string; enName?: string; email?: string; department?: string }): AuthPrincipal | Promise<AuthPrincipal>;
};

type StoredSession = { token: string; accountId: string; expiresAt: number };
type RolePermissions = Record<AccountRole, Permission[]>;
type AuthFile = { accounts: ManagedAccount[]; sessions: StoredSession[]; rolePermissions: RolePermissions };

const permissionsByRole: Record<AccountRole, Permission[]> = {
  dispatcher: [
    "mobile_dispatch", "view_own_tasks", "create_dispatch", "edit_own_dispatch",
    "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle",
    "view_all_vehicles"
  ],
  scheduler: [
    "mobile_dispatch", "view_own_tasks", "view_all_tasks", "create_dispatch", "edit_own_dispatch", "edit_all_dispatch",
    "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "approve_bookings",
    "desktop_console", "view_history", "view_tracker_history", "sync_dispatch", "delete_dispatch", "view_all_vehicles"
  ],
  fleet_manager: [
    "mobile_dispatch", "view_own_tasks", "view_all_tasks", "create_dispatch", "edit_own_dispatch", "edit_all_dispatch",
    "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "desktop_console",
    "view_history", "view_tracker_history", "view_all_vehicles", "manage_vehicles", "manage_vehicle_photos",
    "manage_maintenance", "refresh_tracker", "manage_photo_sync"
  ],
  admin: [
    "mobile_dispatch", "view_own_tasks", "view_all_tasks", "create_dispatch", "edit_own_dispatch", "edit_all_dispatch",
    "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "approve_bookings",
    "desktop_console", "view_history", "view_tracker_history", "sync_dispatch", "delete_dispatch", "view_all_vehicles",
    "manage_vehicles", "manage_vehicle_photos", "manage_maintenance", "refresh_tracker", "manage_photo_sync",
    "manage_accounts", "manage_notifications"
  ]
};
const allPermissions: Permission[] = [...new Set(Object.values(permissionsByRole).flat())];

const legacyPermissionExpansion: Partial<Record<Permission, Permission[]>> = {
  mobile_dispatch: ["view_own_tasks", "create_dispatch", "edit_own_dispatch", "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle"],
  desktop_console: ["view_all_tasks", "edit_all_dispatch", "view_history", "view_tracker_history"],
  sync_dispatch: ["approve_bookings", "delete_dispatch"],
  manage_vehicles: ["manage_vehicle_photos", "manage_maintenance", "refresh_tracker"],
  manage_accounts: ["manage_notifications"],
  view_all_tasks: ["view_own_tasks"]
};

function accountRole(value: string | undefined): AccountRole {
  if (value === "scheduler" || value === "fleet_manager" || value === "admin") return value;
  return "dispatcher";
}

function normalizePermissions(value: unknown, role: AccountRole, expandLegacy = true, fallback = permissionsByRole[role]): Permission[] {
  if (!Array.isArray(value)) return [...fallback];
  const requested = new Set(value.filter((item): item is string => typeof item === "string"));
  const normalized = new Set<Permission>(allPermissions.filter((permission) => requested.has(permission)));
  if (expandLegacy) {
    for (const permission of [...normalized]) {
      for (const expanded of legacyPermissionExpansion[permission] || []) normalized.add(expanded);
    }
  }
  return allPermissions.filter((permission) => normalized.has(permission));
}

function normalizeRolePermissions(value: unknown): RolePermissions {
  const source = value && typeof value === "object" ? value as Partial<Record<AccountRole, unknown>> : {};
  return {
    dispatcher: normalizePermissions(source.dispatcher, "dispatcher", false),
    scheduler: normalizePermissions(source.scheduler, "scheduler", false),
    fleet_manager: normalizePermissions(source.fleet_manager, "fleet_manager", false),
    admin: normalizePermissions(source.admin, "admin", false)
  };
}

function now(): string {
  return new Date().toISOString();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class AuthStore {
  private readonly filePath = path.resolve(config.authStorePath);
  private state: AuthFile;

  constructor() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.state = this.load();
    this.ensureBootstrapAdmin();
  }

  private load(): AuthFile {
    if (!fs.existsSync(this.filePath)) return { accounts: [], sessions: [], rolePermissions: normalizeRolePermissions(undefined) };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AuthFile>;
      const rolePermissions = normalizeRolePermissions(parsed.rolePermissions);
      return {
        accounts: Array.isArray(parsed.accounts)
          ? (parsed.accounts as ManagedAccount[]).map((account) => {
            const role = accountRole(account.role);
            return { ...account, role, permissions: normalizePermissions(account.permissions, role, account.permissionsVersion !== 2, rolePermissions[role]), department: typeof account.department === "string" ? account.department : "" };
          })
          : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions as StoredSession[] : [],
        rolePermissions
      };
    } catch {
      return { accounts: [], sessions: [], rolePermissions: normalizeRolePermissions(undefined) };
    }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  private ensureBootstrapAdmin(): void {
    const username = config.authBootstrapAdminUsername.trim().toLowerCase();
    const password = config.authBootstrapAdminPassword;
    if (!username || !password) return;
    const existing = this.findByUsername(username);
    if (!existing) {
      this.createLocalAccount(username, "系统管理员", "", password, "admin", { allowShortPassword: true });
      return;
    }
    if (existing.source !== "local") throw new Error("配置的初始管理员账号已被 Lark 账号占用");
    if (existing.role === "admin" && existing.active) return;
    existing.role = "admin";
    existing.active = true;
    existing.updatedAt = now();
    this.persist();
  }

  private hashPassword(password: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
    return { hash: scryptSync(password, salt, 64).toString("hex"), salt };
  }

  private publicAccount(account: ManagedAccount): PublicAccount {
    const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safe } = account;
    return { ...safe, permissions: account.permissionMode === "role" ? [...this.state.rolePermissions[account.role]] : safe.permissions };
  }

  private findByUsername(username: string): ManagedAccount | undefined {
    const normalized = username.trim().toLowerCase();
    return this.state.accounts.find((account) => account.username.toLowerCase() === normalized);
  }

  private principalFor(account: ManagedAccount): AuthPrincipal | null {
    if (!account.active) return null;
    return {
      accountId: account.id,
      username: account.username,
      displayName: account.displayName,
      department: account.department,
      source: account.source,
      larkOpenId: account.larkOpenId,
      role: account.role,
      permissions: account.permissionMode === "role"
        ? [...this.state.rolePermissions[account.role]]
        : normalizePermissions(account.permissions, account.role, account.permissionsVersion !== 2, this.state.rolePermissions[account.role])
    };
  }

  getAccount(accountId: string): ManagedAccount | undefined {
    return this.state.accounts.find((account) => account.id === accountId);
  }

  getPrincipal(accountId: string): AuthPrincipal | null {
    const account = this.getAccount(accountId);
    return account ? this.principalFor(account) : null;
  }

  listAccounts(): PublicAccount[] {
    return this.state.accounts
      .map((account) => this.publicAccount(account))
      .sort((a, b) => a.department.localeCompare(b.department) || a.displayName.localeCompare(b.displayName));
  }

  listRolePermissions(): RolePermissions {
    return {
      dispatcher: [...this.state.rolePermissions.dispatcher],
      scheduler: [...this.state.rolePermissions.scheduler],
      fleet_manager: [...this.state.rolePermissions.fleet_manager],
      admin: [...this.state.rolePermissions.admin]
    };
  }

  updateRolePermissions(roleValue: string, permissions: Permission[]): Permission[] {
    const role = accountRole(roleValue);
    const next = normalizePermissions(permissions, role, false);
    if (role === "admin" && !next.includes("manage_accounts")) throw new Error("管理员角色必须保留账号权限管理");
    this.state.rolePermissions[role] = next;
    this.persist();
    return [...next];
  }

  createLocalAccount(username: string, displayName: string, department: string, password: string, role: AccountRole, options: { allowShortPassword?: boolean } = {}): PublicAccount {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) throw new Error("账号名需为 3-64 位字母、数字、点、下划线或短横线");
    if (!password || (!options.allowShortPassword && password.length < 10)) throw new Error("独立账号密码至少需要 10 位");
    if (this.findByUsername(normalized)) throw new Error("账号名已存在");
    const passwordData = this.hashPassword(password);
    const timestamp = now();
    const normalizedRole = accountRole(role);
    const account: ManagedAccount = {
      id: `acct_${randomBytes(12).toString("hex")}`,
      username: normalized,
      displayName: displayName.trim() || normalized,
      department: department.trim().slice(0, 80),
      email: "",
      source: "local",
      larkOpenId: null,
      role: normalizedRole,
      permissions: [...this.state.rolePermissions[normalizedRole]],
      permissionsVersion: 2,
      permissionMode: "role",
      active: true,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: null
    };
    this.state.accounts.push(account);
    this.persist();
    return this.publicAccount(account);
  }

  authenticateLocal(username: string, password: string): AuthPrincipal | null {
    const account = this.findByUsername(username);
    if (!account || account.source !== "local" || !account.active || !account.passwordHash || !account.passwordSalt) return null;
    const candidate = this.hashPassword(password, account.passwordSalt).hash;
    if (!safeEqual(candidate, account.passwordHash)) return null;
    account.lastLoginAt = now();
    account.updatedAt = account.lastLoginAt;
    this.persist();
    return this.principalFor(account);
  }

  upsertLarkAccount(input: { openId: string; name: string; enName?: string; email?: string; department?: string }): AuthPrincipal {
    let account = this.state.accounts.find((item) => item.source === "lark" && item.larkOpenId === input.openId);
    const timestamp = now();
    if (!account) {
      account = {
        id: `acct_${randomBytes(12).toString("hex")}`,
        username: `lark_${input.openId}`,
        displayName: input.name || input.enName || "Lark 用户",
        department: input.department?.trim().slice(0, 80) || "",
        email: input.email || "",
        source: "lark",
        larkOpenId: input.openId,
        role: accountRole(config.larkDefaultRole),
        permissions: [...this.state.rolePermissions[accountRole(config.larkDefaultRole)]],
        permissionsVersion: 2,
        permissionMode: "role",
        active: true,
        passwordHash: null,
        passwordSalt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: timestamp
      };
      this.state.accounts.push(account);
    } else {
      account.displayName = input.name || input.enName || account.displayName;
      account.email = input.email || account.email;
      account.department = input.department?.trim().slice(0, 80) || account.department;
      account.lastLoginAt = timestamp;
      account.updatedAt = timestamp;
    }
    this.persist();
    const principal = this.principalFor(account);
    if (!principal) throw new Error("该 Lark 账号已被停用，请联系管理员");
    return principal;
  }

  updateAccount(accountId: string, patch: { displayName?: string; department?: string; role?: string; permissions?: Permission[]; resetPermissions?: boolean; active?: boolean }): PublicAccount {
    const account = this.getAccount(accountId);
    if (!account) throw new Error("账号不存在");
    const nextRole = patch.role === undefined ? account.role : accountRole(patch.role);
    const nextActive = patch.active === undefined ? account.active : Boolean(patch.active);
    const roleChanged = patch.role !== undefined && nextRole !== account.role;
    const nextPermissions = patch.resetPermissions
      ? [...this.state.rolePermissions[nextRole]]
      : patch.permissions === undefined
      ? (roleChanged
        ? [...this.state.rolePermissions[nextRole]]
        : account.permissionMode === "role"
          ? [...this.state.rolePermissions[account.role]]
          : normalizePermissions(account.permissions, account.role, account.permissionsVersion !== 2, this.state.rolePermissions[account.role]))
      : normalizePermissions(patch.permissions, nextRole, false);
    if (account.role === "admin" && account.active && (nextRole !== "admin" || !nextActive)) {
      const otherAdmin = this.state.accounts.some((item) => item.id !== account.id && item.role === "admin" && item.active);
      if (!otherAdmin) throw new Error("至少保留一个启用中的管理员账号");
    }
    if (account.active && account.permissions.includes("manage_accounts") && !nextPermissions.includes("manage_accounts")) {
      const otherManager = this.state.accounts.some((item) => item.id !== account.id && item.active && normalizePermissions(item.permissions, item.role).includes("manage_accounts"));
      if (!otherManager) throw new Error("至少保留一个启用中的账号管理权限");
    }
    account.displayName = patch.displayName?.trim() || account.displayName;
    if (patch.department !== undefined) account.department = patch.department.trim().slice(0, 80);
    account.role = nextRole;
    account.permissions = nextPermissions;
    if (patch.resetPermissions) {
      account.permissionsVersion = 2;
      account.permissionMode = "role";
    } else if (patch.permissions !== undefined) {
      account.permissionsVersion = 2;
      account.permissionMode = "custom";
    } else if (roleChanged) {
      account.permissionsVersion = 2;
      account.permissionMode = "role";
    }
    account.active = nextActive;
    account.updatedAt = now();
    this.persist();
    return this.publicAccount(account);
  }

  createSession(principal: AuthPrincipal): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + config.authSessionTtlMs;
    this.state.sessions = this.state.sessions.filter((session) => session.expiresAt > Date.now());
    this.state.sessions.push({ token, accountId: principal.accountId, expiresAt });
    this.persist();
    return { token, expiresAt };
  }

  getPrincipalBySession(token: string): AuthPrincipal | null {
    if (!token) return null;
    const session = this.state.sessions.find((item) => item.token === token && item.expiresAt > Date.now());
    if (!session) return null;
    const account = this.getAccount(session.accountId);
    return account ? this.principalFor(account) : null;
  }

  deleteSession(token: string): void {
    this.state.sessions = this.state.sessions.filter((session) => session.token !== token);
    this.persist();
  }
}

export const permissionsForRole = (role: AccountRole): Permission[] => [...permissionsByRole[role]];
