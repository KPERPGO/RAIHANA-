// Raihana ERP: the morning phone notification (Supabase Edge Function "daily-stock-push").
// Run src/supabase-push.sql first. Then paste this whole file in Supabase: Edge Functions > Deploy a new function >
// Via Editor, name it daily-stock-push, Deploy, and in the function's settings turn "Verify JWT" off
// (the daily schedule calls it without a sign-in; sending still needs the token only the database knows).
// It sends each phone that turned on notifications the stock list the app saved at its last use:
// what to order (owner and Stock staff only) and the batches to sell first.
// The keys for phone notifications are made here on the first run and kept in the table erp_push_keys,
// which no app user can read. Nobody has to copy or type a key.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function keys() {
  const got = await db.from("erp_push_keys").select("*").eq("id", 1).maybeSingle();
  if (got.error) throw got.error;
  if (got.data) return got.data;
  const k = webpush.generateVAPIDKeys(), token = crypto.randomUUID();
  // the project address is kept too, so the daily schedule in the database knows where to call
  const ins = await db.from("erp_push_keys").insert({ id: 1, public_key: k.publicKey, private_key: k.privateKey, token, url: Deno.env.get("SUPABASE_URL") }).select().single();
  if (ins.error) throw ins.error;
  return ins.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const k = await keys(), url = new URL(req.url);
    // the app asks for the public key when a phone turns notifications on (the public key is not a secret)
    if (url.searchParams.get("do") === "key") return json({ publicKey: k.public_key });
    const body = await req.json().catch(() => ({}));
    // "Send a test" in the app: only to that phone, and only if it is already registered
    const test = body.test === true && typeof body.endpoint === "string";
    // the daily send needs the token kept in erp_push_keys; the schedule in the database reads it from there
    if (!test && (!body.token || body.token !== k.token)) return json({ error: "not allowed" }, 403);
    if (!test && k.last_sent && Date.now() - Date.parse(k.last_sent) < 20 * 36e5) return json({ skipped: "already sent today" });
    const note = (await db.from("erp_docs").select("data").eq("path", "meta/pushnote").maybeSingle()).data?.data || {};
    const subs = (await db.from("erp_docs").select("path,data").like("path", "meta/pushsub-%")).data || [];
    webpush.setVapidDetails("https://kperpgo.github.io/RAIHANA-/", k.public_key, k.private_key);
    const today = new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10); // Baghdad time
    const old = note.date && note.date < today ? `List from ${note.date}, the last time the app was used.\n` : "";
    let sent = 0, gone = 0;
    for (const s of subs) {
      const d = s.data || {};
      if (d.off || !d.endpoint || !d.keys || (test && d.endpoint !== body.endpoint)) continue;
      const parts = [d.stock ? note.short : "", note.near].filter(Boolean);
      const msg = test ? "Test: phone notifications from Raihana work." : parts.length ? old + parts.join("\n") : "Nothing to order and nothing to sell first today.";
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: d.keys }, JSON.stringify({ title: note.title || "Raihana: today's stock list", body: msg }), { TTL: 12 * 3600 });
        sent++;
      } catch (e: any) {
        // the phone removed the app or turned notifications off: stop sending to it
        if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from("erp_docs").update({ data: { ...d, off: true } }).eq("path", s.path); gone++; }
      }
    }
    if (!test) await db.from("erp_push_keys").update({ last_sent: new Date().toISOString() }).eq("id", 1);
    return json({ sent, gone });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
