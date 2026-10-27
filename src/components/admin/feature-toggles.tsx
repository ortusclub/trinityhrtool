"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { GripVertical, Save } from "lucide-react";

type FeatureGroup = "My Workspace" | "Team" | "Admin" | "Settings";

const FEATURES: ReadonlyArray<{
  route: string;
  label: string;
  group: FeatureGroup;
}> = [
  { route: "/schedule", label: "My Schedule", group: "My Workspace" },
  { route: "/payslips", label: "Payslips", group: "My Workspace" },
  { route: "/attendance", label: "My Attendance", group: "My Workspace" },
  { route: "/requests", label: "Schedule Requests", group: "My Workspace" },
  { route: "/documents", label: "Document Requests", group: "My Workspace" },
  { route: "/flags", label: "Flags", group: "My Workspace" },
  { route: "/holidays", label: "Holidays", group: "My Workspace" },
  { route: "/weekly", label: "Team Calendar", group: "My Workspace" },
  { route: "/team", label: "Team Directory", group: "My Workspace" },
  { route: "/kpis", label: "KPIs", group: "My Workspace" },
  { route: "/performance", label: "Performance", group: "My Workspace" },
  { route: "/performance/reviews", label: "↳ Reviews", group: "My Workspace" },
  { route: "/performance/peer-requests", label: "↳ Peer Requests", group: "My Workspace" },
  { route: "/performance/kpis", label: "↳ KPIs (Performance view)", group: "My Workspace" },
  { route: "/performance/kudos", label: "↳ Kudos", group: "My Workspace" },
  { route: "/performance/one-on-ones", label: "↳ 1-on-1s (Performance view)", group: "My Workspace" },
  { route: "/concerns", label: "Workplace Concerns", group: "My Workspace" },
  { route: "/help", label: "Help & Guide", group: "My Workspace" },
  { route: "/attendance/team", label: "Team Attendance", group: "Team" },
  { route: "/one-on-ones", label: "1-on-1s", group: "Team" },
  { route: "/attendance/all", label: "All Attendance", group: "Admin" },
  { route: "/reports", label: "Reports", group: "Admin" },
  { route: "/admin/schedules", label: "All Schedules", group: "Admin" },
  { route: "/admin/holidays", label: "Manage Holidays", group: "Admin" },
  { route: "/admin/leave-plans", label: "Leave Plans", group: "Admin" },
  {
    route: "/admin/settings/anniversary-benefits",
    label: "Anniversary Benefits",
    group: "Admin",
  },
  {
    route: "/admin/document-requests",
    label: "Document Requests (Admin)",
    group: "Admin",
  },
  { route: "/admin/bulk-import", label: "Bulk Import", group: "Admin" },
  { route: "/admin/pending-changes", label: "Pending Changes", group: "Admin" },
  { route: "/concerns/admin", label: "Concerns", group: "Admin" },
  { route: "/admin/performance", label: "Performance", group: "Admin" },
  { route: "/admin/users", label: "Users", group: "Admin" },
  { route: "/admin/settings", label: "General", group: "Settings" },
  { route: "/admin/settings/emails", label: "Emails", group: "Settings" },
  {
    route: "/admin/settings/fields",
    label: "Field Management",
    group: "Settings",
  },
];

const GROUP_ORDER: FeatureGroup[] = [
  "My Workspace",
  "Team",
  "Admin",
  "Settings",
];

export type SidebarOrder = Partial<Record<FeatureGroup, string[]>>;

export function FeatureToggles({
  comingSoonRoutes,
  initialOrder,
}: {
  comingSoonRoutes: string[];
  initialOrder: SidebarOrder;
}) {
  const router = useRouter();
  const [toggled, setToggled] = useState<Set<string>>(
    new Set(comingSoonRoutes)
  );
  // Resolve display order per group: start from saved order, then append any
  // features not in the saved order in their default position.
  const buildInitialOrder = (): Record<FeatureGroup, string[]> => {
    const out = {} as Record<FeatureGroup, string[]>;
    for (const g of GROUP_ORDER) {
      const defaults = FEATURES.filter((f) => f.group === g).map((f) => f.route);
      const saved = initialOrder[g] ?? [];
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const r of saved) {
        if (defaults.includes(r) && !seen.has(r)) {
          ordered.push(r);
          seen.add(r);
        }
      }
      for (const r of defaults) {
        if (!seen.has(r)) {
          ordered.push(r);
          seen.add(r);
        }
      }
      out[g] = ordered;
    }
    return out;
  };
  const [order, setOrder] = useState<Record<FeatureGroup, string[]>>(
    buildInitialOrder
  );
  const [draggingRoute, setDraggingRoute] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const byRoute = new Map(FEATURES.map((f) => [f.route, f]));

  const toggle = (route: string) => {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });
  };

  const findGroupOf = (
    state: Record<FeatureGroup, string[]>,
    route: string
  ): FeatureGroup | null => {
    for (const g of GROUP_ORDER) {
      if (state[g].includes(route)) return g;
    }
    return null;
  };

  const reorder = (
    targetGroup: FeatureGroup,
    fromRoute: string,
    toRoute: string
  ) => {
    if (fromRoute === toRoute) return;
    setOrder((prev) => {
      const sourceGroup = findGroupOf(prev, fromRoute);
      if (!sourceGroup) return prev;
      const next = { ...prev } as Record<FeatureGroup, string[]>;
      next[sourceGroup] = next[sourceGroup].filter((r) => r !== fromRoute);
      const targetList = [...next[targetGroup]];
      const insertAt = targetList.indexOf(toRoute);
      if (insertAt === -1) targetList.push(fromRoute);
      else targetList.splice(insertAt, 0, fromRoute);
      next[targetGroup] = targetList;
      return next;
    });
  };

  /** Drop on an empty group header → move dragged item to the bottom of that group. */
  const dropOnGroup = (targetGroup: FeatureGroup, fromRoute: string) => {
    setOrder((prev) => {
      const sourceGroup = findGroupOf(prev, fromRoute);
      if (!sourceGroup || sourceGroup === targetGroup) return prev;
      const next = { ...prev } as Record<FeatureGroup, string[]>;
      next[sourceGroup] = next[sourceGroup].filter((r) => r !== fromRoute);
      next[targetGroup] = [...next[targetGroup], fromRoute];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 1) Coming-soon flags
    await supabase
      .from("system_settings")
      .delete()
      .like("key", "coming_soon:%");
    const comingSoonRows = Array.from(toggled).map((route) => ({
      key: `coming_soon:${route}`,
      value: "true",
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }));
    if (comingSoonRows.length > 0) {
      await supabase.from("system_settings").insert(comingSoonRows);
    }

    // 2) Sidebar order
    await supabase.from("system_settings").upsert(
      {
        key: "sidebar_order",
        value: JSON.stringify(order),
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    setMessage("Saved.");
    setSaving(false);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <h2 className="font-display text-[20px] text-gray-900">
          Feature Visibility &amp; Order
        </h2>
        <p className="text-sm text-gray-500">
          Toggle features that are still in progress (non-super-admins see
          &quot;Coming Soon&quot;), and drag rows to reorder them in the sidebar.
        </p>
      </div>

      {message && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {message}
        </div>
      )}

      <div className="space-y-5">
        {GROUP_ORDER.map((group) => {
          const routes = order[group] ?? [];
          return (
            <div
              key={group}
              onDragOver={(e) => {
                if (draggingRoute) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e) => {
                if (draggingRoute) {
                  e.preventDefault();
                  dropOnGroup(group, draggingRoute);
                }
                setDraggingRoute(null);
              }}
            >
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {group}
              </p>
              {routes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-center text-[11px] text-gray-400">
                  Drag items here.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {routes.map((route) => {
                  const f = byRoute.get(route);
                  if (!f) return null;
                  const isDragging = draggingRoute === route;
                  return (
                    <div
                      key={route}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingRoute(route);
                      }}
                      onDragOver={(e) => {
                        if (draggingRoute && draggingRoute !== route) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          e.stopPropagation();
                        }
                      }}
                      onDrop={(e) => {
                        if (draggingRoute && draggingRoute !== route) {
                          e.preventDefault();
                          e.stopPropagation();
                          reorder(group, draggingRoute, route);
                        }
                        setDraggingRoute(null);
                      }}
                      onDragEnd={() => setDraggingRoute(null)}
                      className={`flex items-center gap-2 px-3 py-2.5 ${
                        isDragging ? "opacity-50" : ""
                      }`}
                    >
                      <GripVertical
                        size={14}
                        className="shrink-0 cursor-grab text-gray-400 active:cursor-grabbing"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-700">
                          {f.label}
                        </p>
                        <p className="text-xs text-gray-400">{f.route}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(route)}
                        title={
                          toggled.has(route)
                            ? "Marked as Coming Soon"
                            : "Live"
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          toggled.has(route) ? "bg-yellow-500" : "bg-gray-200"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            toggled.has(route) ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
