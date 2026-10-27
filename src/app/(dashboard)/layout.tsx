import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { ComingSoonGate } from "@/components/layout/coming-soon-gate";
import { BrandBackdrop } from "@/components/brand/brand-backdrop";
import { anyReleased } from "@/lib/payslips-store";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [
    { data: comingSoon },
    { data: orderRow },
    { count: pendingPeerCount },
    releasedPayslips,
  ] = await Promise.all([
      supabase
        .from("system_settings")
        .select("key")
        .like("key", "coming_soon:%")
        .eq("value", "true"),
      supabase
        .from("system_settings")
        .select("value")
        .eq("key", "sidebar_order")
        .maybeSingle(),
      supabase
        .from("peer_feedback_requests")
        .select("id", { count: "exact", head: true })
        .eq("reviewer_id", user.id)
        .eq("status", "pending"),
      anyReleased(),
    ]);

  const comingSoonRoutes = [
    ...(comingSoon ?? []).map((s) => s.key.replace("coming_soon:", "")),
    // Payslips stays "Soon" until payroll publishes the first cutoff.
    ...(releasedPayslips ? [] : ["/payslips"]),
  ];
  let sidebarOrder: Record<string, string[]> = {};
  if (orderRow?.value) {
    try {
      sidebarOrder = JSON.parse(orderRow.value) as Record<string, string[]>;
    } catch {
      sidebarOrder = {};
    }
  }

  return (
    <div className="flex h-full">
      <Sidebar
        userRole={user.role}
        comingSoonRoutes={comingSoonRoutes}
        sidebarOrder={sidebarOrder}
        badges={{
          "/performance": pendingPeerCount ?? 0,
        }}
      />
      {/* isolate: gives BrandBackdrop a stacking context to sit inside,
          so its -z-10 lands above the page background, not behind it. */}
      <div className="relative isolate flex flex-1 flex-col overflow-hidden">
        <BrandBackdrop />
        <Header user={user} />
        <main className="flex-1 overflow-y-auto p-6">
          <ComingSoonGate userRole={user.role} comingSoonRoutes={comingSoonRoutes}>
            {children}
          </ComingSoonGate>
        </main>
      </div>
    </div>
  );
}
