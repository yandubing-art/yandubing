import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

type StoredGrant = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  authorizedAt: number;
  authorizedBy: string;
};

type EncryptedFile = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type LarkPhotoSyncStatus = {
  connected: boolean;
  active: boolean;
  authorizedBy: string;
  authorizedAt: string;
  expiresAt: string;
};

/**
 * Persists the one Base-administrator OAuth grant needed by Drive media
 * uploads. Tokens are encrypted at rest with a key derived from the app
 * secret, and status methods deliberately never expose either token.
 */
export class LarkPhotoSyncStore {
  private grant: StoredGrant | undefined;
  private readonly filePath = path.resolve(config.larkPhotoSyncStorePath);
  private readonly key = crypto.createHash("sha256").update(`lark-photo-sync-v1:${config.larkAppSecret}`).digest();

  constructor() {
    this.grant = this.read();
  }

  status(): LarkPhotoSyncStatus {
    const grant = this.grant;
    if (!grant) return { connected: false, active: false, authorizedBy: "", authorizedAt: "", expiresAt: "" };
    return {
      connected: true,
      active: grant.expiresAt > Date.now(),
      authorizedBy: grant.authorizedBy,
      authorizedAt: new Date(grant.authorizedAt).toISOString(),
      expiresAt: new Date(grant.expiresAt).toISOString()
    };
  }

  save(grant: StoredGrant): void {
    this.grant = grant;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(grant), "utf8"), cipher.final()]);
    const payload: EncryptedFile = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }

  async accessToken(): Promise<string> {
    const grant = this.grant;
    if (!grant) throw new Error("飞书照片同步尚未连接，请先在后台通知设置中连接拥有车辆表权限的 Base 管理员");
    // Refresh a little early so a long-running media request is not issued
    // with a token that will expire while it is being processed.
    if (grant.expiresAt > Date.now() + 60_000) return grant.accessToken;
    if (!grant.refreshToken) throw new Error("飞书照片同步授权已失效，请在后台通知设置中重新连接 Base 管理员");

    const response = await fetch("https://open.larksuite.com/open-apis/authen/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: config.larkAppId,
        client_secret: config.larkAppSecret,
        refresh_token: grant.refreshToken
      })
    });
    const payload = await response.json() as Record<string, unknown>;
    const tokens = oauthTokenData(payload);
    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    if (!response.ok || (payload.code !== undefined && String(payload.code) !== "0") || !accessToken) {
      throw new Error("飞书照片同步授权已失效，请在后台通知设置中重新连接 Base 管理员");
    }
    this.save({
      accessToken,
      refreshToken: typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : grant.refreshToken,
      expiresAt: Date.now() + tokenLifetimeMs(tokens),
      authorizedAt: grant.authorizedAt,
      authorizedBy: grant.authorizedBy
    });
    return accessToken;
  }

  private read(): StoredGrant | undefined {
    try {
      if (!fs.existsSync(this.filePath)) return undefined;
      const encrypted = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as EncryptedFile;
      if (encrypted.version !== 1 || !encrypted.iv || !encrypted.tag || !encrypted.ciphertext) throw new Error("invalid encrypted photo-sync store");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(encrypted.iv, "base64"));
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
      const grant = JSON.parse(plain) as StoredGrant;
      if (!grant.accessToken || !Number.isFinite(grant.expiresAt)) throw new Error("invalid photo-sync grant");
      return grant;
    } catch (error) {
      console.warn("Unable to load encrypted Lark photo-sync authorization; reconnect it in the admin console.", error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }
}

export function tokenLifetimeMs(payload: Record<string, unknown>): number {
  const seconds = Number(payload.expires_in ?? payload.expires_in_seconds ?? 7200);
  return Math.max(60, Number.isFinite(seconds) ? seconds - 120 : 7080) * 1000;
}

// OAuth responses have existed in both direct-token and data-wrapped forms.
// Read either one so a platform response shape change cannot discard a valid
// administrator authorization.
export function oauthTokenData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : payload;
}
