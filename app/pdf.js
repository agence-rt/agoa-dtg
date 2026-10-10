// Génère un vrai PDF (texte vectoriel, polices nettes) à partir des pages HTML de l'atelier, via Chromium (printToPDF).
const { BrowserWindow } = require("electron");
const fs = require("fs"), os = require("os"), path = require("path");

async function renderPdf(html) {
  const tmp = path.join(os.tmpdir(), "agoa-dtg-" + process.pid + "-" + Date.now() + ".html");
  fs.writeFileSync(tmp, html, "utf8");
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, backgroundThrottling: false } });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript("Promise.all([...document.images].map(i => i.decode ? i.decode().catch(() => {}) : 0))").catch(() => {});
    return await w.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
  } finally { try { w.destroy(); } catch {} try { fs.unlinkSync(tmp); } catch {} }
}
module.exports = { renderPdf };
