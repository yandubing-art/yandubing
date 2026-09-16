import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type NotificationStage = "departure" | "return" | "booking";
export type NotificationTargetType = "user" | "chat";

export type NotificationTarget = {
  type: NotificationTargetType;
  id: string;
  label: string;
};

export type DepartmentNotificationRule = {
  department: string;
  departureTargets: NotificationTarget[];
  returnTargets: NotificationTarget[];
  bookingTargets: NotificationTarget[];
};

type SentEvent = { sentAt: string; targets: number };
type NotificationFile = { rules: DepartmentNotificationRule[]; sentEvents: Record<string, SentEvent> };

export const notificationDepartments = [
  { id: "administration", label: "行政部" },
  { id: "maintenance", label: "维护部" },
  { id: "operations", label: "运营部" },
  { id: "procurement", label: "采购部" },
  { id: "warehouse", label: "仓库部" },
  { id: "store", label: "门店部" },
  { id: "tophida", label: "Tophida" },
  { id: "default", label: "默认通知（未匹配部门时使用）" }
] as const;

const stageKey: Record<NotificationStage, keyof Pick<DepartmentNotificationRule, "departureTargets" | "returnTargets" | "bookingTargets">> = {
  departure: "departureTargets",
  return: "returnTargets",
  booking: "bookingTargets"
};

function emptyRule(department: string): DepartmentNotificationRule {
  return { department, departureTargets: [], returnTargets: [], bookingTargets: [] };
}

function cleanTarget(value: unknown): NotificationTarget | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const type = item.type === "chat" ? "chat" : item.type === "user" ? "user" : null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!type || !id || id.length > 160) return null;
  if (type === "user" && !/^ou_[A-Za-z0-9_-]+$/.test(id)) return null;
  if (type === "chat" && !/^oc_[A-Za-z0-9_-]+$/.test(id)) return null;
  const suppliedLabel = typeof item.label === "string" ? item.label.trim() : "";
  return { type, id, label: (suppliedLabel || id).slice(0, 120) };
}

function cleanTargets(value: unknown): NotificationTarget[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: NotificationTarget[] = [];
  for (const raw of value) {
    const target = cleanTarget(raw);
    if (!target) continue;
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function cleanRule(value: unknown, fallbackDepartment: string): DepartmentNotificationRule {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    department: fallbackDepartment,
    departureTargets: cleanTargets(item.departureTargets),
    returnTargets: cleanTargets(item.returnTargets),
    bookingTargets: cleanTargets(item.bookingTargets)
  };
}

function normalizeRules(value: unknown): DepartmentNotificationRule[] {
  const input = Array.isArray(value) ? value : [];
  const byDepartment = new Map<string, unknown>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const department = (item as Record<string, unknown>).department;
    if (typeof department === "string" && notificationDepartments.some((entry) => entry.id === department)) byDepartment.set(department, item);
  }
  return notificationDepartments.map(({ id }) => cleanRule(byDepartment.get(id), id));
}

function departmentFromOwner(owner: string): string {
  const text = owner.toLowerCase();
  if (/administration|行政/.test(text)) return "administration";
  if (/maintenance|维护/.test(text)) return "maintenance";
  if (/operations|运营/.test(text)) return "operations";
  if (/procurement|采购/.test(text)) return "procurement";
  if (/warehouse|仓库/.test(text)) return "warehouse";
  if (/store|门店/.test(text)) return "store";
  if (/tophida/.test(text)) return "tophida";
  return "default";
}

export class NotificationSettingsStore {
  private readonly filePath = path.resolve(config.notificationSettingsPath);
  private state: NotificationFile;

  constructor() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.state = this.load();
  }

  private load(): NotificationFile {
    if (!fs.existsSync(this.filePath)) return { rules: normalizeRules([]), sentEvents: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<NotificationFile>;
      const sentEvents = parsed.sentEvents && typeof parsed.sentEvents === "object" ? parsed.sentEvents as Record<string, SentEvent> : {};
      return { rules: normalizeRules(parsed.rules), sentEvents };
    } catch {
      return { rules: normalizeRules([]), sentEvents: {} };
    }
  }

  private persist(): void {
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    for (const [id, event] of Object.entries(this.state.sentEvents)) {
      if (!event?.sentAt || Date.parse(event.sentAt) < cutoff) delete this.state.sentEvents[id];
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  list(): DepartmentNotificationRule[] {
    return this.state.rules.map((rule) => ({
      department: rule.department,
      departureTargets: rule.departureTargets.map((target) => ({ ...target })),
      returnTargets: rule.returnTargets.map((target) => ({ ...target })),
      bookingTargets: rule.bookingTargets.map((target) => ({ ...target }))
    }));
  }

  update(rules: unknown): DepartmentNotificationRule[] {
    this.state.rules = normalizeRules(rules);
    this.persist();
    return this.list();
  }

  departmentForOwner(owner: string): string {
    return departmentFromOwner(owner);
  }

  targetsFor(owner: string, stage: NotificationStage): { department: string; targets: NotificationTarget[] } {
    const department = departmentFromOwner(owner);
    const targetRule = this.state.rules.find((rule) => rule.department === department) || emptyRule(department);
    const targetTargets = targetRule[stageKey[stage]];
    if (targetTargets.length) return { department, targets: targetTargets.map((target) => ({ ...target })) };
    const fallback = this.state.rules.find((rule) => rule.department === "default") || emptyRule("default");
    return { department, targets: fallback[stageKey[stage]].map((target) => ({ ...target })) };
  }

  wasSent(eventId: string): boolean {
    return Boolean(this.state.sentEvents[eventId]);
  }

  markSent(eventId: string, targets: number): void {
    this.state.sentEvents[eventId] = { sentAt: new Date().toISOString(), targets };
    this.persist();
  }
}
