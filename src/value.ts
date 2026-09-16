export function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["name", "text", "value", "id"]) {
      if (object[key] !== undefined && object[key] !== null) {
        return textValue(object[key]);
      }
    }
  }
  return "";
}

export function firstId(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const item = value[0];
  return item && typeof item === "object" && "id" in item ? String((item as { id?: unknown }).id || "") : "";
}

export function coordinateValue(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const lat = numberValue(object.lat ?? object.latitude);
  const lng = numberValue(object.lng ?? object.longitude);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export function attachmentValues(value: unknown): Array<{ name: string; url: string; fileToken?: string }> {
  if (!Array.isArray(value)) return [];
  const attachments: Array<{ name: string; url: string; fileToken?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const object = item as Record<string, unknown>;
    attachments.push({
      name: textValue(object.name) || "车辆照片",
      url: textValue(object.tmp_url ?? object.url ?? object.preview_url),
      fileToken: textValue(object.file_token) || undefined
    });
  }
  return attachments;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = textValue(value).replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function dateValue(value: unknown): Date | null {
  if (typeof value === "number") {
    const timestamp = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = textValue(value).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
