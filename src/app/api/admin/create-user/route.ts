import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend";
import { loadAndRender } from "@/lib/email/render";
import { getUniversalVars } from "@/lib/email/universal-vars";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();

  if (!currentUser || !["hr_admin", "super_admin"].includes(currentUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { full_name, preferred_name, first_name, middle_name, last_name, email, role, company, department, job_title, manager_id, desktime_employee_id, desktime_url, holiday_country, timezone, birthday, hire_date, regularization_date, end_date, is_active, overtime_eligible, employment_type, schedule } = body;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Check if user already exists
  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
  }

  // Create auth user (no password — they'll use Google SSO)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: full_name || "" },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!authData.user) {
    return NextResponse.json({ error: "Failed to create auth user" }, { status: 500 });
  }

  // Wait for trigger to create public.users row, then update
  await new Promise((r) => setTimeout(r, 200));

  const updateFields: Record<string, unknown> = {
    full_name: full_name || "",
    preferred_name: preferred_name || first_name || null,
    first_name: first_name || null,
    middle_name: middle_name || null,
    last_name: last_name || null,
    role: role || "employee",
    holiday_country: holiday_country || "PH",
    timezone: timezone || "Asia/Manila",
    is_active: is_active !== false,
    overtime_eligible: Boolean(overtime_eligible),
    // Column default is 'employee', but set it explicitly so the creation form
    // is the source of truth. Anything other than 'consultant' falls back to
    // 'employee' — the CHECK constraint only allows those two.
    employment_type: employment_type === "consultant" ? "consultant" : "employee",
  };
  if (company) updateFields.company = company;
  if (department) updateFields.department = department;
  if (job_title) updateFields.job_title = job_title;
  if (manager_id) updateFields.manager_id = manager_id;
  if (desktime_employee_id) updateFields.desktime_employee_id = parseInt(desktime_employee_id);
  if (desktime_url) updateFields.desktime_url = desktime_url;
  if (birthday) updateFields.birthday = birthday;
  if (hire_date) updateFields.hire_date = hire_date;
  if (regularization_date) updateFields.regularization_date = regularization_date;
  if (end_date) updateFields.end_date = end_date;

  const { error: updateError } = await admin
    .from("users")
    .update(updateFields)
    .eq("id", authData.user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Create schedule if provided
  if (schedule && Array.isArray(schedule)) {
    const today = new Date().toISOString().split("T")[0];
    const userId = authData.user.id;

    for (const day of schedule) {
      await admin.from("schedules").insert({
        employee_id: userId,
        day_of_week: day.day_of_week,
        start_time: day.start_time || "09:00",
        end_time: day.end_time || "18:00",
        is_rest_day: day.is_rest_day || false,
        work_location: day.work_location || "office",
        effective_from: today,
      });
    }
  }

  // Send password setup email
  try {
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/set-password`,
      },
    });

    const resetLink = linkData?.properties?.action_link || "";
    if (resetLink) {
      const { subject, html } = await loadAndRender("welcome", {
        ...getUniversalVars({
          full_name,
          preferred_name,
          first_name,
          last_name,
          email,
          department,
          job_title,
        }),
        employee_name: full_name || "there",
        reset_link: resetLink,
      });

      await sendEmail({ to: email, subject, html });
    }
  } catch {
    // Non-blocking — user is created even if email fails
  }

  return NextResponse.json({ success: true, id: authData.user.id });
}
