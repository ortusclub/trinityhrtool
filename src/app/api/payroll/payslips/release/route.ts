import { NextResponse } from "next/server";
import { BATCH_ID, getBatch, setRelease } from "@/lib/payslips-store";
import { failed, payrollAdmin } from "../../auth";

// Publish (each person sees their own payslip from the batch) or unpublish.
export async function POST(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const body = (await request.json().catch(() => null)) as
    | { batch_id?: string; published?: boolean }
    | null;
  if (!body || !BATCH_ID.test(body.batch_id ?? "") || typeof body.published !== "boolean") {
    return NextResponse.json({ error: "Unknown batch." }, { status: 400 });
  }
  try {
    if (body.published && !(await getBatch(body.batch_id!))) {
      return NextResponse.json({ error: "Prepare or upload the payslips first." }, { status: 400 });
    }
    const release = body.published
      ? { published_at: new Date().toISOString(), published_by: admin.id }
      : null;
    await setRelease(body.batch_id!, release);
    return NextResponse.json({ published_at: release?.published_at ?? null });
  } catch (e) {
    return failed(e);
  }
}
