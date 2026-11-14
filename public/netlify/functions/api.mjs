import { getStore } from "@netlify/blobs";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export default async (req) => {
  const store = getStore("band-scheduler");
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const key = Netlify.env.get("ADMIN_PASSWORD");
  const isAdmin = () => !!key && req.headers.get("x-admin-key") === key;
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  const getOptions = async () => (await store.get("options", { type: "json" })) || [];

  // GET /api/state
  if (req.method === "GET" && path === "state") {
    const options = await getOptions();
    const { blobs } = await store.list({ prefix: "votes/" });
    const votes = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
    return json({ options, votes });
  }

  // POST /api/admin  (password check)
  if (req.method === "POST" && path === "admin") {
    if (!key) return json({ error: "ADMIN_PASSWORD is not set in Netlify." }, 500);
    return isAdmin() ? json({ ok: true }) : json({ error: "Wrong password" }, 401);
  }

  // POST /api/vote {name, optionId, value: "y" | "n" | null}
  if (req.method === "POST" && path === "vote") {
    const { name, optionId, value } = await body();
    const clean = String(name || "").trim().slice(0, 40);
    if (!clean || !slug(clean)) return json({ error: "Name required" }, 400);
    const options = await getOptions();
    if (!options.some((o) => o.id === optionId)) return json({ error: "Unknown option" }, 400);
    if (value !== "y" && value !== "n" && value !== null) return json({ error: "Bad value" }, 400);
    const k = "votes/" + slug(clean);
    const cur = (await store.get(k, { type: "json" })) || { name: clean, v: {} };
    cur.name = clean;
    if (value === null) delete cur.v[optionId]; else cur.v[optionId] = value;
    await store.setJSON(k, cur);
    return json({ ok: true });
  }

  // POST /api/option {date, time, hours}  (admin)
  if (req.method === "POST" && path === "option") {
    if (!isAdmin()) return json({ error: "Organizer only" }, 401);
    const b = await body();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || !/^\d{2}:\d{2}$/.test(b.time || ""))
      return json({ error: "Bad date or time" }, 400);
    const options = await getOptions();
    options.push({
      id: "o" + Date.now().toString(36),
      date: b.date,
      time: b.time,
      hours: Math.min(Math.max(+b.hours || 3, 0.5), 12),
      label: String(b.label || "").slice(0, 80),
    });
    await store.setJSON("options", options);
    return json({ ok: true });
  }

  // DELETE /api/option/<id>  (admin)
  if (req.method === "DELETE" && path.startsWith("option/")) {
    if (!isAdmin()) return json({ error: "Organizer only" }, 401);
    const id = path.slice(7);
    await store.setJSON("options", (await getOptions()).filter((o) => o.id !== id));
    return json({ ok: true });
  }

  // DELETE /api/voter/<slug>  (admin)
  if (req.method === "DELETE" && path.startsWith("voter/")) {
    if (!isAdmin()) return json({ error: "Organizer only" }, 401);
    await store.delete("votes/" + slug(path.slice(6)));
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/*" };
