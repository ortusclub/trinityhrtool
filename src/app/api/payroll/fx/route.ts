import { NextResponse } from "next/server";
import { failed, payrollAdmin } from "../auth";

// GET ?base=USD&quote=PHP&date=YYYY-MM-DD → { rate, date }
// OANDA's currency-converter rate for that day: the average bid of the 24
// hours ending the day before, as the converter page shows it. A date not
// out yet (a future payout) takes today's.
const CUR = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const q = new URL(request.url).searchParams;
  const base = q.get("base") ?? "", quote = q.get("quote") ?? "";
  if (!CUR.test(base) || !CUR.test(quote)) return NextResponse.json({ error: "Unknown currency." }, { status: 400 });
  const today = ymd(new Date());
  let date = q.get("date") ?? today;
  if (!DATE.test(date)) return NextResponse.json({ error: "Unknown date." }, { status: 400 });
  if (date > today) date = today;
  const prev = ymd(new Date(Date.parse(date + "T00:00:00Z") - 86400000));
  try {
    const res = await fetch(
      "https://public-api.corporatefxservices.com/cc-api/currencies?base=" + base + "&quote=" + quote +
        "&data_type=general_currency_pair&start_date=" + prev + "&end_date=" + date,
      { headers: { "User-Agent": "TrinityHR payroll" }, cache: "no-store" },
    );
    const data = (await res.json()) as { response?: { average_bid?: string }[] };
    const rate = Number(data.response?.[0]?.average_bid);
    if (!res.ok || !(rate > 0)) return NextResponse.json({ error: "OANDA had no rate for " + date + "." }, { status: 502 });
    return NextResponse.json({ rate, date });
  } catch (e) {
    return failed(e);
  }
}
