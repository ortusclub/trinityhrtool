import { createAdminClient } from "@/lib/supabase/admin";
import { readPayslipSettings, type PayslipSettings } from "@/lib/payslips";
import type { StoredPayslip } from "@/types/database";

// Payslips live in a private Supabase Storage bucket, read and written only
// here with the service role. Callers check who may see what:
//   batches/<batch>.json       what a batch holds (admins)
//   published/<batch>.json     present once a batch is released
//   slips/<batch>/<user>.json  one payslip
//   settings.json              what every payslip shows
const BUCKET = "payslips";

/** trinity-2026-11-P10 (a payroll cutoff), notax-2026-10-23, xk-2026-10-23. */
export const BATCH_ID = /^(trinity-\d{4}-\d{2}-P(10|25)|(notax|xk)-\d{4}-\d{2}-\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BatchKind = "trinity" | "notax" | "xk";

export interface BatchEntry {
  user_id: string;
  name: string;
  email: string;
  net_pay: number;
  currency: string;
}

export interface BatchMeta {
  id: string;
  kind: BatchKind;
  label: string;
  payout_date: string;
  prepared_at: string;
  prepared_by: string;
  entries: BatchEntry[];
}

export interface Release {
  published_at: string;
  published_by: string;
}

let bucketReady: Promise<void> | null = null;

/** Creates the private bucket the first time it's needed. */
function storage() {
  const client = createAdminClient();
  if (!bucketReady) {
    bucketReady = (async () => {
      const { error } = await client.storage.getBucket(BUCKET);
      if (!error) return;
      const made = await client.storage.createBucket(BUCKET, { public: false });
      if (made.error && !/already exists/i.test(made.error.message)) throw made.error;
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady.then(() => client.storage.from(BUCKET));
}

async function readJson<T>(path: string): Promise<T | null> {
  const { data, error } = await (await storage()).download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const { error } = await (await storage()).upload(path, JSON.stringify(value), {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw error;
}

async function remove(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await (await storage()).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

async function listNames(folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await (await storage()).list(folder, { limit: 1000, offset });
    if (error) throw error;
    out.push(...(data ?? []).map((f) => f.name).filter((n) => n.endsWith(".json")));
    if (!data || data.length < 1000) return out;
  }
}

/** Runs `fn` over `items`, a few at a time. */
async function each<T, R>(items: T[], fn: (item: T) => Promise<R>, width = 8): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function getBatch(id: string) {
  if (!BATCH_ID.test(id)) return null;
  const [meta, release] = await Promise.all([
    readJson<BatchMeta>(`batches/${id}.json`),
    readJson<Release>(`published/${id}.json`),
  ]);
  return meta ? { meta, release } : null;
}

export async function listBatches() {
  const [ids, published] = await Promise.all([listNames("batches"), listNames("published")]);
  const released = new Set(published);
  const metas = await each(ids, (n) => readJson<BatchMeta>(`batches/${n}`));
  const releases = await each(
    metas.map((m) => m?.id ?? ""),
    (id) => (id && released.has(`${id}.json`) ? readJson<Release>(`published/${id}.json`) : Promise.resolve(null)),
  );
  return metas
    .map((meta, i) => (meta ? { meta, release: releases[i] } : null))
    .filter((b): b is { meta: BatchMeta; release: Release | null } => !!b)
    .sort((a, b) => b.meta.payout_date.localeCompare(a.meta.payout_date));
}

/** Replaces a batch: writes every payslip, drops ones no longer in it. */
export async function saveBatch(meta: BatchMeta, slips: StoredPayslip[]): Promise<void> {
  const keep = new Set(slips.map((s) => `${s.employee_id}.json`));
  const before = await listNames(`slips/${meta.id}`);
  await each(slips, (s) => writeJson(`slips/${meta.id}/${s.employee_id}.json`, s));
  const stale = before.filter((n) => !keep.has(n)).map((n) => `slips/${meta.id}/${n}`);
  if (stale.length) await remove(stale);
  await writeJson(`batches/${meta.id}.json`, meta);
}

export async function deleteBatch(id: string): Promise<void> {
  const slips = (await listNames(`slips/${id}`)).map((n) => `slips/${id}/${n}`);
  await remove([...slips, `batches/${id}.json`, `published/${id}.json`]);
  releasedCache = null;
}

export async function setRelease(id: string, release: Release | null): Promise<void> {
  if (release) await writeJson(`published/${id}.json`, release);
  else await remove([`published/${id}.json`]);
  releasedCache = null;
}

export async function getSlip(batchId: string, userId: string) {
  if (!BATCH_ID.test(batchId) || !UUID.test(userId)) return null;
  return readJson<StoredPayslip>(`slips/${batchId}/${userId}.json`);
}

/** A person's own payslips from released batches, newest first. */
export async function releasedSlipsFor(userId: string): Promise<StoredPayslip[]> {
  if (!UUID.test(userId)) return [];
  const ids = (await listNames("published")).map((n) => n.replace(/\.json$/, ""));
  const slips = await each(ids, (id) => getSlip(id, userId));
  return slips
    .filter((s): s is StoredPayslip => !!s)
    .sort((a, b) => b.payout_date.localeCompare(a.payout_date));
}

export async function isReleased(batchId: string): Promise<boolean> {
  return !!(await readJson<Release>(`published/${batchId}.json`));
}

// The menu asks on every page whether anything is released yet; that only
// changes when someone publishes, so a few minutes' memory is plenty.
let releasedCache: { value: boolean; at: number } | null = null;
export async function anyReleased(): Promise<boolean> {
  if (releasedCache && Date.now() - releasedCache.at < 5 * 60_000) return releasedCache.value;
  try {
    const value = (await listNames("published")).length > 0;
    releasedCache = { value, at: Date.now() };
    return value;
  } catch {
    return false;
  }
}

export async function loadPayslipSettings(): Promise<PayslipSettings> {
  return readPayslipSettings(await readJson("settings.json"));
}

export async function savePayslipSettings(settings: PayslipSettings): Promise<void> {
  await writeJson("settings.json", settings);
}
