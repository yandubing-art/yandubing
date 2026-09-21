import { config } from "./config.js";
import type { BitableRecord, DispatchTask } from "./types.js";
import { attachmentValues, dateValue, firstId, numberValue, textValue } from "./value.js";

export type TaskAccessPrincipal = {
  permissions: readonly string[];
  larkOpenId?: string | null;
  displayName?: string | null;
  system?: boolean;
};

function sameIdentity(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function taskFromRecord(record: BitableRecord): DispatchTask {
  const f = record.fields;
  const names = config.fields;
  return {
    recordId: record.record_id,
    taskNumber: textValue(f[names.taskNumber]),
    requester: textValue(f[names.requester]),
    requesterId: firstId(f[names.requester]),
    departureTime: dateValue(f[names.departureTime]),
    origin: textValue(f[names.origin]),
    destination: textValue(f[names.destination]),
    tripMode: textValue(f[names.tripMode]),
    transferLocation: textValue(f[names.transferLocation]),
    returnOrigin: textValue(f[names.returnOrigin]),
    returnDestination: textValue(f[names.returnDestination]),
    vehicle: textValue(f[names.vehicle]),
    vehicleModel: textValue(f[names.vehicleModel]),
    mileage: numberValue(f[names.mileage]),
    nextMaintenanceMileage: numberValue(f[names.nextMaintenanceMileage]),
    maintenanceReminder: textValue(f[names.maintenanceReminder]),
    status: textValue(f[names.status]),
    stage: textValue(f[names.stage]),
    departurePhotos: attachmentValues(f[names.departurePhotos]),
    departurePhotoTime: dateValue(f[names.departurePhotoTime]),
    departureCheckResult: textValue(f[names.departureCheckResult]),
    departurePhotoNotes: textValue(f[names.departurePhotoNotes]),
    returnMileage: numberValue(f[names.returnMileage]),
    returnPhotos: attachmentValues(f[names.returnPhotos]),
    returnPhotoTime: dateValue(f[names.returnPhotoTime]),
    returnCheckResult: textValue(f[names.returnCheckResult]),
    returnPhotoNotes: textValue(f[names.returnPhotoNotes]),
    damageDescription: textValue(f[names.damageDescription]),
    appJobId: textValue(f[names.appJobId]),
    result: textValue(f[names.result]),
    error: textValue(f[names.error])
  };
}

export function canAccessTask(task: DispatchTask, principal: TaskAccessPrincipal): boolean {
  if (principal.system || principal.permissions.includes("desktop_console") || principal.permissions.includes("view_all_tasks")) return true;
  return canAccessOwnTask(task, principal);
}

export function canAccessOwnTask(task: DispatchTask, principal: TaskAccessPrincipal): boolean {
  if (principal.larkOpenId && task.requesterId && sameIdentity(principal.larkOpenId, task.requesterId)) return true;
  return Boolean(task.requester && principal.displayName && sameIdentity(task.requester, principal.displayName));
}

export function canEditTask(task: DispatchTask, principal: TaskAccessPrincipal): boolean {
  if (principal.system) return true;
  if (principal.permissions.includes("edit_all_dispatch")) return true;
  return principal.permissions.includes("edit_own_dispatch") && canAccessOwnTask(task, principal);
}

/** A task is eligible for in-transit actions only after departure was recorded. */
export function isDepartedTask(task: DispatchTask): boolean {
  if (["已预约", "待调度", "已排程", "已完成", "失败", "取消"].includes(task.status)) return false;
  if (task.stage === "已返程") return false;
  return task.status === "执行中"
    || task.status === "已出发"
    || ["已出发", "返程待登记"].includes(task.stage)
    || task.departurePhotos.length > 0;
}
