// Reconnaissance vocale locale (Whisper via whisper.cpp) — aucun envoi de l'audio sur Internet.
// Le moteur (whisper-cli.exe + DLL) est embarqué dans l'installateur ; le modèle de langue est téléchargé une seule fois.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MODEL_FILE = "ggml-small-q5_1.bin";
const MODEL_URL = process.env.AGOA_STT_MODEL_URL || ("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/" + MODEL_FILE);   // variable : essais uniquement
const MODEL_MIN = +process.env.AGOA_STT_MODEL_MIN || 120 * 1024 * 1024;   // en dessous : fichier incomplet
// Vocabulaire de l'agence : aide le moteur à bien écrire les termes du bâtiment
const GLOSSARY = "Diagnostic technique global, copropriété, syndic, façade sur rue, façade sur cour, pignon, toiture zinc, brisis, terrasson, lucarne, souche de cheminée, descente d'eaux pluviales, chéneau, gouttière, étanchéité, relevé d'étanchéité, ravalement, enduit plâtre et chaux, fissure, micro-fissure, efflorescence, salpêtre, remontées capillaires, cage d'escalier, palier, garde-corps, fenêtres bois, menuiseries, volets, ventilation mécanique contrôlée, chaudière collective, colonne montante, compteur, réseau d'eau, tout-à-l'égout, DTG, PPPT.";

function baseDirs(app) {
  const dev = path.join(__dirname, "whisper-bin");
  const packed = app.isPackaged ? path.join(process.resourcesPath, "whisper") : dev;
  return { exeDir: fs.existsSync(path.join(packed, "whisper-cli.exe")) ? packed : dev, modelDir: path.join(app.getPath("userData"), "models") };
}

function create(app) {
  const { exeDir, modelDir } = baseDirs(app);
  const exe = path.join(exeDir, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
  const modelPath = path.join(modelDir, MODEL_FILE);
  let dl = null;   // téléchargement en cours (promesse partagée)

  const engineOk = () => fs.existsSync(exe);
  const modelOk = () => { try { return fs.statSync(modelPath).size >= MODEL_MIN; } catch { return false; } };
  const status = () => ({ engine: engineOk(), model: modelOk(), modelName: MODEL_FILE, ready: engineOk() && modelOk() });

  async function download(onProgress) {
    if (modelOk()) return true;
    if (dl) return dl;
    dl = (async () => {
      fs.mkdirSync(modelDir, { recursive: true });
      const part = modelPath + ".part";
      const r = await fetch(MODEL_URL, { redirect: "follow" });
      if (!r.ok || !r.body) throw new Error("Téléchargement du modèle impossible (HTTP " + r.status + ") : vérifiez la connexion Internet.");
      const total = +r.headers.get("content-length") || 0; let got = 0, last = 0;
      const out = fs.createWriteStream(part);
      try {
        for await (const chunk of r.body) {
          if (!out.write(chunk)) await new Promise(res => out.once("drain", res));
          got += chunk.length; const now = Date.now();
          if (onProgress && now - last > 250) { last = now; onProgress({ got, total }); }
        }
        await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
      } catch (e) { try { out.destroy(); fs.unlinkSync(part); } catch {} throw new Error("Téléchargement interrompu : " + (e.message || e)); }
      if (fs.statSync(part).size < MODEL_MIN) { try { fs.unlinkSync(part); } catch {} throw new Error("Modèle téléchargé incomplet."); }
      fs.renameSync(part, modelPath);
      if (onProgress) onProgress({ got: total || got, total: total || got });
      return true;
    })().finally(() => { dl = null; });
    return dl;
  }

  function transcribe(wav, opts = {}) {   // wav : Buffer WAV 16 kHz mono 16 bits
    return new Promise((resolve, reject) => {
      if (!engineOk()) return reject(new Error("Moteur de reconnaissance vocale absent de cette installation."));
      if (!modelOk()) return reject(new Error("Modèle de reconnaissance vocale non téléchargé."));
      const base = path.join(os.tmpdir(), "agoa-dtg-stt-" + process.pid + "-" + Date.now());
      const wavPath = base + ".wav", txtPath = base + ".txt";
      try { fs.writeFileSync(wavPath, wav); } catch (e) { return reject(e); }
      const threads = Math.max(2, Math.min(8, (os.cpus() || []).length - 1));
      const args = ["-m", modelPath, "-f", wavPath, "-l", opts.language || "fr", "-nt", "-np", "-otxt", "-of", base, "-t", String(threads), "--prompt", opts.prompt || GLOSSARY];
      const p = spawn(exe, args, { cwd: exeDir, windowsHide: true });
      let err = ""; p.stderr.on("data", d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
      const timer = setTimeout(() => { try { p.kill(); } catch {} }, 10 * 60 * 1000);
      const clean = () => { for (const f of [wavPath, txtPath]) { try { fs.unlinkSync(f); } catch {} } };
      p.on("error", e => { clearTimeout(timer); clean(); reject(new Error("Lancement du moteur impossible : " + e.message)); });
      p.on("close", code => {
        clearTimeout(timer); let txt = "";
        try { txt = fs.readFileSync(txtPath, "utf8"); } catch {}
        clean();
        if (code !== 0 && !txt) return reject(new Error("Transcription échouée (code " + code + ") " + err.split(/\r?\n/).filter(Boolean).slice(-2).join(" ")));
        // retire les annotations de silence/bruit que Whisper invente parfois
        txt = txt.replace(/\[[^\]]*\]|\([^)]*musique[^)]*\)/gi, " ").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
        resolve(txt);
      });
    });
  }
  return { status, download, transcribe, paths: { exe, modelPath } };
}
module.exports = { create, MODEL_FILE, MODEL_URL, GLOSSARY };
