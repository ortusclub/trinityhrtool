import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { loadAndRender } from "@/lib/email/render";
import { resolveEffectiveRecipients } from "@/lib/email/recipients";
import { formatInTimeZone } from "date-fns-tz";

const MANILA_TZ = "Asia/Manila";

// Countries Nager.Date can auto-fetch. Kosovo (XK) and the UAE (AE) are NOT in
// Nager's coverage, so those still need manual entry — called out in the email.
const FETCHABLE = [
  { code: "PH", label: "Philippines" },
  { code: "IT", label: "Italy" },
  { code: "US", label: "United States" },
  { code: "KR", label: "South Korea" },
] as const;
const UNFETCHABLE = [
  { code: "XK", label: "Kosovo" },
  { code: "AE", label: "United Arab Emirates" },
] as const;

type NagerHoliday = { date: string; name: string; localName: string };

// Fires once a year (Dec 1, via vercel.json). Pulls the upcoming year's public
// holidays from Nager.Date for the supported countries, stages the new ones in
// holiday_suggestions (NOT live until HR approves), and emails HR to review.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const currentYear = parseInt(formatInTimeZone(now, MANILA_TZ, "yyyy"), 10);
  const nextYear = currentYear + 1;
  const admin = createAdminClient();

  try {
    // Existing live holidays for these countries — used to skip dates we already
    // have. Recurring rows are matched on MM-DD (they apply every year); one-off
    // rows on the exact date.
    const { data: existing } = await admin
      .from("holidays")
      .select("country, date, is_recurring")
      .in("country", FETCHABLE.map((c) => c.code));

    const coveredExact = new Set<string>(); // `${country}|${YYYY-MM-DD}`
    const coveredRecurring = new Set<string>(); // `${country}|${MM-DD}`
    for (const h of existing ?? []) {
      coveredExact.add(`${h.country}|${h.date}`);
      if (h.is_recurring) coveredRecurring.add(`${h.country}|${h.date.slice(5)}`);
    }

    const perCountry: { code: string; label: string; staged: number; skipped: number; error?: string }[] = [];
    const toInsert: { country: string; name: string; date: string; year: number; source: string }[] = [];

    for (const { code, label } of FETCHABLE) {
      try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${nextYear}/${code}`);
        if (!res.ok) {
          perCountry.push({ code, label, staged: 0, skipped: 0, error: `Nager returned ${res.status}` });
          continue;
        }
        const holidays = (await res.json()) as NagerHoliday[];
        let staged = 0;
        let skipped = 0;
        for (const h of holidays) {
          const alreadyLive =
            coveredExact.has(`${code}|${h.date}`) ||
            coveredRecurring.has(`${code}|${h.date.slice(5)}`);
          if (alreadyLive) {
            skipped++;
            continue;
          }
          toInsert.push({ country: code, name: h.localName || h.name, date: h.date, year: nextYear, source: "nager" });
          staged++;
        }
        perCountry.push({ code, label, staged, skipped });
      } catch (e) {
        perCountry.push({ code, label, staged: 0, skipped: 0, error: e instanceof Error ? e.message : "fetch failed" });
      }
    }

    // Upsert so re-runs are idempotent (unique on country,date,name).
    let inserted = 0;
    if (toInsert.length > 0) {
      const { data, error } = await admin
        .from("holiday_suggestions")
        .upsert(toInsert, { onConflict: "country,date,name", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      inserted = data?.length ?? 0;
    }

    // Always point HR at the production tool. NEXT_PUBLIC_APP_URL is localhost
    // in local/dev, so ignore that and use prod — otherwise a locally-triggered
    // run emails real HR a localhost link.
    const envUrl = process.env.NEXT_PUBLIC_APP_URL;
    const appUrl =
      envUrl && !envUrl.includes("localhost")
        ? envUrl
        : "https://trinityhr.vercel.app";
    const breakdown_html = perCountry
      .map((c) =>
        c.error
          ? `<li><strong>${c.label}</strong>: couldn't fetch (${c.error}) — please add manually.</li>`
          : `<li><strong>${c.label}</strong>: ${c.staged} new staged${c.skipped ? `, ${c.skipped} already on file` : ""}.</li>`
      )
      .join("");
    const manual_html = UNFETCHABLE.map(
      (c) => `<li><strong>${c.label}</strong></li>`
    ).join("");
    const { subject, html } = await loadAndRender("holiday_import_reminder", {
      year: String(nextYear),
      count: String(inserted),
      breakdown_html,
      manual_html,
      app_url: appUrl,
    });
    const recipients = await resolveEffectiveRecipients(
      admin,
      "holiday_import_reminder"
    );
    const result = await sendEmail({ to: recipients, subject, html });

    if (!result.success) {
      console.error("Holiday reminder email failed:", result.error);
      return NextResponse.json(
        { success: false, year: nextYear, inserted, perCountry, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, year: nextYear, inserted, perCountry, messageId: result.messageId });
  } catch (error) {
    console.error("Holiday reminder error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Holiday reminder failed" },
      { status: 500 }
    );
  }
}
