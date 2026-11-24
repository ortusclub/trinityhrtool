import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Create a pending change. Used by HR support flows whose writes need admin
 * approval. Admins skip this path and write directly.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { change_type, target_employee_id, description, payload } = body;
  if (!change_type || !description || !payload) {
    return NextResponse.json(
      { error: "change_type, description, and payload are required" },
      { status: 400 }
    );
  }

  // hr_support / hr_admin / super_admin can queue changes against any
  // employee. Everyone else (employee, manager) can only queue changes
  // against their own profile.
  const hrRoles = new Set(["hr_support", "hr_admin", "super_admin"]);
  if (!hrRoles.has(caller.role) && target_employee_id !== authUser.id) {
    return NextResponse.json(
      { error: "Can only request changes to your own profile" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  // Fields marked "only HR admins can edit" (e.g. Current Salary) can't be
  // changed by anyone else, not even as a request for approval.
  if (!["hr_admin", "super_admin"].includes(caller.role)) {
    let fieldId: string | null = payload?.field_id ?? null;
    if (!fieldId && payload?.row_id) {
      const { data: row } = await admin
        .from("profile_field_value_rows")
        .select("field_id")
        .eq("id", payload.row_id)
        .maybeSingle();
      fieldId = (row?.field_id as string | undefined) ?? null;
    }
    if (fieldId) {
      const { data: field } = await admin
        .from("profile_fields")
        .select("label, admin_edit_only")
        .eq("id", fieldId)
        .maybeSingle();
      if (field?.admin_edit_only) {
        return NextResponse.json(
          { error: `Only HR admins can change "${field.label}".` },
          { status: 403 }
        );
      }
    }
  }

  const { data, error } = await admin
    .from("pending_changes")
    .insert({
      requested_by: authUser.id,
      change_type,
      target_employee_id: target_employee_id ?? null,
      description,
      payload,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ pending_change: data });
}
