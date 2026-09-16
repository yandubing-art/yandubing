import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export type StoredJob = {
  recordId: string;
  jobId: string;
  state: string;
  startedAt: string | null;
  updatedAt: string;
};

export type JobStoreLike = {
  getByRecordId(recordId: string): StoredJob | undefined | Promise<StoredJob | undefined>;
  getByJobId(jobId: string): StoredJob | undefined | Promise<StoredJob | undefined>;
  ensure(recordId: string, existingJobId?: string): StoredJob | Promise<StoredJob>;
  updateState(jobId: string, state: string, started?: boolean): void | Promise<void>;
};

type StoreFile = { jobs: StoredJob[] };

export class JobStore {
  private readonly filePath: string;
  private state: StoreFile;

  constructor() {
    this.filePath = config.storePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.state = this.load();
  }

  private load(): StoreFile {
    if (!fs.existsSync(this.filePath)) return { jobs: [] };
    const raw = fs.readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getByRecordId(recordId: string): StoredJob | undefined {
    return this.state.jobs.find((job) => job.recordId === recordId);
  }

  getByJobId(jobId: string): StoredJob | undefined {
    return this.state.jobs.find((job) => job.jobId === jobId);
  }

  ensure(recordId: string, existingJobId?: string): StoredJob {
    const current = this.getByRecordId(recordId);
    if (current) return current;

    const now = new Date().toISOString();
    const job: StoredJob = {
      recordId,
      jobId: existingJobId || `dispatch_${randomUUID()}`,
      state: "queued",
      startedAt: null,
      updatedAt: now
    };
    this.state.jobs.push(job);
    this.persist();
    return job;
  }

  updateState(jobId: string, state: string, started = false): void {
    const job = this.getByJobId(jobId);
    if (!job) return;
    job.state = state;
    if (started && !job.startedAt) job.startedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    this.persist();
  }
}
