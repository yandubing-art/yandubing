import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export type AccountRole = "dispatcher" | "scheduler" | "fleet_manager" | "admin";
export type AuthSource = "lark" | "local";
export type Permission = "mobile_dispatch" | "desktop_console" | "sync_dispatch" | "manage_vehicles" | "manage_accounts";

export type ManagedAccount = {
  id: string;
  username: string;
  displayName: string;
  department: string;
  email: string;
  source: AuthSource;
  larkOpenId: string | null;
  role: AccountRole;
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
  updateAccount(accountId: string, patch: { displayName?: string; department?: string; role?: string; active?: boolean }): PublicAccount | Promise<PublicAccount>;
  upsertLarkAccount(input: { openId: string; name: string; enName?: string; email?: string; department?: string }): AuthPrincipal | Promise<AuthPrincipal>;
};

type StoredSession = { token: string; accountId: string; expiresAt: number };
type AuthFile = { accounts: ManagedAccount[]; sessions: StoredSession[] };

const permissionsByRole: Record<AccountRole, Permission[]> = {
  dispatcher: ["mobile_dispatch"],
  scheduler: ["mobile_dispatch", "desktop_console", "sync_dispatch"],
  fleet_manager: ["mobile_dispatch", "desktop_console", "manage_vehicles"],
  admin: ["mobile_dispatch", "desktop_console", "sync_dispatch", "manage_vehicles", "manage_accounts"]
};

function accountRole(value: string | undefined): AccountRole {
  if (value === "scheduler" || value === "fleet_manager" || value === "admin") return value;
  return "dispatcher";
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
    if (!fs.existsSync(this.filePath)) return { accounts: [], sessions: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AuthFile>;
      return {
        accounts: Array.isArray(parsed.accounts)
          ? (parsed.accounts as ManagedAccount[]).map((account) => ({ ...account, department: typeof account.department === "string" ? account.department : "" }))
          : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions as StoredSession[] : []
      };
    } catch {
      return { accounts: [], sessions: [] };
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
    return safe;
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
      permissions: [...permissionsByRole[account.role]]
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

  createLocalAccount(username: string, displayName: string, department: string, password: string, role: AccountRole, options: { allowShortPassword?: boolean } = {}): PublicAccount {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) throw new Error("账号名需为 3-64 位字母、数字、点、下划线或短横线");
    if (!password || (!options.allowShortPassword && password.length < 10)) throw new Error("独立账号密码至少需要 10 位");
    if (this.findByUsername(normalized)) throw new Error("账号名已存在");
    const passwordData = this.hashPassword(password);
    const timestamp = now();
    const account: ManagedAccount = {
      id: `acct_${randomBytes(12).toString("hex")}`,
      username: normalized,
      displayName: displayName.trim() || normalized,
      department: department.trim().slice(0, 80),
      email: "",
      source: "local",
      larkOpenId: null,
      role,
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

  updateAccount(accountId: string, patch: { displayName?: string; department?: string; role?: string; active?: boolean }): PublicAccount {
    const account = this.getAccount(accountId);
    if (!account) throw new Error("账号不存在");
    const nextRole = patch.role === undefined ? account.role : accountRole(patch.role);
    const nextActive = patch.active === undefined ? account.active : Boolean(patch.active);
    if (account.role === "admin" && account.active && (nextRole !== "admin" || !nextActive)) {
      const otherAdmin = this.state.accounts.some((item) => item.id !== account.id && item.role === "admin" && item.active);
      if (!otherAdmin) throw new Error("至少保留一个启用中的管理员账号");
    }
    account.displayName = patch.displayName?.trim() || account.displayName;
    if (patch.department !== undefined) account.department = patch.department.trim().slice(0, 80);
    account.role = nextRole;
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
