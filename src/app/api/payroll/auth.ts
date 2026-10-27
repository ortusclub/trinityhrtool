import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { hasRole } from "@/lib/utils";
import type { User } from "@/types/database";

/** The signed-in HR admin or super admin, or a 403 response. */
export async function payrollAdmin(): Promise<User | NextResponse> {
  const user = await getCurrentUser();
  if (!hasRole(user.role, "hr_admin")) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  return user;
}

export function notSetUp() {
  return NextResponse.json(
  {
    setup: false,
    error:
      "Payslips aren't set up yet: run supabase/migrations/20261027_add_payslips.sql in Supabase once.",
  },
  { status: 503 },
  );
}
