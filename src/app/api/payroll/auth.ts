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

export function failed(e: unknown) {
  const message = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  return NextResponse.json({ error: message }, { status: 500 });
}
