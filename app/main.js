// Atelier DTG — application Windows (version de test 0.1)
// Agence Rémi Thollet Architecte
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

app.setPath("userData", path.join(app.getPath("appData"), "Atelier DTG"));   // dossier des données conservé d'une version à l'autre
const USER = app.getPath("userData");
const STORE_FILE = path.join(USER, "atelier-store.json");
const CFG_FILE = path.join(USER, "parametres.json");
let win = null, settingsWin = null, pendingOpen = [], pageReady = false;

/* ---------- paramètres ---------- */
const DEFAULTS = { dropboxRoot: path.join(os.homedir(), "T&K Dropbox"), model: "claude-sonnet-5-5", ragicHost: "eu2.ragic.com", ragicAp: "agoa", ragicSheet: "/agoa/3", anthropicKey: "", ragicKey: "", lastPaths: {}, googleClientId: "", googleClientSecret: "", googleDomain: "", google: null };
function enc(s) { if (!s) return ""; try { return safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(s).toString("base64") : s; } catch { return s; } }
function dec(s) { if (!s) return ""; if (!String(s).startsWith("enc:")) return s; try { return safeStorage.decryptString(Buffer.from(s.slice(4), "base64")); } catch { return ""; } }
const cleanHost = h => String(h || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "eu2.ragic.com";
function loadCfg() { let c = {}; try { c = JSON.parse(fs.readFileSync(CFG_FILE, "utf8")); } catch {} c = { ...DEFAULTS, ...c }; if (!c.ragicHost || c.ragicHost === "www.ragic.com") c.ragicHost = "eu2.ragic.com"; c.ragicHost = cleanHost(c.ragicHost); c.anthropicKey = dec(c.anthropicKey); c.ragicKey = dec(c.ragicKey); c.googleClientSecret = dec(c.googleClientSecret); if (c.google) c.google = { ...c.google, refresh: dec(c.google.refresh) }; return c; }
function saveCfg(c) { const o = { ...c, anthropicKey: enc(c.anthropicKey), ragicKey: enc(c.ragicKey), googleClientSecret: enc(c.googleClientSecret), google: c.google ? { email: c.google.email, name: c.google.name, refresh: enc(c.google.refresh) } : null }; fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(o, null, 2)); }
let cfg = loadCfg();

/* ---------- fenêtre ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1100, minHeight: 700, title: "AGOA DTG " + app.getVersion(), show: false, icon: path.join(__dirname, "build", "app.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: false, nodeIntegration: false, sandbox: false, spellcheck: true }
  });
  win.webContents.session.setSpellCheckerLanguages(["fr"]);
  pageReady = false; win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.on("did-finish-load", () => { if (win && !win.isVisible()) { win.show(); } closeSplash(); pageReady = true; flushOpen(); if (!cfg.anthropicKey || !fs.existsSync(cfg.dropboxRoot)) openSettings(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  buildMenu();
}
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width: 640, height: 640, parent: win || undefined, modal: false, title: "Paramètres — AGOA DTG", icon: path.join(__dirname, "build", "app.ico"), webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: false, nodeIntegration: false, sandbox: false } });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; });
}
function buildMenu() {
  const tpl = [
    { label: "Fichier", submenu: [
      { label: "Ouvrir un fichier .dtg…", accelerator: "CmdOrCtrl+O", click: async () => { const r = await dialog.showOpenDialog(win, { filters: [{ name: "Dossier DTG", extensions: ["dtg"] }], properties: ["openFile"], defaultPath: cfg.dropboxRoot }); if (!r.canceled && r.filePaths[0]) queueOpen(r.filePaths[0]); } },
      { label: "Enregistrer le dossier (.dtg)", accelerator: "CmdOrCtrl+S", click: () => win && win.webContents.executeJavaScript("window.dtgSaveCurrent && window.dtgSaveCurrent()") },
      { type: "separator" },
      { label: "Paramètres…", accelerator: "CmdOrCtrl+,", click: openSettings },
      { type: "separator" },
      { role: "quit", label: "Quitter" }
    ] },
    { label: "Édition", submenu: [{ role: "undo", label: "Annuler" }, { role: "redo", label: "Rétablir" }, { type: "separator" }, { role: "cut", label: "Couper" }, { role: "copy", label: "Copier" }, { role: "paste", label: "Coller" }, { role: "selectAll", label: "Tout sélectionner" }] },
    { label: "Affichage", submenu: [{ role: "reload", label: "Recharger" }, { role: "zoomIn", label: "Zoom +" }, { role: "zoomOut", label: "Zoom −" }, { role: "resetZoom", label: "Taille normale" }, { type: "separator" }, { role: "toggleDevTools", label: "Outils de développement" }] },
    { label: "Aide", submenu: [{ label: "AGOA DTG v" + app.getVersion(), enabled: false }, { label: cfg.google ? "Connecté : " + cfg.google.email : "Non connecté à Google", enabled: false }, { label: "Changer de compte Google…", click: googleSignOut }, { type: "separator" }, { label: "Dossier des données de l'application", click: () => shell.openPath(USER) }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------- ouverture des fichiers .dtg (double-clic) ---------- */
function dtgArg(argv) { return (argv || []).find(a => /\.dtg$/i.test(a) && fs.existsSync(a)); }
function queueOpen(p) { pendingOpen.push(p); flushOpen(); }
function flushOpen() {
  if (!win || !pageReady) return;
  while (pendingOpen.length) {
    const p = pendingOpen.shift();
    try { const buf = fs.readFileSync(p); win.webContents.send("open-dtg", { name: path.basename(p), path: p, buf }); }
    catch (e) { dialog.showErrorBox("AGOA DTG", "Impossible d'ouvrir " + p + "\n" + e.message); }
  }
}
function rememberPath(ref, p) { cfg.lastPaths = cfg.lastPaths || {}; cfg.lastPaths[ref.toUpperCase()] = p; saveCfg(cfg); }

/* ---------- identification Google + Google Agenda ---------- */
const G = require("./google");
function googleClient() {
  let f = {}; try { f = JSON.parse(fs.readFileSync(path.join(__dirname, "google-client.json"), "utf8")); } catch {}
  let pg = {}; try { pg = (JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).agoa || {}).google || {}; } catch {}   // même convention que les autres applications AGOA
  return { clientId: cfg.googleClientId || f.clientId || pg.clientId || "", clientSecret: cfg.googleClientSecret || f.clientSecret || pg.clientSecret || "", domain: (cfg.googleDomain || "").replace(/^@/, ""), allowed: Array.isArray(pg.allowed) ? pg.allowed : [] };
}
const googleSigned = () => { const c = googleClient(); return !!(cfg.google && cfg.google.email && cfg.google.refresh && G.emailAllowed(cfg.google.email, c.allowed, c.domain)); };
let loginWin = null, loginDone = null;
let gSess = null;   // jeton d'accès en mémoire
function showLogin() {
  return new Promise(resolve => {
    loginDone = resolve;
    loginWin = new BrowserWindow({ width: 520, height: 400, frame: false, resizable: false, center: true, show: false, title: "Connexion — AGOA DTG", icon: path.join(__dirname, "build", "app.ico"), backgroundColor: "#ffffff", webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    loginWin.loadFile(path.join(__dirname, "login.html"));
    loginWin.once("ready-to-show", () => loginWin.show());
    loginWin.on("closed", () => { loginWin = null; if (loginDone) { const d = loginDone; loginDone = null; d(false); } });
  });
}
const googleConfigured = () => { const c = googleClient(); return !!(c.clientId && c.clientSecret); };   // un client « application de bureau » exige son code secret
ipcMain.handle("google:state", () => ({ configured: googleConfigured(), version: app.getVersion() }));
ipcMain.handle("google:settings", () => { openSettings(true); });
ipcMain.handle("google:skip", () => { if (googleConfigured()) return; if (loginDone) { const d = loginDone; loginDone = null; d("skip"); loginWin && loginWin.close(); } });
ipcMain.handle("google:login", async () => {
  const c = googleClient();
  try {
    const s = await G.login({ ...c, openUrl: u => shell.openExternal(u) });
    cfg.google = { email: s.email, name: s.name, refresh: s.refresh }; saveCfg(cfg); gSess = { access: s.access, expiry: s.expiry, refresh: s.refresh };
    if (loginDone) { const d = loginDone; loginDone = null; d(true); setTimeout(() => loginWin && loginWin.close(), 700); }
    return { ok: true, email: s.email };
  } catch (e) { return { ok: false, code: e.code, message: e.message }; }
});
async function googleCalendar(tool, input) {
  if (tool !== "list_events") throw { code: "tool_error", message: "Outil Google Agenda inconnu : " + tool };
  if (!googleSigned()) throw { code: "server_not_connected", message: "Connexion Google nécessaire (menu Aide › Changer de compte Google)." };
  const c = googleClient(); gSess = gSess || { refresh: cfg.google.refresh };
  try { return await G.listEvents(await G.accessToken(gSess, c), input); }
  catch (e) { if (e.code === "relogin") { gSess = null; throw { code: "server_not_connected", message: "Connexion Google expirée : menu Aide › Changer de compte Google." }; } throw { code: e.code || "tool_error", message: e.message }; }
}
function googleSignOut() { cfg.google = null; gSess = null; saveCfg(cfg); app.relaunch(); app.quit(); }

/* ---------- écran de démarrage + mise à jour automatique ---------- */
let splash = null, splashHidden = false;
const wait = ms => new Promise(r => setTimeout(r, ms));
function createSplash() {
  splash = new BrowserWindow({ width: 520, height: 330, frame: false, resizable: false, movable: true, show: false, center: true, alwaysOnTop: false, skipTaskbar: false, title: "AGOA DTG", icon: path.join(__dirname, "build", "app.ico"), backgroundColor: "#ffffff", webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
  splash.loadFile(path.join(__dirname, "splash.html"));
  splash.on("closed", () => { if (!win && !loginWin && !loginDone) app.quit(); });
  splash.webContents.on("did-finish-load", () => { splashSet({ version: app.getVersion(), text: "Recherche de mise à jour…" }); if (!splashHidden) splash.show(); });
}
function splashSet(o) { try { if (splash && !splash.isDestroyed()) splash.webContents.send("splash", o); } catch {} }
function closeSplash() { try { if (splash && !splash.isDestroyed()) splash.close(); } catch {} splash = null; }
// Vérifie les mises à jour (publiées dans les Releases GitHub). Renvoie true si une mise à jour est en cours d'installation.
function checkAndUpdate() {
  return new Promise(resolve => {
    let autoUpdater; try { autoUpdater = require("electron-updater").autoUpdater; } catch { return resolve(false); }
    autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = false; autoUpdater.logger = null;
    let done = false; const fin = v => { if (!done) { done = true; clearTimeout(to); resolve(v); } };
    let to = setTimeout(() => fin(false), 12000);                       // pas de réseau : on démarre quand même
    autoUpdater.on("update-available", i => { clearTimeout(to); splashSet({ text: "Mise à jour " + i.version + " : téléchargement…", pct: 0 }); });
    autoUpdater.on("download-progress", p => splashSet({ text: "Téléchargement de la mise à jour… " + Math.round(p.percent) + " %", pct: p.percent }));
    autoUpdater.on("update-not-available", () => fin(false));
    autoUpdater.on("error", () => fin(false));
    autoUpdater.on("update-downloaded", () => { splashSet({ text: "Installation de la mise à jour…", pct: 100 }); fin(true); setTimeout(() => autoUpdater.quitAndInstall(true, true), 900); });
    autoUpdater.checkForUpdates().catch(() => fin(false));
  });
}
async function startup() {
  createSplash(); const t0 = Date.now();
  let updating = false;
  if (app.isPackaged && !process.env.AGOA_NO_UPDATE) { try { updating = await checkAndUpdate(); } catch {} }
  if (updating) return;
  if (!googleSigned()) {
    splashSet({ text: "Identification…" }); splashHidden = true; if (splash && !splash.isDestroyed()) splash.hide();
    const ok = await showLogin();
    if (!ok) { closeSplash(); app.quit(); return; }
    splashHidden = false; if (splash && !splash.isDestroyed()) splash.show();
  }
  splashSet({ text: "Démarrage…", pct: 100 });
  await wait(Math.max(0, 1800 - (Date.now() - t0)));
  createWindow();
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", (e, argv) => { const f = dtgArg(argv); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } if (f) queueOpen(f); });
  app.whenReady().then(() => { const f = dtgArg(process.argv); if (f) pendingOpen.push(f); startup(); });
  app.on("window-all-closed", () => { if (!splash && !loginWin) app.quit(); });
}

/* ---------- utilitaires ---------- */
const ok = v => ({ ok: true, value: v });
const ko = (code, message) => ({ ok: false, error: { code, message: String(message || code) } });
function wrap(fn) { return async (e, arg) => { try { return ok(await fn(arg)); } catch (err) { return ko(err && err.code || "error", err && err.message || err); } }; }
function toLocal(p) { const fq = String(p || "").replace(/^ns:\d+\/\//, "/"); return path.join(cfg.dropboxRoot, ...fq.split("/").filter(Boolean)); }
function toFq(local) { return "/" + path.relative(cfg.dropboxRoot, local).split(path.sep).join("/"); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function entry(local, st) {
  st = st || fs.statSync(local); const fq = toFq(local); const dir = st.isDirectory();
  return { name: path.basename(local), title: path.basename(local), object_type: dir ? "folder" : "file", path: fq, path_display: fq, id: fq, file_id: fq, size: dir ? undefined : st.size, file: dir ? undefined : { size: st.size }, folder: dir ? {} : undefined };
}

ipcMain.on("app:version", e => { e.returnValue = app.getVersion(); });
/* ---------- stockage local (remplace la base claude.ai) ---------- */
ipcMain.handle("store:load", wrap(async () => { try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); } catch { return {}; } }));
ipcMain.handle("store:save", wrap(async (data) => { fs.mkdirSync(USER, { recursive: true }); const tmp = STORE_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, STORE_FILE); return true; }));

/* ---------- paramètres ---------- */
ipcMain.handle("cfg:get", wrap(async () => ({ ...cfg, anthropicKey: cfg.anthropicKey ? "••••" + cfg.anthropicKey.slice(-4) : "", ragicKey: cfg.ragicKey ? "••••" + cfg.ragicKey.slice(-4) : "", googleClientSecret: cfg.googleClientSecret ? "••••" + cfg.googleClientSecret.slice(-4) : "", google: cfg.google ? { email: cfg.google.email, name: cfg.google.name } : null, dropboxExists: fs.existsSync(cfg.dropboxRoot) })));
ipcMain.handle("cfg:set", wrap(async (c) => { if (c.googleClientSecret && !c.googleClientSecret.startsWith("••••")) cfg.googleClientSecret = c.googleClientSecret.trim(); for (const k of ["dropboxRoot", "model", "ragicHost", "ragicAp", "ragicSheet", "googleClientId", "googleDomain"]) if (c[k] !== undefined) cfg[k] = k === "ragicHost" ? cleanHost(c[k]) : (typeof c[k] === "string" ? c[k].trim() : c[k]); if (c.anthropicKey && !c.anthropicKey.startsWith("••••")) cfg.anthropicKey = c.anthropicKey.trim(); if (c.ragicKey && !c.ragicKey.startsWith("••••")) cfg.ragicKey = c.ragicKey.trim(); saveCfg(cfg); return true; }));
ipcMain.handle("cfg:pickDropbox", wrap(async () => { const r = await dialog.showOpenDialog(settingsWin || win, { properties: ["openDirectory"], defaultPath: cfg.dropboxRoot, title: "Dossier racine de la Dropbox (celui qui contient « Agence T&K »)" }); return r.canceled ? null : r.filePaths[0]; }));
ipcMain.handle("cfg:testAI", wrap(async () => { const t = await aiComplete({ prompt: "Réponds simplement : OK", maxTokens: 20 }); return t; }));
ipcMain.handle("app:openSettings", wrap(async () => { openSettings(); return true; }));
ipcMain.handle("google:info", wrap(async () => ({ configured: googleConfigured(), signed: googleSigned(), email: (cfg.google && cfg.google.email) || "" })));
ipcMain.handle("google:switch", wrap(async () => { googleSignOut(); return true; }));

/* ---------- fichiers ---------- */
ipcMain.handle("dtg:remember", wrap(async ({ ref, path: p }) => { if (ref && p) rememberPath(String(ref), p); return true; }));
ipcMain.handle("file:readDropbox", wrap(async (p) => fs.readFileSync(toLocal(p))));
ipcMain.handle("file:saveAs", wrap(async ({ filename, buf }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), filename) });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, Buffer.from(buf)); shell.showItemInFolder(r.filePath); return r.filePath;
}));
ipcMain.handle("dtg:save", wrap(async ({ fname, buf, opDisplay }) => {
  const ref = path.basename(fname, ".dtg").toUpperCase();
  let target = cfg.lastPaths && cfg.lastPaths[ref];
  if (!target || !fs.existsSync(path.dirname(target))) {
    let dir = opDisplay ? toLocal(opDisplay) : cfg.dropboxRoot; const etude = fs.existsSync(dir) ? fs.readdirSync(dir).find(n => /ETUDE/i.test(n) && isDir(path.join(dir, n))) : null; if (etude) dir = path.join(dir, etude);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(fs.existsSync(dir) ? dir : app.getPath("documents"), fname), filters: [{ name: "Dossier DTG", extensions: ["dtg"] }] });
    if (r.canceled || !r.filePath) return null; target = r.filePath;
  }
  if (fs.existsSync(target)) { try { fs.copyFileSync(target, target + ".bak"); } catch {} }
  fs.writeFileSync(target, Buffer.from(buf)); rememberPath(ref, target);
  return { path: target };
}));

/* ---------- connecteurs : Dropbox (dossier synchronisé local), Ragic (API) ---------- */
function walk(dir, recursive, out, max) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    if (out.length >= max) return; if (d.name.startsWith(".") || d.name === "desktop.ini") continue;
    const p = path.join(dir, d.name); let st; try { st = fs.statSync(p); } catch { continue; }
    out.push(entry(p, st)); if (recursive && st.isDirectory()) walk(p, true, out, max);
  }
}
async function dbx(tool, input) {
  if (!fs.existsSync(cfg.dropboxRoot)) throw { code: "server_not_connected", message: "Dossier Dropbox introuvable : " + cfg.dropboxRoot + " (menu Fichier > Paramètres)" };
  if (tool === "search") {
    const q = String(input.query || "").trim(); const results = [];
    const ops = path.join(cfg.dropboxRoot, "Agence T&K", "01-OPERATIONS");
    if (isDir(ops)) for (const L of fs.readdirSync(ops)) { const d = path.join(ops, L); if (!isDir(d)) continue; for (const n of fs.readdirSync(d)) if (n.toUpperCase() === q.toUpperCase() && isDir(path.join(d, n))) results.push(entry(path.join(d, n))); }
    if (/DTG-REF/i.test(q)) { const f = path.join(cfg.dropboxRoot, "Agence T&K", "09 - BDD", "DTG", "REF txt", "DTG-REF.docx"); if (fs.existsSync(f)) results.push(entry(f)); }
    return { results };
  }
  if (tool === "list_folder") {
    const out = []; walk(toLocal(input.path), !!input.recursive, out, 20000);
    const types = input.object_types; const entries = types && types.length ? out.filter(e => types.includes(e.object_type)) : out;
    return { entries, has_more: false, cursor: "" };
  }
  if (tool === "fetch") {
    const p = toLocal(input.id); const ext = path.extname(p).toLowerCase(); let text = "";
    if (ext === ".txt" || ext === ".md" || ext === ".csv") text = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
    else if (ext === ".docx") text = (await require("mammoth").extractRawText({ path: p })).value;
    else if (ext === ".pdf") text = (await require("pdf-parse")(fs.readFileSync(p))).text;
    else throw { code: "tool_error", message: "Type de fichier non lisible : " + ext };
    return { id: input.id, title: path.basename(p), text };
  }
  throw { code: "tool_error", message: "Outil Dropbox inconnu : " + tool };
}
async function ragic(tool, input) {
  if (!cfg.ragicKey) throw { code: "server_not_connected", message: "Clé API Ragic absente (menu Fichier > Paramètres)" };
  const H = { Authorization: "Basic " + cfg.ragicKey };
  const rf = async url => { let r; try { r = await fetch(url, { headers: H }); } catch (e) { throw { code: "tool_error", message: "Ragic injoignable (" + cfg.ragicHost + ") : " + (e.cause?.code || e.message) }; } if (r.status === 401 || r.status === 403) throw { code: "tool_error", message: "Ragic a refusé la clé API (" + r.status + ") : vérifiez la clé dans Fichier > Paramètres." }; if (!r.ok) throw { code: "tool_error", message: "Ragic " + r.status + " sur " + cfg.ragicHost + " : vérifiez le serveur (eu2.ragic.com)." }; const j = await r.json(); if (j && j.status === "ERROR") throw { code: "tool_error", message: "Ragic : " + (j.msg || "erreur") }; return j; };
  const ap = input.apname || cfg.ragicAp;
  if (tool === "full_text_search") {
    const url = `https://${cfg.ragicHost}/${ap}${cfg.ragicSheet}?api&v=3&limit=20&fts=${encodeURIComponent(input.query || "")}`;
    const j = await rf(url);
    return { hits: Object.entries(j || {}).filter(([k]) => /^\d+$/.test(k)).map(([id, rec]) => ({ apname: ap, sheet_id: cfg.ragicSheet, record_id: +id, sheet_display_name: "Immeubles", entry_name: rec.code || rec._index_title_ || "", record_url: `/${ap}${cfg.ragicSheet}/${id}` })) };
  }
  if (tool === "get_records") {
    const url = `https://${cfg.ragicHost}/${ap}${input.sheet_id}/${input.record_id}?api&v=3`;
    let j = await rf(url); const rec = j && j[String(input.record_id)] ? j[String(input.record_id)] : j;
    return { records: [{ record_id: input.record_id, record: rec }] };
  }
  throw { code: "tool_error", message: "Outil Ragic inconnu : " + tool };
}
ipcMain.handle("mcp:call", wrap(async ({ server, tool, input }) => {
  if (server === "Dropbox") return dbx(tool, input || {});
  if (server === "Ragic") return ragic(tool, input || {});
  if (server === "Google Calendar") return googleCalendar(tool, input || {});
  throw { code: "server_not_connected", message: "Connecteur inconnu : " + server };
}));

/* ---------- IA (API Anthropic) ---------- */
async function aiComplete({ prompt, json, maxTokens }) {
  if (!cfg.anthropicKey) throw { code: "not_granted", message: "Clé API Anthropic absente (menu Fichier > Paramètres)" };
  const body = { model: cfg.model || DEFAULTS.model, max_tokens: maxTokens || 4096, messages: [{ role: "user", content: prompt }] };
  if (json) body.system = "Réponds uniquement avec un objet JSON valide, sans texte autour et sans balises de code.";
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw { code: r.status === 429 ? "rate_limited" : (r.status === 401 || r.status === 403) ? "not_granted" : r.status === 413 ? "prompt_too_large" : "api_error", message: "API Anthropic " + r.status + " : " + t.slice(0, 300) }; }
  const d = await r.json(); return (d.content || []).filter(c => c.type === "text").map(c => c.text).join("");
}
ipcMain.handle("ai:complete", wrap(aiComplete));
