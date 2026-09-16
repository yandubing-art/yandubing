import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

type StoredFile = {
  id: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type VehicleMaintenanceRecord = {
  id: string;
  tableId: string;
  recordId: string;
  plate: string;
  serviceDate: string;
  mileage: number | null;
  nextMaintenanceDate?: string;
  nextMaintenanceMileage?: number | null;
  provider: string;
  notes: string;
  confirmedAt: string;
  confirmedBy: string;
  updatedBaseFields: string[];
  warrantyDocument?: StoredFile;
};

type VehicleProfilePhoto = {
  tableId: string;
  recordId: string;
  full: StoredFile;
  thumbnail: StoredFile;
};

type AssetFile = {
  maintenance: VehicleMaintenanceRecord[];
  profilePhotos: Record<string, VehicleProfilePhoto>;
};

type UploadPayload = { fileName: string; dataUrl: string };

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function assetKey(tableId: string, recordId: string): string {
  return `${tableId}:${recordId}`;
}

function safeFileName(value: string, fallback: string): string {
  const normalized = value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 120) || fallback;
}

function parseDataUrl(dataUrl: string, allowedTypes: Set<string>, maxBytes: number): { mimeType: string; buffer: Buffer } {
  const match = /^data:([A-Za-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/s.exec(dataUrl);
  if (!match) throw new Error("上传文件格式无效");
  const mimeType = match[1].toLowerCase();
  if (!allowedTypes.has(mimeType)) throw new Error("仅支持 PDF、JPG、PNG 或 WebP 文件");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > maxBytes) throw new Error(`文件大小必须介于 1 B 和 ${Math.floor(maxBytes / 1024 / 1024)} MB 之间`);
  return { mimeType, buffer };
}

function extensionFor(mimeType: string): string {
  return ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" })[mimeType] || "";
}

export class VehicleAssetsStore {
  private readonly filePath = path.resolve(config.vehicleAssetsStorePath);
  private readonly directory = path.resolve(config.vehicleAssetsDirectory);
  private state: AssetFile;

  constructor() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.mkdirSync(this.directory, { recursive: true });
    this.state = this.load();
  }

  private load(): AssetFile {
    if (!fs.existsSync(this.filePath)) return { maintenance: [], profilePhotos: {} };
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AssetFile>;
      return {
        maintenance: Array.isArray(data.maintenance) ? data.maintenance : [],
        profilePhotos: data.profilePhotos && typeof data.profilePhotos === "object" ? data.profilePhotos : {}
      };
    } catch {
      return { maintenance: [], profilePhotos: {} };
    }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  private storeFile(prefix: string, payload: UploadPayload, allowedTypes: Set<string>, maxBytes: number): StoredFile {
    const { mimeType, buffer } = parseDataUrl(payload.dataUrl, allowedTypes, maxBytes);
    const id = crypto.randomUUID();
    const requested = safeFileName(payload.fileName, `${prefix}${extensionFor(mimeType)}`);
    const storedName = `${prefix}-${id}${extensionFor(mimeType)}`;
    fs.writeFileSync(path.join(this.directory, storedName), buffer);
    return { id, fileName: requested, storedName, mimeType, size: buffer.length, createdAt: new Date().toISOString() };
  }

  saveProfilePhoto(tableId: string, recordId: string, full: UploadPayload, thumbnail: UploadPayload): VehicleProfilePhoto {
    const entry: VehicleProfilePhoto = {
      tableId,
      recordId,
      full: this.storeFile("vehicle-full", full, allowedPhotoTypes, MAX_PROFILE_PHOTO_BYTES),
      thumbnail: this.storeFile("vehicle-thumb", thumbnail, allowedPhotoTypes, MAX_PROFILE_PHOTO_BYTES)
    };
    this.state.profilePhotos[assetKey(tableId, recordId)] = entry;
    this.persist();
    return entry;
  }

  profilePhoto(tableId: string, recordId: string): VehicleProfilePhoto | undefined {
    const entry = this.state.profilePhotos[assetKey(tableId, recordId)];
    return entry ? { ...entry, full: { ...entry.full }, thumbnail: { ...entry.thumbnail } } : undefined;
  }

  addMaintenance(input: Omit<VehicleMaintenanceRecord, "id" | "confirmedAt" | "warrantyDocument"> & { warrantyDocument?: UploadPayload }): VehicleMaintenanceRecord {
    const record: VehicleMaintenanceRecord = {
      ...input,
      id: crypto.randomUUID(),
      confirmedAt: new Date().toISOString(),
      warrantyDocument: input.warrantyDocument ? this.storeFile("vehicle-warranty", input.warrantyDocument, allowedDocumentTypes, MAX_DOCUMENT_BYTES) : undefined
    };
    this.state.maintenance.unshift(record);
    this.persist();
    return { ...record, warrantyDocument: record.warrantyDocument ? { ...record.warrantyDocument } : undefined };
  }

  maintenanceFor(tableId: string, recordId: string): VehicleMaintenanceRecord[] {
    return this.state.maintenance.filter((item) => item.tableId === tableId && item.recordId === recordId).map((item) => ({ ...item, updatedBaseFields: [...item.updatedBaseFields], warrantyDocument: item.warrantyDocument ? { ...item.warrantyDocument } : undefined }));
  }

  maintenanceDocument(tableId: string, recordId: string, maintenanceId: string): StoredFile | undefined {
    const record = this.state.maintenance.find((item) => item.tableId === tableId && item.recordId === recordId && (item.id === maintenanceId || item.warrantyDocument?.id === maintenanceId));
    return record?.warrantyDocument ? { ...record.warrantyDocument } : undefined;
  }

  profilePhotoFile(tableId: string, recordId: string, variant: "full" | "thumbnail"): StoredFile | undefined {
    const photo = this.state.profilePhotos[assetKey(tableId, recordId)];
    return photo ? { ...photo[variant] } : undefined;
  }

  deleteVehicleAssets(tableId: string, recordId: string): void {
    const key = assetKey(tableId, recordId);
    const photo = this.state.profilePhotos[key];
    if (photo) {
      this.removeFile(photo.full);
      this.removeFile(photo.thumbnail);
      delete this.state.profilePhotos[key];
    }

    const retained: VehicleMaintenanceRecord[] = [];
    for (const record of this.state.maintenance) {
      if (record.tableId === tableId && record.recordId === recordId) this.removeFile(record.warrantyDocument);
      else retained.push(record);
    }
    this.state.maintenance = retained;
    this.persist();
  }

  private removeFile(file: StoredFile | undefined): void {
    if (!file) return;
    const target = path.resolve(this.directory, file.storedName);
    if (!target.startsWith(`${this.directory}${path.sep}`)) return;
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // The remote record has already been deleted; failing local cleanup must
      // not turn a completed deletion into a failed request.
    }
  }

  absolutePath(file: StoredFile): string | undefined {
    const target = path.resolve(this.directory, file.storedName);
    return target.startsWith(`${this.directory}${path.sep}`) && fs.existsSync(target) ? target : undefined;
  }
}
