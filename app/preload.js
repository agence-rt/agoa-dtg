// Pont entre l'interface de l'atelier et l'application Windows.
// Reproduit les capacités utilisées par l'atelier sur claude.ai (db, sample, mcp, downloads)
// avec un stockage local, la Dropbox synchronisée, l'API Ragic et l'API Anthropic.
const { ipcRenderer } = require("electron");

async function call(ch, arg) {
  const r = await ipcRenderer.invoke(ch, arg);
  if (r && r.ok) return r.value;
  const e = (r && r.error) || { code: "error", message: "Erreur" };
  throw Object.assign(new Error(e.message), { code: e.code });
}
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

/* ---------- base locale (même interface que la base claude.ai) ---------- */
let STORE = {};
const ready = call("store:load").then(s => { STORE = s || {}; }).catch(() => { STORE = {}; });
let saveT = null;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => call("store:save", STORE).catch(err => console.error("Sauvegarde locale impossible", err)), 300); }
window.addEventListener("beforeunload", () => { if (saveT) { clearTimeout(saveT); ipcRenderer.invoke("store:save", STORE); } });
function snap(p) { const has = Object.prototype.hasOwnProperty.call(STORE, p); return { id: p.split("/").pop(), exists: has, data: () => (has ? clone(STORE[p]) : undefined), metadata: {} }; }
function docRef(p) {
  return {
    id: p.split("/").pop(), path: p,
    get: async () => { await ready; return snap(p); },
    set: async d => { await ready; STORE[p] = clone(d); persist(); },
    update: async d => { await ready; STORE[p] = { ...(STORE[p] || {}), ...clone(d) }; persist(); },
    delete: async () => { await ready; delete STORE[p]; persist(); },
    collection: c => colRef(p + "/" + c)
  };
}
function colRef(p) {
  let order = null, lim = null;
  const q = {
    orderBy: (f, dir) => { order = [f, dir]; return q; }, limit: n => { lim = n; return q; }, where: () => q,
    doc: id => docRef(p + "/" + id),
    get: async () => {
      await ready;
      let docs = Object.keys(STORE).filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")).map(snap);
      if (order) docs.sort((a, b) => { const x = (a.data() || {})[order[0]] || 0, y = (b.data() || {})[order[0]] || 0; return order[1] === "desc" ? y - x : x - y; });
      if (lim) docs = docs.slice(0, lim);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] };
    }
  };
  return q;
}
const db = { doc: docRef, collection: colRef };

/* ---------- IA ---------- */
const sample = async (prompt, opts = {}) => {
  if (opts.signal && opts.signal.aborted) throw Object.assign(new Error("Interrompu"), { code: "cancelled" });
  const text = await call("ai:complete", { prompt, maxTokens: opts.maxTokens || 4096 });
  if (opts.signal && opts.signal.aborted) throw Object.assign(new Error("Interrompu"), { code: "cancelled" });
  if (opts.onText) opts.onText({ text, delta: text });
  return { text };
};
sample.json = async (prompt, opts = {}) => {
  const t = await call("ai:complete", { prompt, json: true, maxTokens: opts.maxTokens || 8000 });
  const s = String(t).replace(/```json|```/g, "").trim(); const i = s.indexOf("{"), j = s.lastIndexOf("}");
  try { return JSON.parse(s.slice(i, j + 1)); } catch { throw Object.assign(new Error("Réponse IA illisible"), { code: "invalid_json" }); }
};
sample.limits = async () => ({});

/* ---------- connecteurs ---------- */
const mcp = { callTool: async (server, tool, input) => ({ payload: await call("mcp:call", { server, tool, input }) }) };

/* ---------- téléchargements ---------- */
const downloads = {
  save: async ({ filename, data }) => {
    const buf = new Uint8Array(await data.arrayBuffer());
    const p = await call("file:saveAs", { filename, buf });
    if (!p) throw Object.assign(new Error("Annulé"), { code: "cancelled" });
    return { status: "saved", path: p };
  }
};

const CAPS = { db, sample, mcp, downloads };
window.claude = { use: async n => CAPS[n] || null };
window.dtgDesktop = {
  isDesktop: true,
  version: (() => { try { return ipcRenderer.sendSync("app:version"); } catch { return ""; } })(),
  readFile: p => call("file:readDropbox", p),
  saveDtg: (fname, buf, opDisplay) => call("dtg:save", { fname, buf, opDisplay }),
  cfgGet: () => call("cfg:get"), cfgSet: c => call("cfg:set", c), pickDropbox: () => call("cfg:pickDropbox"), testAI: () => call("cfg:testAI")
};

/* ---------- ouverture d'un .dtg par double-clic ---------- */
ipcRenderer.on("open-dtg", async (e, { name, buf, path }) => {
  for (let i = 0; i < 100 && !window.dtgImportBuffer; i++) await new Promise(r => setTimeout(r, 100));
  await ready;
  if (window.dtgImportBuffer) { const ref = await window.dtgImportBuffer(new Uint8Array(buf).buffer, name); if (ref) call("dtg:remember", { ref, path }).catch(() => {}); }
});
