import { createAdminClient } from "@/lib/supabase/admin";
import { buildICal, type CalendarEvent } from "@/lib/calendar/ical";
import { displayName } from "@/lib/utils";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { LEAVE_TYPE_LABELS } from "@/lib/constants";

export const runtime = "nodejs";
// Google polls iCal feeds infrequently; let edge caches hold for a few mins.
export const revalidate = 300;

type Scope =
  | "me"
  | "my_team"
  | "direct_reports"
  | "all_reports"
  | "department"
  | "company";
const VALID_SCOPES: Scope[] = [
  "me",
  "my_team",
  "direct_reports",
  "all_reports",
  "department",
  "company",
];

type EventType =
  | "birthdays"
  | "anniversaries"
  | "leaves"
  | "adjustments"
  | "overtime"
  | "holiday_work"
  | "holidays";
const VALID_TYPES: EventType[] = [
  "birthdays",
  "anniversaries",
  "leaves",
  "adjustments",
  "overtime",
  "holiday_work",
  "holidays",
];

const SCOPE_LABELS: Record<Scope, string> = {
  me: "Me",
  my_team: "My Team",
  direct_reports: "My Direct Reports",
  all_reports: "My Reports",
  department: "My Department",
  company: "Company",
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
  manager_id: string | null;
  department: string | null;
  birthday: string | null;
  hire_date: string | null;
  is_active: boolean;
};

function emptyResponse(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function gatherDescendantIds(rootId: string, byManager: Map<string, string[]>): Set<string> {
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const childId of byManager.get(cur) ?? []) {
      if (!out.has(childId)) {
        out.add(childId);
        queue.push(childId);
      }
    }
  }
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const scopeParam = (url.searchParams.get("scope") || "me") as Scope;

  if (!token) return emptyResponse("Missing token", 401);
  if (!VALID_SCOPES.includes(scopeParam)) {
    return emptyResponse(`Invalid scope. Use one of: ${VALID_SCOPES.join(", ")}`);
  }

  // `types` is a comma-separated allow-list. If omitted, include everything
  // (keeps any previously-shared URLs working).
  const typesParam = url.searchParams.get("types");
  const enabled: Set<EventType> = typesParam
    ? new Set(
        typesParam
          .split(",")
          .map((t) => t.trim())
          .filter((t): t is EventType => VALID_TYPES.includes(t as EventType))
      )
    : new Set(VALID_TYPES);

  const admin = createAdminClient();

  // Resolve the requesting user from the token.
  const { data: subscriber } = await admin
    .from("users")
    .select(
      "id, email, full_name, preferred_name, first_name, last_name, manager_id, department, birthday, hire_date, is_active, holiday_country"
    )
    .eq("calendar_token", token)
    .maybeSingle();

  if (!subscriber || !subscriber.is_active) {
    return emptyResponse("Invalid or revoked token", 401);
  }

  // Pull the active user list once — needed for scope resolution and for
  // attaching display names to events.
  // Company-wide read — page past PostgREST's 1000-row cap so large orgs
  // don't silently lose users (which would drop them from scope + events).
  const users = (await fetchAllRows((from, to) =>
    admin
      .from("users")
      .select(
        "id, email, full_name, preferred_name, first_name, last_name, manager_id, department, birthday, hire_date, is_active"
      )
      .eq("is_active", true)
      .order("id")
      .range(from, to)
  )) as UserRow[];
  const byId = new Map(users.map((u) => [u.id, u]));
  const byManager = new Map<string, string[]>();
  for (const u of users) {
    if (!u.manager_id) continue;
    if (!byManager.has(u.manager_id)) byManager.set(u.manager_id, []);
    byManager.get(u.manager_id)!.push(u.id);
  }

  // Resolve scope → set of relevant user IDs.
  let scopeIds: Set<string>;
  switch (scopeParam) {
    case "me":
      scopeIds = new Set([subscriber.id]);
      break;
    case "my_team": {
      // Peer team: everyone with the same manager + the manager themselves.
      // Works for employees (their peers + boss) and managers (their peers
      // + their own boss). For someone with no manager, falls back to me.
      const myManager = subscriber.manager_id;
      if (!myManager) {
        scopeIds = new Set([subscriber.id]);
      } else {
        scopeIds = new Set(
          users.filter((u) => u.manager_id === myManager).map((u) => u.id)
        );
        scopeIds.add(myManager);
      }
      break;
    }
    case "direct_reports":
      scopeIds = new Set([
        subscriber.id,
        ...(byManager.get(subscriber.id) ?? []),
      ]);
      break;
    case "all_reports":
      scopeIds = gatherDescendantIds(subscriber.id, byManager);
      break;
    case "department":
      if (!subscriber.department) {
        scopeIds = new Set([subscriber.id]);
      } else {
        scopeIds = new Set(
          users
            .filter((u) => u.department === subscriber.department)
            .map((u) => u.id)
        );
      }
      break;
    case "company":
      scopeIds = new Set(users.map((u) => u.id));
      break;
  }

  const ids = Array.from(scopeIds);
  const nameOf = (id: string): string => {
    const u = byId.get(id);
    return u ? displayName(u) : "Someone";
  };

  // Fetch only the event sources the user asked for. Company-wide reads can
  // exceed PostgREST's 1000-row cap, so page through each (fetchAllRows) with
  // an ordered query — otherwise approved leaves silently drop past row 1000.
  const [leaveRows, adjRows, otRows, hwRows, holidayRows] = await Promise.all([
    enabled.has("leaves")
      ? fetchAllRows((from, to) =>
          admin
            .from("leave_requests")
            .select(
              "id, employee_id, leave_type, start_date, end_date, leave_duration, half_day_period, half_day_start_time, half_day_end_time"
            )
            .in("employee_id", ids)
            .eq("status", "approved")
            .order("id")
            .range(from, to)
        )
      : Promise.resolve([]),
    enabled.has("adjustments")
      ? fetchAllRows((from, to) =>
          admin
            .from("schedule_adjustments")
            .select(
              "id, employee_id, requested_date, requested_start_time, requested_end_time"
            )
            .in("employee_id", ids)
            .eq("status", "approved")
            .neq("requested_date", "9999-12-31")
            .order("id")
            .range(from, to)
        )
      : Promise.resolve([]),
    enabled.has("overtime")
      ? fetchAllRows((from, to) =>
          admin
            .from("overtime_requests")
            .select("id, employee_id, requested_date, start_time, end_time, reason")
            .in("employee_id", ids)
            .eq("status", "approved")
            .order("id")
            .range(from, to)
        )
      : Promise.resolve([]),
    enabled.has("holiday_work")
      ? fetchAllRows((from, to) =>
          admin
            .from("holiday_work_requests")
            .select(
              "id, employee_id, holiday_date, start_time, end_time, work_location, holiday:holidays!holiday_work_requests_holiday_id_fkey(name)"
            )
            .in("employee_id", ids)
            .eq("status", "approved")
            .order("id")
            .range(from, to)
        )
      : Promise.resolve([]),
    enabled.has("holidays")
      ? fetchAllRows((from, to) =>
          admin
            .from("holidays")
            .select("id, name, date, country, is_recurring")
            .order("id")
            .range(from, to)
        )
      : Promise.resolve([]),
  ]);

  const events: CalendarEvent[] = [];

  // Birthdays + anniversaries (yearly recurrence)
  if (enabled.has("birthdays") || enabled.has("anniversaries")) {
    for (const id of ids) {
      const u = byId.get(id);
      if (!u) continue;
      const name = displayName(u);
      if (enabled.has("birthdays") && u.birthday) {
        events.push({
          uid: `birthday-${u.id}@ortushrtool`,
          summary: `${name}'s Birthday`,
          date: u.birthday,
          rruleYearly: true,
        });
      }
      if (enabled.has("anniversaries") && u.hire_date) {
        events.push({
          uid: `anniversary-${u.id}@ortushrtool`,
          summary: `${name}'s Work Anniversary`,
          description: `Joined Ortus Club on ${u.hire_date}`,
          date: u.hire_date,
          rruleYearly: true,
        });
      }
    }
  }

  // Approved leaves (full and half-day)
  for (const l of leaveRows) {
    const name = nameOf(l.employee_id);
    const label = LEAVE_TYPE_LABELS[l.leave_type] ?? "Leave";
    if (l.leave_duration === "half_day") {
      const period = l.half_day_period === "am" ? "AM" : "PM";
      events.push({
        uid: `leave-${l.id}@ortushrtool`,
        summary: `${name} — ${label} (Half day ${period})`,
        description:
          l.half_day_start_time && l.half_day_end_time
            ? `${l.half_day_start_time}–${l.half_day_end_time}`
            : undefined,
        date: l.start_date,
      });
    } else {
      // One all-day event spanning start..end (DTEND handled in the builder).
      // Previously this exploded into one event per day, bloating the feed ~2x.
      events.push({
        uid: `leave-${l.id}@ortushrtool`,
        summary: `${name} — ${label}`,
        date: l.start_date,
        dateEnd: l.end_date ?? l.start_date,
      });
    }
  }

  // Approved schedule adjustments (timed events on the requested date)
  for (const a of adjRows) {
    const name = nameOf(a.employee_id);
    const isoDate = a.requested_date;
    if (!isoDate || !a.requested_start_time || !a.requested_end_time) continue;
    events.push({
      uid: `adjustment-${a.id}@ortushrtool`,
      summary: `${name} — Schedule Adjustment`,
      start: `${isoDate}T${a.requested_start_time.slice(0, 8)}+08:00`,
      end: `${isoDate}T${a.requested_end_time.slice(0, 8)}+08:00`,
    });
  }

  // Approved overtime requests
  for (const o of otRows) {
    const name = nameOf(o.employee_id);
    if (!o.requested_date || !o.start_time || !o.end_time) continue;
    const isOvernight = o.end_time < o.start_time;
    const endDate = isOvernight
      ? new Date(new Date(o.requested_date + "T00:00:00").getTime() + 86400000)
          .toISOString()
          .slice(0, 10)
      : o.requested_date;
    events.push({
      uid: `overtime-${o.id}@ortushrtool`,
      summary: `${name} — Overtime`,
      description: o.reason ?? undefined,
      start: `${o.requested_date}T${o.start_time.slice(0, 8)}+08:00`,
      end: `${endDate}T${o.end_time.slice(0, 8)}+08:00`,
    });
  }

  // Approved holiday work
  for (const h of hwRows) {
    const name = nameOf(h.employee_id);
    const holiday = Array.isArray(h.holiday) ? h.holiday[0] : h.holiday;
    const holidayName = holiday?.name ?? "Holiday";
    events.push({
      uid: `holiday-work-${h.id}@ortushrtool`,
      summary: `${name} — Working on ${holidayName}`,
      description: h.work_location === "online" ? "Online" : "Office",
      start: `${h.holiday_date}T${h.start_time.slice(0, 8)}+08:00`,
      end: `${h.holiday_date}T${h.end_time.slice(0, 8)}+08:00`,
    });
  }

  // Holidays — filter by an explicit `country` query param. If omitted, fall
  // back to the subscriber's own country. Pass `country=all` to include all.
  const requestedCountry = url.searchParams.get("country");
  const subscriberCountry = (subscriber as { holiday_country?: string })
    .holiday_country;
  const filterCountry =
    requestedCountry && requestedCountry !== "all"
      ? requestedCountry
      : !requestedCountry
        ? subscriberCountry
        : null; // null = include all
  for (const h of holidayRows) {
    if (filterCountry && h.country !== filterCountry) continue;
    events.push({
      uid: `holiday-${h.id}-${h.country}@ortushrtool`,
      summary: `Holiday (${h.country}) — ${h.name}`,
      date: h.date,
      rruleYearly: !!h.is_recurring,
    });
  }

  const ical = buildICal({
    calendarName: `Ortus HR — ${SCOPE_LABELS[scopeParam]}`,
    events,
  });

  return new Response(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
