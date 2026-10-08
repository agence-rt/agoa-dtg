// Identification Google (OAuth 2.0 « application de bureau », PKCE + redirection locale) et lecture de Google Agenda.
const http = require("http");
const crypto = require("crypto");

const AUTH_URL = process.env.AGOA_GOOGLE_AUTH || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.AGOA_GOOGLE_TOKEN || "https://oauth2.googleapis.com/token";
const API = process.env.AGOA_GOOGLE_API || "https://www.googleapis.com";
const SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly";
const b64u = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fail = (code, message) => Object.assign(new Error(message), { code, message });

function idClaims(idt) { try { return JSON.parse(Buffer.from(idt.split(".")[1], "base64").toString("utf8")); } catch { return {}; } }
const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");
// Comptes autorisés : liste d'empreintes SHA-256 d'adresses e-mail (même convention que les autres applications AGOA) ; à défaut, un domaine.
const emailAllowed = (email, allowed, domain) => { const e = String(email || "").trim().toLowerCase(); if (allowed && allowed.length) return allowed.includes(sha256(e)); return !domain || e.endsWith("@" + domain); };
const domainOk = (claims, allowed, domain) => claims.email_verified !== false && emailAllowed(claims.email, allowed, domain);

async function tokenCall(params) {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(j.error === "invalid_grant" ? "relogin" : "google_error", j.error_description || j.error || ("Google " + r.status));
  return j;
}

// Ouvre le navigateur, attend le retour sur 127.0.0.1, échange le code. Renvoie { email, name, refresh, access, expiry }.
async function login({ clientId, clientSecret, domain, allowed, openUrl, timeoutMs = 5 * 60 * 1000 }) {
  if (!clientId) throw fail("no_client", "Client OAuth Google non configuré.");
  const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash("sha256").update(verifier).digest()), state = b64u(crypto.randomBytes(16));
  let server; const codeP = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/") { res.writeHead(404).end(); return; }
      const err = u.searchParams.get("error"), code = u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>AGOA DTG</title><body style="font:16px Segoe UI,sans-serif;text-align:center;margin-top:18vh;color:#333"><h2 style="color:#b3261e">AGOA DTG</h2><p>${err || !code ? "Connexion annulée." : "Connexion réussie. Vous pouvez fermer cette fenêtre et revenir à l'application."}</p></body>`);
      if (u.searchParams.get("state") !== state) return reject(fail("google_error", "Réponse Google invalide."));
      if (err || !code) return reject(fail("cancelled", "Connexion annulée."));
      resolve(code);
    });
    server.on("error", reject);
    setTimeout(() => reject(fail("timeout", "Délai dépassé : la connexion n'a pas abouti.")), timeoutMs).unref?.();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const redirect = "http://127.0.0.1:" + server.address().port + "/";
  try {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPES, code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "select_account consent" });
    if (!(allowed && allowed.length) && domain) q.set("hd", domain);
    await openUrl(AUTH_URL + "?" + q);
    const code = await codeP;
    const t = await tokenCall({ code, client_id: clientId, client_secret: clientSecret || "", redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier });
    const c = idClaims(t.id_token || "");
    if (!c.email) throw fail("google_error", "Google n'a pas fourni l'adresse e-mail.");
    if (!domainOk(c, allowed, domain)) throw fail("domain", "Ce compte (" + c.email + ") n'est pas autorisé à utiliser cette application.");
    if (!t.refresh_token) throw fail("google_error", "Google n'a pas fourni d'autorisation durable : réessayez.");
    return { email: c.email, name: c.name || c.email, refresh: t.refresh_token, access: t.access_token, expiry: Date.now() + (t.expires_in || 3600) * 1000 - 60000 };
  } finally { try { server.close(); } catch {} }
}

// Jeton d'accès valide (renouvelé à partir du jeton durable).
async function accessToken(sess, { clientId, clientSecret }) {
  if (sess.access && sess.expiry > Date.now()) return sess.access;
  if (!sess.refresh) throw fail("relogin", "Reconnexion Google nécessaire.");
  const t = await tokenCall({ client_id: clientId, client_secret: clientSecret || "", refresh_token: sess.refresh, grant_type: "refresh_token" });
  sess.access = t.access_token; sess.expiry = Date.now() + (t.expires_in || 3600) * 1000 - 60000; return sess.access;
}

// Même forme de réponse que le connecteur « Google Calendar › list_events » utilisé par l'atelier en ligne.
async function listEvents(token, input) {
  const p = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  if (input.fullText) p.set("q", input.fullText);
  if (input.startTime) p.set("timeMin", input.startTime);
  if (input.endTime) p.set("timeMax", input.endTime);
  const r = await fetch(API + "/calendar/v3/calendars/primary/events?" + p, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw fail("relogin", "Reconnexion Google nécessaire.");
  if (!r.ok) throw fail("tool_error", "Google Agenda : " + (j.error?.message || r.status));
  let ev = j.items || [];
  if (input.orderBy === "startTimeDesc") ev = ev.reverse();
  return { events: ev.slice(0, input.pageSize || 25) };
}

module.exports = { login, accessToken, listEvents, domainOk, emailAllowed, idClaims };
