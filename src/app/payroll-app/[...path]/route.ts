import { readFile } from "fs/promises";
import path from "path";
import { requireRole } from "@/lib/auth/helpers";

// The Trinity PH payroll app (src/payroll-app), shown inside /admin/payroll.
// Served from here rather than public/ so only hr_admin and up can load it.
// Its data stays in the admin's browser (localStorage), as it did on the
// standalone payroll site.
const FILES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "data.js": "text/javascript; charset=utf-8",
  "engine.js": "text/javascript; charset=utf-8",
  "hr201.js": "text/javascript; charset=utf-8",
  "masterlist.js": "text/javascript; charset=utf-8",
  "template.js": "text/javascript; charset=utf-8",
  "xlsx.js": "text/javascript; charset=utf-8",
  "vendor/xlsx.full.min.js": "text/javascript; charset=utf-8",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  await requireRole("hr_admin");
  const name = (await params).path.join("/");
  const type = FILES[name];
  if (!type) return new Response("Not found", { status: 404 });

  const body = await readFile(path.join(process.cwd(), "src/payroll-app", name));
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, no-cache",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
