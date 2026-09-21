import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type NotificationStage = "departure" | "return" | "booking";
export type VehicleReminderKind = "maintenance" | "inspection";
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
  maintenanceTargets: NotificationTarget[];
  inspectionTargets: NotificationTarget[];
};

export type VehicleReminderRule = {
  enabled: boolean;
  daysBefore: number;
  mileageBefore: number;
  frequencyHours: number;
  maxSends: number;
};

type SentEvent = { sentAt: string; targets: number; count?: number };
type NotificationFile = {
  rules: DepartmentNotificationRule[];
  reminders: Record<VehicleReminderKind, VehicleReminderRule>;
  sentEvents: Record<string, SentEvent>;
};

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

const reminderTargetKey: Record<VehicleReminderKind, "maintenanceTargets" | "inspectionTargets"> = {
  maintenance: "maintenanceTargets",
  inspection: "inspectionTargets"
};

const defaultReminderRules: Record<VehicleReminderKind, VehicleReminderRule> = {
  maintenance: { enabled: true, daysBefore: 30, mileageBefore: 1000, frequencyHours: 24, maxSends: 3 },
  inspection: { enabled: true, daysBefore: 30, mileageBefore: 0, frequencyHours: 24, maxSends: 3 }
};

function emptyRule(department: string): DepartmentNotificationRule {
  return { department, departureTargets: [], returnTargets: [], bookingTargets: [], maintenanceTargets: [], inspectionTargets: [] };
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
  // New reminder target arrays intentionally fall back to booking recipients
  // for existing installations, so enabling reminders does not require a
  // second round of recipient setup.
  const bookingTargets = cleanTargets(item.bookingTargets);
  return {
    department: fallbackDepartment,
    departureTargets: cleanTargets(item.departureTargets),
    returnTargets: cleanTargets(item.returnTargets),
    bookingTargets,
    maintenanceTargets: Array.isArray(item.maintenanceTargets) ? cleanTargets(item.maintenanceTargets) : bookingTargets.map((target) => ({ ...target })),
    inspectionTargets: Array.isArray(item.inspectionTargets) ? cleanTargets(item.inspectionTargets) : bookingTargets.map((target) => ({ ...target }))
  };
}

function cleanReminderRule(value: unknown, fallback: VehicleReminderRule): VehicleReminderRule {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const integerValue = (name: string, minimum: number, maximum: number): number => {
    const raw = Number(item[name]);
    return Number.isInteger(raw) ? Math.min(maximum, Math.max(minimum, raw)) : fallback[name as keyof VehicleReminderRule] as number;
  };
  return {
    enabled: typeof item.enabled === "boolean" ? item.enabled : fallback.enabled,
    daysBefore: integerValue("daysBefore", 0, 3650),
    mileageBefore: integerValue("mileageBefore", 0, 1_000_000),
    frequencyHours: integerValue("frequencyHours", 1, 8760),
    maxSends: integerValue("maxSends", 1, 100)
  };
}

function normalizeReminders(value: unknown): Record<VehicleReminderKind, VehicleReminderRule> {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    maintenance: cleanReminderRule(input.maintenance, defaultReminderRules.maintenance),
    inspection: cleanReminderRule(input.inspection, defaultReminderRules.inspection)
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
    if (!fs.existsSync(this.filePath)) return { rules: normalizeRules([]), reminders: normalizeReminders({}), sentEvents: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<NotificationFile>;
      const sentEvents = parsed.sentEvents && typeof parsed.sentEvents === "object" ? parsed.sentEvents as Record<string, SentEvent> : {};
      return { rules: normalizeRules(parsed.rules), reminders: normalizeReminders(parsed.reminders), sentEvents };
    } catch {
      return { rules: normalizeRules([]), reminders: normalizeReminders({}), sentEvents: {} };
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
      bookingTargets: rule.bookingTargets.map((target) => ({ ...target })),
      maintenanceTargets: rule.maintenanceTargets.map((target) => ({ ...target })),
      inspectionTargets: rule.inspectionTargets.map((target) => ({ ...target }))
    }));
  }

  reminderRules(): Record<VehicleReminderKind, VehicleReminderRule> {
    return {
      maintenance: { ...this.state.reminders.maintenance },
      inspection: { ...this.state.reminders.inspection }
    };
  }

  update(rules: unknown, reminders?: unknown): DepartmentNotificationRule[] {
    this.state.rules = normalizeRules(rules);
    if (reminders !== undefined) this.state.reminders = normalizeReminders(reminders);
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

  reminderTargetsFor(owner: string, kind: VehicleReminderKind): { department: string; targets: NotificationTarget[] } {
    const department = departmentFromOwner(owner);
    const targetKey = reminderTargetKey[kind];
    const targetRule = this.state.rules.find((rule) => rule.department === department) || emptyRule(department);
    if (targetRule[targetKey].length) return { department, targets: targetRule[targetKey].map((target) => ({ ...target })) };
    if (targetRule.bookingTargets.length) return { department, targets: targetRule.bookingTargets.map((target) => ({ ...target })) };
    const fallback = this.state.rules.find((rule) => rule.department === "default") || emptyRule("default");
    if (fallback[targetKey].length) return { department, targets: fallback[targetKey].map((target) => ({ ...target })) };
    return { department, targets: fallback.bookingTargets.map((target) => ({ ...target })) };
  }

  wasSent(eventId: string): boolean {
    return Boolean(this.state.sentEvents[eventId]);
  }

  sentEvent(eventId: string): { sentAt: string; targets: number; count: number } | undefined {
    const event = this.state.sentEvents[eventId];
    return event ? { sentAt: event.sentAt, targets: event.targets, count: event.count || 1 } : undefined;
  }

  markSent(eventId: string, targets: number): void {
    const previous = this.state.sentEvents[eventId];
    this.state.sentEvents[eventId] = { sentAt: new Date().toISOString(), targets, count: (previous?.count || 0) + 1 };
    this.persist();
  }
}
