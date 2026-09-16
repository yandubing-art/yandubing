import { config } from "./config.js";
import { LarkClient } from "./lark.js";
import type { JobStoreLike } from "./store.js";
import { numberValue, textValue } from "./value.js";
import type { BitableRecord, DispatchTask, ExecutorResponse } from "./types.js";
import { taskFromRecord } from "./task.js";

const ACTIVE_STATUSES = new Set(["待调度", "已排程", "执行中"]);
const TERMINAL_STATUSES = new Set(["已完成", "失败", "取消"]);

export { taskFromRecord } from "./task.js";

function isDue(task: DispatchTask, now = new Date()): boolean {
  return Boolean(task.departureTime && task.departureTime.getTime() <= now.getTime());
}

export class DispatchScheduler {
  private running = false;

  constructor(private readonly lark: LarkClient, private readonly store: JobStoreLike) {}

  async syncOnce(): Promise<{ scanned: number; queued: number; executed: number; vehicleSynced: number }> {
    if (this.running) return { scanned: 0, queued: 0, executed: 0, vehicleSynced: 0 };
    this.running = true;
    let queued = 0;
    let executed = 0;
    let vehicleSynced = 0;

    try {
      const records = await this.lark.listRecords();
      for (const record of records) {
        const task = taskFromRecord(record);
        if (!ACTIVE_STATUSES.has(task.status) || TERMINAL_STATUSES.has(task.status)) continue;

        if (task.vehicle && task.mileage !== null) {
          try {
            const match = await this.lark.findVehicle(task.vehicle);
            if (match.status === "matched" && match.vehicle) {
              const vehicleSync = await this.lark.syncVehicleMileage(task.vehicle, task.mileage, match);
              if (vehicleSync.updated) vehicleSynced += 1;
              const nextMileage = match.vehicle.nextMaintenanceMileage;
              if (nextMileage !== null && task.nextMaintenanceMileage !== nextMileage) {
                await this.lark.updateRecord(task.recordId, { [config.fields.nextMaintenanceMileage]: nextMileage });
              }
            }
          } catch (error) {
            console.warn(`Vehicle sync skipped for ${task.vehicle}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // A booking is queued only after a scheduler explicitly accepts it.
        // Do not promote a pending reservation simply because its departure
        // time has arrived.
        if (!isDue(task) || task.status !== "已排程") continue;

        const job = await this.store.ensure(task.recordId, task.appJobId || undefined);
        if (!task.appJobId) {
          await this.lark.updateRecord(task.recordId, {
            [config.fields.appJobId]: job.jobId,
            [config.fields.status]: "已排程",
            [config.fields.result]: "已进入后端调度队列",
            [config.fields.error]: null
          });
          queued += 1;
        }

        if (config.dispatchExecutorUrl && !job.startedAt) {
          await this.execute(task, job.jobId);
          executed += 1;
        }
      }
      return { scanned: records.length, queued, executed, vehicleSynced };
    } finally {
      this.running = false;
    }
  }

  async execute(task: DispatchTask, jobId: string): Promise<void> {
    await this.store.updateState(jobId, "running", true);
    await this.lark.updateRecord(task.recordId, {
      [config.fields.status]: "执行中",
      [config.fields.result]: "已发送到调度执行器",
      [config.fields.error]: null
    });

    try {
      const response = await fetch(config.dispatchExecutorUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dispatch-Job-Id": jobId },
        body: JSON.stringify({ jobId, task })
      });
      const payload = (await response.json().catch(() => ({}))) as ExecutorResponse;
      if (!response.ok || payload.status === "failed") {
        throw new Error(payload.error || `executor returned HTTP ${response.status}`);
      }

      const finalStatus = payload.status === "completed" ? "已完成" : "执行中";
      const result = payload.result || (finalStatus === "已完成" ? "调度执行器已完成" : "调度执行器已接收");
      await this.store.updateState(jobId, finalStatus);
      await this.lark.updateRecord(task.recordId, {
        [config.fields.status]: finalStatus,
        [config.fields.result]: result,
        [config.fields.error]: null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateState(jobId, "failed");
      await this.lark.updateRecord(task.recordId, {
        [config.fields.status]: "失败",
        [config.fields.result]: "调度执行器调用失败",
        [config.fields.error]: message
      });
    }
  }

  async updateFromCallback(input: { jobId: string; status: string; result?: string; error?: string }): Promise<void> {
    const job = await this.store.getByJobId(input.jobId);
    if (!job) throw new Error("Unknown dispatch job ID");
    const recordStatus = input.status === "completed" ? "已完成" : input.status === "failed" ? "失败" : "执行中";
    await this.store.updateState(input.jobId, recordStatus);
    await this.lark.updateRecord(job.recordId, {
      [config.fields.status]: recordStatus,
      [config.fields.result]: input.result || "调度执行器回调已处理",
      [config.fields.error]: input.error || null
    });
  }
}
