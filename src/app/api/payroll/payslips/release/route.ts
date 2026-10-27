import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
    const db = await createClient();
    if (body.published && !(await getBatch(db, body.batch_id!))?.rows.length) {
      return NextResponse.json({ error: "Prepare or upload the payslips first." }, { status: 400 });
    }
    const published_at = await setRelease(db, body.batch_id!, body.published ? admin.id : null);
    return NextResponse.json({ published_at });
  } catch (e) {
    return failed(e);
  }
}
