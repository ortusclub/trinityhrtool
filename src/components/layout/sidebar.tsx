"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  CalendarDays,
  CalendarHeart,
  Clock,
  Flag,
  BarChart3,
  Users,
  Settings,
  ArrowRightLeft,
  Home,
  Menu,
  X,
  Palmtree,
  Target,
  UsersRound,
  ChevronDown,
  SlidersHorizontal,
  Eye,
  Mail,
  HelpCircle,
  Gift,
  Ticket,
  FileText,
  ListTree,
  Upload,
  Inbox,
  Trophy,
  CalendarClock,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import type { UserRole } from "@/types/database";
import { cn, hasRole } from "@/lib/utils";
import { TrinityLogo } from "@/components/brand/trinity-logo";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  minRole: UserRole;
  /** If set, only roles in this list see the link (overrides minRole). */
  roles?: UserRole[];
}

interface NavSection {
  title: string;
  minRole: UserRole;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "",
    minRole: "employee",
    items: [
      { label: "Dashboard", href: "/", icon: <Home size={20} />, minRole: "employee" },
    ],
  },
  {
    title: "My Workspace",
    minRole: "employee",
    items: [
      { label: "My Schedule", href: "/schedule", icon: <Calendar size={20} />, minRole: "employee" },
      { label: "My Attendance", href: "/attendance", icon: <Clock size={20} />, minRole: "employee" },
      { label: "Schedule Requests", href: "/requests", icon: <ArrowRightLeft size={20} />, minRole: "employee" },
      { label: "Document Requests", href: "/documents", icon: <FileText size={20} />, minRole: "employee" },
      { label: "Flags", href: "/flags", icon: <Flag size={20} />, minRole: "employee" },
      { label: "Holidays", href: "/holidays", icon: <CalendarHeart size={20} />, minRole: "employee" },
      { label: "Team Calendar", href: "/weekly", icon: <CalendarDays size={20} />, minRole: "employee" },
      { label: "Team Directory", href: "/team", icon: <UsersRound size={20} />, minRole: "employee" },
      { label: "KPIs", href: "/kpis", icon: <Target size={20} />, minRole: "employee" },
      { label: "Performance", href: "/performance", icon: <Trophy size={20} />, minRole: "employee" },
      { label: "Workplace Concerns", href: "/concerns", icon: <ShieldAlert size={20} />, minRole: "employee" },
      { label: "Help & Guide", href: "/help", icon: <HelpCircle size={20} />, minRole: "employee" },
    ],
  },
  {
    title: "Team",
    minRole: "manager",
    items: [
      { label: "Team Attendance", href: "/attendance/team", icon: <Clock size={20} />, minRole: "manager" },
      { label: "1-on-1s", href: "/one-on-ones", icon: <CalendarClock size={20} />, minRole: "manager" },
    ],
  },
  {
    title: "Admin",
    minRole: "hr_admin",
    items: [
      { label: "All Attendance", href: "/attendance/all", icon: <Clock size={20} />, minRole: "hr_admin", roles: ["hr_support", "hr_admin", "super_admin"] },
      { label: "Reports", href: "/reports", icon: <BarChart3 size={20} />, minRole: "hr_admin" },
      { label: "All Schedules", href: "/admin/schedules", icon: <Calendar size={20} />, minRole: "hr_admin" },
      { label: "Manage Holidays", href: "/admin/holidays", icon: <CalendarHeart size={20} />, minRole: "hr_admin" },
      { label: "Leave Plans", href: "/admin/leave-plans", icon: <Palmtree size={20} />, minRole: "hr_admin" },
      { label: "Leave Credits", href: "/admin/leave-credits", icon: <Ticket size={20} />, minRole: "hr_admin" },
      { label: "Payroll", href: "/admin/payroll", icon: <Wallet size={20} />, minRole: "hr_admin" },
      { label: "Anniversary Benefits", href: "/admin/settings/anniversary-benefits", icon: <Gift size={20} />, minRole: "super_admin" },
      { label: "Document Requests", href: "/admin/document-requests", icon: <FileText size={20} />, minRole: "hr_admin" },
      { label: "Bulk Import", href: "/admin/bulk-import", icon: <Upload size={20} />, minRole: "hr_admin", roles: ["hr_support", "hr_admin", "super_admin"] },
      { label: "Pending Changes", href: "/admin/pending-changes", icon: <Inbox size={20} />, minRole: "hr_admin" },
      { label: "Concerns", href: "/concerns/admin", icon: <ShieldAlert size={20} />, minRole: "hr_admin" },
      { label: "Performance", href: "/admin/performance", icon: <Trophy size={20} />, minRole: "hr_admin" },
      { label: "Users", href: "/admin/users", icon: <Users size={20} />, minRole: "hr_admin" },
    ],
  },
];

const settingsSubItems: NavItem[] = [
  { label: "General", href: "/admin/settings", icon: <SlidersHorizontal size={18} />, minRole: "super_admin" },
  { label: "Emails", href: "/admin/settings/emails", icon: <Mail size={18} />, minRole: "super_admin" },
  { label: "Field Management", href: "/admin/settings/fields", icon: <ListTree size={18} />, minRole: "super_admin" },
  { label: "Feature Visibility", href: "/admin/settings/features", icon: <Eye size={18} />, minRole: "super_admin" },
];

export function Sidebar({
  userRole,
  comingSoonRoutes = [],
  sidebarOrder = {},
  badges = {},
}: {
  userRole: UserRole;
  comingSoonRoutes?: string[];
  /** Saved per-group route order (group title → ordered hrefs). */
  sidebarOrder?: Record<string, string[]>;
  /** Optional count badges per href, e.g. unread counts. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const settingsOpen = pathname.startsWith("/admin/settings");
  const [settingsExpanded, setSettingsExpanded] = useState(settingsOpen);

  // Resolve which section each item belongs to, allowing the saved order to
  // override the hardcoded default. An item's section is whichever group
  // contains its href in sidebarOrder; otherwise the section it was declared
  // in.
  const hrefToSavedGroup = new Map<string, string>();
  for (const [g, list] of Object.entries(sidebarOrder)) {
    for (const href of list) hrefToSavedGroup.set(href, g);
  }
  const allItems: Array<{
    item: NavItem;
    section: string;
    defaultSection: string;
  }> = [];
  for (const s of navSections) {
    for (const it of s.items) {
      const resolvedSection = hrefToSavedGroup.get(it.href) ?? s.title;
      allItems.push({ item: it, section: resolvedSection, defaultSection: s.title });
    }
  }

  const applyOrder = (items: NavItem[], groupKey: string): NavItem[] => {
    const saved = sidebarOrder[groupKey];
    if (!saved || saved.length === 0) return items;
    const byHref = new Map(items.map((i) => [i.href, i] as const));
    const ordered: NavItem[] = [];
    const seen = new Set<string>();
    for (const href of saved) {
      const it = byHref.get(href);
      if (it) {
        ordered.push(it);
        seen.add(href);
      }
    }
    for (const it of items) {
      if (!seen.has(it.href)) ordered.push(it);
    }
    return ordered;
  };

  const navContent = (
    <nav className="flex flex-col gap-1 p-4">
      {navSections.map((section) => {
        const itemsForThisSection = allItems
          .filter((x) => x.section === section.title)
          .map((x) => x.item);
        const visibleItems = applyOrder(
          itemsForThisSection.filter((item) =>
            item.roles
              ? item.roles.includes(userRole)
              : hasRole(userRole, item.minRole)
          ),
          section.title
        );
        if (visibleItems.length === 0) return null;

        return (
          <div key={section.title || "top"}>
            {section.title && (
              <p className="mb-1 mt-4 px-3 font-display text-[11px] uppercase tracking-wider text-gray-500">
                {section.title}
              </p>
            )}
            {visibleItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 font-display text-[15px] font-normal transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {item.icon}
                  {item.label}
                  {(badges[item.href] ?? 0) > 0 && (
                    <span className="ml-auto rounded-full bg-blue-600 px-1.5 py-0.5 font-sans text-[10px] font-medium text-white">
                      {badges[item.href]}
                    </span>
                  )}
                  {comingSoonRoutes.some((r) => item.href === r || item.href.startsWith(r + "/")) && userRole !== "super_admin" && (
                    <span className="ml-auto rounded bg-yellow-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-yellow-700">
                      Soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}

      {/* Settings dropdown */}
      {hasRole(userRole, "super_admin") && (
        <div>
          <p className="mb-1 mt-4 px-3 font-display text-[11px] uppercase tracking-wider text-gray-500">
            Settings
          </p>
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 font-display text-[15px] font-normal transition-colors",
              settingsOpen
                ? "bg-blue-50 text-blue-700"
                : "text-gray-700 hover:bg-gray-100"
            )}
          >
            <Settings size={20} />
            Settings
            <ChevronDown
              size={16}
              className={cn(
                "ml-auto transition-transform",
                settingsExpanded && "rotate-180"
              )}
            />
          </button>
          {settingsExpanded && (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-200 pl-3">
              {applyOrder(settingsSubItems, "Settings").map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 font-display text-[15px] font-normal transition-colors",
                      isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-md lg:hidden"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-white transform transition-transform lg:translate-x-0 lg:static",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand block, upper-left: the p1 cover lockup — two-tone icon and an
            ivory wordmark on the flame field. Wordmark colour rides on
            currentColor, so text-brand-ivory is what makes it cover-accurate.
            The header beside it is also h-16 and flame, so the two read as one
            unbroken band. That is why the aside carries no right border: a
            border here would draw a seam straight through the band. It lives
            on the panel below instead. */}
        <div className="flex h-16 shrink-0 items-center bg-brand-topbar px-6">
          <TrinityLogo variant="color" className="h-7 w-auto text-brand-ivory" />
        </div>
        {/* overflow-y-auto because flex-1 + min-h-0 would otherwise clip the
            nav list, which runs to 30+ items for admins. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-r border-gray-200">
          {navContent}
        </div>
      </aside>
    </>
  );
}
