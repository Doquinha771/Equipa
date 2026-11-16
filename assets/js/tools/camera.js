/* Equipa — câmera: identificar, retirar, receber, conferir carrinho e cadastrar.
 * Automático: QR Code do Equipa e códigos de barras (série/patrimônio).
 * Com um toque em "Ler texto": OCR do quadro marcado (número colado no
 * equipamento ou etiqueta embaixo do PC). O texto lido é interpretado para achar
 * número, modelo, série e patrimônio; tudo fica editável antes de salvar.
 * Nenhuma imagem é enviada ao servidor: o OCR roda no próprio navegador. */
"use strict";
const EquipaCamera = (() => {
  const TESS = {
    lib: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    lang: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"
  };
  const LAST_MODEL_KEY = "equipa-camera-model";
  let ocrWorker = null, ocrLoading = null, current = null;

  /* ---------- OCR ---------- */
  async function getOcr(onProgress) {
    if (ocrWorker) return ocrWorker;
    if (ocrLoading) return ocrLoading;
    ocrLoading = (async () => {
      await loadScriptOnce(TESS.lib, "Tesseract");
      const w = await window.Tesseract.createWorker("eng", 1, {
        workerPath: TESS.worker, corePath: TESS.core, langPath: TESS.lang,
        logger: m => { if (m.status && typeof m.progress === "number") onProgress?.(m); }
      });
      await w.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/:#.°º " });
      ocrWorker = w; return w;
    })().catch(e => { ocrLoading = null; throw e; });
    return ocrLoading;
  }
  /** Recorta o quadro guia, amplia e aumenta o contraste (texto pequeno de etiqueta). */
  function prepare(source, sw, sh, roi, invert = false) {
    const c = document.createElement("canvas");
    const rw = Math.round(sw * roi.w), rh = Math.round(sh * roi.h);
    const scale = Math.min(3, Math.max(1, 1400 / rw));
    c.width = Math.round(rw * scale); c.height = Math.round(rh * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, Math.round(sw * roi.x), Math.round(sh * roi.y), rw, rh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { const g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; d[i] = g; if (g < min) min = g; if (g > max) max = g; }
    const span = Math.max(40, max - min);
    for (let i = 0; i < d.length; i += 4) { let g = (d[i] - min) * 255 / span; g = g < 128 ? g * .6 : 255 - (255 - g) * .6; if (invert) g = 255 - g; d[i] = d[i + 1] = d[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* ---------- Interpretação do texto lido ---------- */
  const loose = s => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
  const BUILTIN = [
    [/CHROME\s?BOOK(?:\s+([A-Z]{0,3}\d{2,5}[A-Z]?))?/i, m => `Chromebook${m[1] ? ` ${m[1].toUpperCase()}` : ""}`, "chromebook"],
    [/THINK\s?PAD\s*([A-Z]{0,2}\s?\d{2,3}[A-Z]?(?:\s*GEN\s*\d)?)/i, m => `ThinkPad ${m[1].toUpperCase().replace(/\s+/g, " ")}`, "thinkpad_lenovo"],
    [/IDEA\s?PAD\s*([A-Z0-9 ]{1,12})?/i, m => `IdeaPad${m[1] ? ` ${clean(m[1])}` : ""}`, "thinkpad_lenovo"],
    [/GALAXY\s*TAB\s*([A-Z]\d{0,2}\s?(?:LITE|FE)?)/i, m => `Galaxy Tab ${clean(m[1]).toUpperCase()}`, "tablet"],
    [/POSITIVO\s+(MASTER|MOTION|DUO|STILO|VISION|BGH|TAB)\s*([A-Z]?\d{2,5}[A-Z]?)?/i, m => `Positivo ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}${m[2] ? ` ${m[2].toUpperCase()}` : ""}`, ""],
    [/\b(?:MODEL|MODELO|MOD|MTM|TYPE)\s*(?:NO|N[°º])?\s*[.:#]?\s*([A-Z0-9][A-Z0-9 .-]{2,22})/i, m => clean(m[1]).replace(/\s{2,}/g, " "), ""]
  ];
  function matchModel(text, models) {
    const lt = loose(text);
    let best = null;
    for (const mdl of models) {
      const parts = norm(mdl.name).toUpperCase().split(/[^A-Z0-9]+/).filter(p => p.length >= 2);
      if (!parts.length) continue;
      const hit = parts.filter(p => lt.includes(loose(p))).length;
      const score = hit / parts.length + (hit === parts.length ? 0.5 : 0) + Math.min(mdl.count || 0, 50) / 1000;
      if (hit && hit === parts.length && (!best || score > best.score)) best = { name: mdl.name, group: mdl.group, brand: mdl.brand, score, known: true };
    }
    if (best) return best;
    for (const [re, fmt, group] of BUILTIN) { const m = text.match(re); if (m) { const name = fmt(m); return { name, group: group || guessGroup(name), brand: /positivo/i.test(name) ? "Positivo" : /thinkpad|ideapad/i.test(name) ? "Lenovo" : /galaxy/i.test(name) ? "Samsung" : "", known: false }; } }
    return null;
  }
  function parseText(raw, models, codes = new Set()) {
    const text = String(raw || "").replace(/[|\\]/g, " ").replace(/[ \t]+/g, " ");
    const up = text.toUpperCase();
    const serial = (up.match(/\b(?:S\s?\/\s?N|SN|SERIAL(?:\s*(?:NO|NUMBER|N[°º]))?|N[°º]?\s*(?:DE\s*)?S[EÉ]RIE|SER)\s*[.:#]?\s*([A-Z0-9][A-Z0-9-]{4,24})/) || [])[1] || "";
    const asset = (up.match(/PATR[I1]M[O0]N[I1][O0]\s*(?:N[°º]|NO|#)?\s*[.:]?\s*([0-9][0-9.-]{2,14})/) || [])[1]?.replace(/[.-]/g, "") || "";
    const model = matchModel(text, models);
    const skip = new Set([serial, asset].filter(Boolean).map(s => s.toUpperCase()));
    // Pedaços do nome do modelo e códigos técnicos (MTM/Type/SM-) não são o número do equipamento.
    if (model) norm(model.name).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).forEach(t => skip.add(t));
    for (const m of up.matchAll(/\b(?:MTM|TYPE|SM-?|P\/N|PN|GEN)\s*[.:#]?\s*([A-Z0-9-]+)/g)) skip.add(m[1]);
    const tokens = [...new Set(up.split(/[\s:;,]+/).map(t => t.replace(/^[#.°º-]+|[.°º-]+$/g, "")).filter(t => t && t.length <= 24))];
    const labelled = (up.match(/(?:N[°º]|NUM(?:ERO)?|EQUIP(?:AMENTO)?|#)\s*[.:]?\s*([A-Z]{0,4}-?\d{1,5})\b/) || [])[1];
    const cands = [];
    const push = (v, w) => { v = clean(v).toUpperCase(); if (!v || skip.has(v) || cands.some(c => c.v === v)) return; cands.push({ v, w }); };
    if (labelled) push(labelled, 100);
    for (const t of tokens) {
      if (skip.has(t) || /^(19|20)\d{2}$/.test(t)) continue;
      const inDb = codes.has(norm(t));
      if (/^\d{1,4}$/.test(t)) push(t, (inDb ? 80 : 50) + (t.length <= 2 ? 10 : 0));
      else if (/^[A-Z]{1,5}-?\d{1,5}$/.test(t)) push(t, inDb ? 90 : 40);
      else if (inDb) push(t, 85);
    }
    cands.sort((a, b) => b.w - a.w);
    const chips = tokens.filter(t => /\d/.test(t) && t.length <= 18).slice(0, 14);
    const inDb = tokens.filter(t => !skip.has(t) && codes.has(norm(t)));
    return { number: cands[0]?.v || "", candidates: cands.slice(0, 6).map(c => c.v), inDb, serial, asset, model, chips, text: clean(text) };
  }

  /* ---------- Interface ---------- */
  const MODES = {
    find: { label: "Identificar", ic: "search", title: "Identificar equipamento", sub: "QR, código de barras, número ou etiqueta" },
    checkout: { label: "Retirar", ic: "out", title: "Retirar pela câmera", sub: "Cada equipamento lido entra na comanda" },
    return: { label: "Receber", ic: "back", title: "Receber pela câmera", sub: "Cada equipamento lido é dado como devolvido" },
    audit: { label: "Conferir", ic: "cart", title: "Conferir carrinho", sub: "Leia os números; o Equipa mostra o que falta" },
    register: { label: "Cadastrar", ic: "plus", title: "Cadastrar pela câmera", sub: "Mire no número do PC ou na etiqueta de baixo", admin: true }
  };
  function close() { current?.stop(); current = null; }
  /**
   * mode: find | register | checkout | return | audit.
   * Nos modos de coleta (checkout, return, audit) cada equipamento reconhecido é
   * entregue a onPick(device) → { ok, text, progress? }. onClose roda ao sair.
   */
  async function open(opts = {}) {
    let { mode = "find", onPick = null, onClose = null, doneLabel = "Concluir", title = "", expected = null, standalone = !opts.onPick } = opts;
    if (mode === "register" && !isAdmin()) return notify("Apenas administradores podem cadastrar equipamentos.", "error");
    close();
    const register = mode === "register", collect = ["checkout", "return", "audit"].includes(mode);
    const basket = new Map();
    // Aberta pelo botão da câmera: modos de coleta usam ações padrão.
    if (collect && !onPick) {
      if (mode === "checkout") { onPick = d => { if (d.status !== "available") return { ok: false, text: `Nº ${d.code} está ${statusLabel(d.status).toLowerCase()}` }; if (basket.has(String(d.id))) return { ok: true, text: `Nº ${d.code} já está na comanda` }; if (basket.size >= 60) return { ok: false, text: "Comanda cheia (60)" }; basket.set(String(d.id), d); return { ok: true, text: `Nº ${d.code} na comanda (${basket.size})` }; }; doneLabel = "Montar comanda"; onClose = () => { if (basket.size) openCounter([...basket.values()], { step: "ticket" }); }; }
      if (mode === "return") { return openReturnCamera(); }
    }
    const back = document.createElement("div");
    back.className = "overlay cam-overlay";
    const tabs = standalone ? Object.entries(MODES).filter(([, v]) => !v.admin || isAdmin()).map(([k, v]) => `<button type="button" data-cmode="${k}" class="${k === mode ? "on" : ""}">${icon(v.ic, 15)}<span>${v.label}</span></button>`).join("") : "";
    back.innerHTML = `<section class="sheet cam cam-${mode}" role="dialog" aria-modal="true" aria-label="Câmera">
      <header class="cam-head"><button type="button" class="icon-btn" data-close aria-label="Fechar">${icon("x", 22)}</button><div><h2>${esc(title || MODES[mode].title)}</h2><p id="cam-sub">${esc(MODES[mode].sub)}</p></div><button type="button" class="icon-btn" id="cam-torch" aria-label="Lanterna" hidden>${icon("flash", 20)}</button></header>
      ${tabs ? `<nav class="cam-modes" aria-label="O que fazer">${tabs}</nav>` : ""}
      <div class="cam-stage" id="cam-stage"><video playsinline muted autoplay></video><div class="cam-frame ${collect ? "cam-frame-wide" : ""}" id="cam-frame"><i></i><i></i><i></i><i></i></div><div class="cam-msg" id="cam-msg" hidden></div>
        <label class="cam-zoom" id="cam-zoom" hidden>${icon("search", 14)}<input type="range" min="1" max="1" step="0.1" value="1" aria-label="Zoom"></label></div>
      <div class="cam-panel" id="cam-panel"></div>
      <input type="file" accept="image/*" capture="environment" id="cam-file" hidden>
    </section>`;
    document.body.append(back);
    trapDialog(back);
    const $ = s => qs(s, back);
    const video = $("video"), panel = $("#cam-panel"), msg = $("#cam-msg");
    let stream = null, raf = 0, stopped = false, busy = false, paused = false, lastScan = 0, saved = 0, lastBarcode = "";
    const log = [];
    const detector = "BarcodeDetector" in window ? await (async () => { try { const f = await window.BarcodeDetector.getSupportedFormats(); return new window.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix", "itf"].filter(x => f.includes(x)) }); } catch { return null; } })() : null;
    let jsQR = null; ensureJsQRLib().then(l => { jsQR = l; }).catch(() => {});
    const models = await knownModels().catch(() => []);
    // Índices locais para reconhecer o equipamento sem ir ao servidor a cada leitura.
    const idx = { code: new Map(), serial: new Map(), asset: new Map(), qr: new Map() };
    const codes = new Set();
    const indexDevices = rows => { rows.forEach(d => { idx.code.set(norm(d.code), d); if (d.serial_number) idx.serial.set(norm(d.serial_number), d); if (d.asset_tag) idx.asset.set(norm(d.asset_tag), d); if (d.qr_token) idx.qr.set(d.qr_token, d); codes.add(norm(d.code)); }); };
    await loadDevices({ force: collect }).then(indexDevices).catch(() => {});
    const resolve = v => { const k = norm(v); return idx.code.get(k) || idx.serial.get(k) || idx.asset.get(k) || null; };
    let lastModel = ""; try { lastModel = sessionStorage.getItem(LAST_MODEL_KEY) || ""; } catch {}
    const stop = (runClose = true) => {
      if (stopped) return; stopped = true; cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      back.remove();
      if (runClose) onClose?.();
    };
    current = { stop: () => stop(false) };
    qs("[data-close]", back).addEventListener("click", () => stop());
    back.addEventListener("keydown", e => { if (e.key === "Escape") stop(); });
    qsa("[data-cmode]", back).forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.cmode; if (k === mode) return;
      stop(false);
      if (k === "audit") return chooseCartForAudit();
      if (k === "return") return openReturnCamera();
      open({ mode: k });
    }));
    const flash = (text, kind = "") => { msg.hidden = false; msg.className = `cam-msg ${kind}`; msg.textContent = text; clearTimeout(flash.t); flash.t = setTimeout(() => { msg.hidden = true; }, 2600); };
    const roi = () => {
      const st = $("#cam-stage").getBoundingClientRect(), fr = $("#cam-frame").getBoundingClientRect();
      const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return { x: .1, y: .3, w: .8, h: .4 };
      const s = Math.max(st.width / vw, st.height / vh), ox = (vw * s - st.width) / 2, oy = (vh * s - st.height) / 2;
      const x = (fr.left - st.left + ox) / s / vw, y = (fr.top - st.top + oy) / s / vh, w = fr.width / s / vw, h = fr.height / s / vh;
      return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) };
    };

    /* --- coleta: entrega cada equipamento reconhecido ao fluxo --- */
    async function pick(devs) {
      for (const d of devs) {
        let r; try { r = await onPick(d); } catch (e) { r = { ok: false, text: errText(e) }; }
        r ||= { ok: true, text: `Nº ${d.code}` };
        log.unshift({ ...r, code: d.code }); if (log.length > 30) log.pop();
        if (r.progress) expected = r.progress.expected, idle.seen = r.progress.seen;
        flash(r.text, r.ok ? "ok" : "warn");
        if (navigator.vibrate) try { navigator.vibrate(r.ok ? 35 : [40, 60, 40]); } catch {}
      }
      idle();
    }

    /* --- painel: aguardando --- */
    const idle = () => {
      paused = false;
      const progress = mode === "audit" && expected ? `<div class="cam-audit"><b>${(idle.seen || []).length}/${expected.length}</b><div class="cam-audit-chips">${expected.map(c => `<span class="${(idle.seen || []).includes(norm(c)) ? "on" : ""}">${esc(c)}</span>`).join("")}</div></div>` : "";
      const basketInfo = collect ? `<div class="cam-log">${progress}${log.length ? log.slice(0, 6).map(x => `<span class="cam-log-item ${x.ok ? "ok" : "bad"}">${icon(x.ok ? "check" : "warn", 14)}${esc(x.text)}</span>`).join("") : `<span class="cam-log-empty">${mode === "audit" ? "Dica: fotografe o carrinho aberto — vários números são lidos de uma vez." : "Os equipamentos lidos aparecem aqui."}</span>`}</div>` : "";
      panel.innerHTML = `${basketInfo}<div class="cam-actions">
        <button type="button" class="btn btn-ghost cam-side" id="cam-photo">${icon("file", 20)}<span>Foto</span></button>
        <button type="button" class="cam-shutter" id="cam-read" aria-label="Ler o que está no quadro"><span>${icon("text", 26)}</span></button>
        <button type="button" class="btn btn-ghost cam-side" id="cam-type">${icon("edit", 20)}<span>Digitar</span></button></div>
        ${collect ? `<button type="button" class="btn btn-primary btn-lg btn-block cam-done" id="cam-done">${esc(doneLabel)}${mode === "checkout" && basket.size ? ` (${basket.size})` : ""}</button>` : `<p class="cam-tip">QR e código de barras: automático. Número ou etiqueta: enquadre e toque no botão do meio (ou na imagem).${saved ? ` · <b>${saved}</b> cadastrado(s) agora` : ""}</p>`}`;
      $("#cam-read").addEventListener("click", () => readFrame());
      $("#cam-photo").addEventListener("click", () => $("#cam-file").click());
      $("#cam-type").addEventListener("click", () => result({ number: "", candidates: [], chips: [], serial: "", asset: "", model: register && lastModel ? { name: lastModel, known: true } : null }, "Digite o número"));
      $("#cam-done")?.addEventListener("click", () => stop());
    };
    $("#cam-stage").addEventListener("click", e => { if (!paused && !busy && !e.target.closest(".cam-zoom")) readFrame(); });

    /* --- leitura de texto (OCR) --- */
    async function ocrCanvas(source, w, h, area) {
      const worker = await getOcr(m => { if (/load|init/i.test(m.status)) panel.querySelector(".cam-progress i")?.style.setProperty("width", `${Math.round(m.progress * 100)}%`); });
      let { data } = await worker.recognize(prepare(source, w, h, area));
      let parsed = parseText(data.text, models, codes);
      if (!parsed.number && !parsed.serial && !parsed.model && !parsed.inDb.length) { ({ data } = await worker.recognize(prepare(source, w, h, area, true))); const inv = parseText(data.text, models, codes); if (inv.number || inv.serial || inv.model || inv.inDb.length) parsed = inv; }
      return parsed;
    }
    async function readFrame(image = null) {
      if (busy) return; busy = true; paused = true;
      const first = !ocrWorker;
      panel.innerHTML = `<div class="cam-wait"><span class="spin"></span><b>${first ? "Preparando o leitor de texto…" : "Lendo…"}</b>${first ? `<small>Só na primeira vez (cerca de 3 MB).</small><div class="cam-progress"><i></i></div>` : ""}</div>`;
      try {
        let parsed;
        if (image) parsed = await ocrCanvas(image, image.width, image.height, { x: 0, y: 0, w: 1, h: 1 });
        else {
          if (!video.videoWidth) throw new Error("A câmera ainda não está pronta.");
          const snap = document.createElement("canvas"); snap.width = video.videoWidth; snap.height = video.videoHeight; snap.getContext("2d").drawImage(video, 0, 0);
          parsed = await ocrCanvas(snap, snap.width, snap.height, roi());
        }
        if (stopped) return;
        if (collect) {
          // Vários números numa leitura (ex.: foto do carrinho): entrega todos os que existem.
          const found = [...new Set([...parsed.inDb, parsed.number, parsed.serial, parsed.asset].filter(Boolean))].map(resolve).filter(Boolean);
          const uniq = [...new Map(found.map(d => [String(d.id), d])).values()];
          busy = false;
          if (uniq.length) return pick(uniq);
          flash("Nenhum número do inventário lido. Aproxime ou digite.", "warn"); return idle();
        }
        if (!parsed.number && !parsed.serial && !parsed.model && !parsed.chips.length) { flash("Não consegui ler. Aproxime, ilumine melhor e tente de novo.", "warn"); idle(); return; }
        try { navigator.vibrate?.(30); } catch {}
        result(parsed, "Confira o que foi lido");
      } catch (error) { if (!stopped) { notify(error.message || "Falha ao ler o texto.", "error"); idle(); } }
      finally { busy = false; }
    }
    $("#cam-file").addEventListener("change", async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      const img = await createImageBitmap(file).catch(() => null); if (!img) return notify("Não foi possível abrir a foto.", "error");
      const c = document.createElement("canvas"); const k = Math.min(1, 2200 / Math.max(img.width, img.height)); c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const code = await detectCodes(c); if (code) return handleCode(code);
      readFrame(c);
    });

    /* --- códigos (automático) --- */
    async function detectCodes(src) {
      try {
        if (detector) { const r = await detector.detect(src); if (r?.[0]?.rawValue) return { value: r[0].rawValue, format: r[0].format }; }
        if (jsQR) {
          const w = src.videoWidth || src.width, h = src.videoHeight || src.height; if (!w || !h) return null;
          const s = Math.min(1, 720 / w), c = document.createElement("canvas"); c.width = w * s; c.height = h * s;
          const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(src, 0, 0, c.width, c.height);
          const q = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "dontInvert" });
          if (q?.data) return { value: q.data, format: "qr_code" };
        }
      } catch {}
      return null;
    }
    async function handleCode({ value, format }) {
      if (!value || value === lastBarcode) return; lastBarcode = value; setTimeout(() => { if (lastBarcode === value) lastBarcode = ""; }, collect ? 2500 : 4000);
      try { navigator.vibrate?.(40); } catch {}
      const token = parseQrToken(value);
      if (collect) {
        let d = token ? idx.qr.get(token) : resolve(value);
        if (!d && !token) d = (await findDevice(value).catch(() => []))[0] || null;
        if (!d) { flash(token ? "QR de carrinho ou desconhecido." : `Código ${value.slice(0, 24)} não encontrado.`, "warn"); return; }
        paused = true; return pick([d]);
      }
      if (token) {
        if (!register) { stop(false); return openScannedToken(token); }
        paused = true;
        const d = idx.qr.get(token) || (await supabase.from("equipments").select("id,code,model").eq("qr_token", token).maybeSingle()).data;
        if (d) return existing(d, "Este QR já pertence a um equipamento.");
        flash("QR de carrinho ou inválido.", "warn"); paused = false; return;
      }
      const v = clean(value).slice(0, 120);
      if (!register) {
        paused = true;
        const local = resolve(v); if (local) { stop(false); return openDevice(local.id); }
        const found = await findDevice(v).catch(() => []);
        if (found.length === 1) { stop(false); return openDevice(found[0].id); }
        return result({ number: "", candidates: [], chips: [v], serial: v, asset: "", model: null }, `Código lido: ${v}`);
      }
      paused = true;
      result({ number: "", candidates: [], chips: [v], serial: format === "qr_code" ? "" : v, asset: "", model: lastModel ? { name: lastModel, known: true } : null }, "Código de barras lido como Nº de série");
    }
    const tick = async now => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      if (paused || busy || now - lastScan < 180 || video.readyState < 2) return;
      lastScan = now;
      const code = await detectCodes(video);
      if (code && !paused && !stopped) handleCode(code);
    };

    /* --- painel: resultado --- */
    function existing(d, text) {
      paused = true;
      panel.innerHTML = `<div class="cam-result"><div class="callout">${icon("info", 18)}<span>${esc(text)} <b>Nº ${esc(d.code)}</b>${d.model ? ` · ${esc(d.model)}` : ""}</span></div>
        <div class="cam-buttons"><button class="btn" type="button" id="cr-again">${icon("camera", 18)} Ler outro</button><button class="btn btn-primary" type="button" id="cr-open">Abrir ficha</button></div></div>`;
      $("#cr-again").addEventListener("click", idle);
      $("#cr-open").addEventListener("click", () => { stop(false); openDevice(d.id); });
    }
    function result(p, heading) {
      paused = true;
      const modelName = p.model?.name || (register ? lastModel : "");
      const chipList = [...new Set([...(p.candidates || []), ...(p.chips || [])])].slice(0, 12);
      panel.innerHTML = `<form class="cam-result" id="cr-form" autocomplete="off">
        <div class="cam-result-head"><b>${esc(heading)}</b>${p.model && !p.model.known ? `<span class="pill pill-in_use">modelo sugerido</span>` : p.model?.known ? `<span class="pill pill-available">modelo reconhecido</span>` : ""}</div>
        ${chipList.length ? `<div class="chips chips-tight" aria-label="Toque para usar como número">${chipList.map(c => `<button type="button" class="chip ${c === p.number ? "on" : ""}" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
        <div class="grid-2"><label class="field"><span>Número</span><input name="code" maxlength="80" value="${esc(p.number)}" placeholder="Ex.: 12"></label>
        ${collect ? "" : `<label class="field"><span>Modelo</span><input name="model" maxlength="120" list="cam-models" value="${esc(modelName)}" placeholder="Ex.: Chromebook N2210"></label>`}</div>
        <datalist id="cam-models">${models.map(m => `<option value="${esc(m.name)}">`).join("")}</datalist>
        ${register && models.length ? `<div class="chips chips-tight">${models.slice(0, 5).map(m => `<button type="button" class="chip ${norm(m.name) === norm(modelName) ? "on" : ""}" data-model="${esc(m.name)}">${esc(m.name)}</button>`).join("")}</div>` : ""}
        ${collect ? `<input type="hidden" name="serial_number" value="${esc(p.serial)}"><input type="hidden" name="asset_tag" value="${esc(p.asset)}">` : `<details class="more" ${p.serial || p.asset ? "open" : ""}><summary>Série e patrimônio</summary><div class="grid-2"><label class="field"><span>Nº de série</span><input name="serial_number" maxlength="120" value="${esc(p.serial)}"></label><label class="field"><span>Patrimônio</span><input name="asset_tag" maxlength="80" value="${esc(p.asset)}"></label></div>
          ${register ? `<label class="field"><span>Local (opcional)</span><input name="location_text" maxlength="160" value="${esc(sessionLocation())}"></label>` : ""}</details>`}
        <p class="cam-status" id="cr-status"></p>
        <div class="cam-buttons"><button class="btn" type="button" id="cr-again">${icon("camera", 18)} Voltar</button><button class="btn btn-primary" type="submit" id="cr-go">${register ? "Cadastrar" : collect ? "Usar" : "Procurar"}</button></div>
      </form>`;
      const form = $("#cr-form"), status = $("#cr-status"), go = $("#cr-go");
      qsa("[data-chip]", form).forEach(c => c.addEventListener("click", () => { form.elements.code.value = c.dataset.chip; qsa("[data-chip]", form).forEach(x => x.classList.toggle("on", x === c)); check(); }));
      qsa("[data-model]", form).forEach(c => c.addEventListener("click", () => { form.elements.model.value = c.dataset.model; qsa("[data-model]", form).forEach(x => x.classList.toggle("on", x === c)); }));
      $("#cr-again").addEventListener("click", idle);
      let seq = 0, match = null;
      const check = async () => {
        const code = clean(form.elements.code.value), v = code || clean(form.elements.serial_number.value) || clean(form.elements.asset_tag.value);
        const s = ++seq; match = null; status.textContent = ""; status.className = "cam-status";
        if (!v) { go.textContent = register ? "Cadastrar" : collect ? "Usar" : "Procurar"; return; }
        match = resolve(code) || resolve(v) || (await findDevice(code || v).catch(() => []))[0] || null;
        if (s !== seq) return;
        if (match) { status.innerHTML = `${icon("laptop", 15)} <b>Nº ${esc(match.code)}</b> · ${esc(match.model || "")} · ${esc(statusLabel(match.status))}`; status.classList.add("is-found"); go.textContent = collect ? `Usar Nº ${match.code}` : "Abrir ficha"; }
        else { status.textContent = register ? "Número livre — pode cadastrar." : "Nenhum equipamento com esse número."; go.textContent = register ? `Cadastrar${code ? ` Nº ${code}` : ""}` : !collect && isAdmin() ? "Cadastrar este" : collect ? "Usar" : "Procurar"; }
      };
      let t; form.addEventListener("input", e => { if (["code", "serial_number", "asset_tag"].includes(e.target.name)) { clearTimeout(t); t = setTimeout(check, 300); } });
      check();
      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        if (collect) { if (!match) return notify("Esse número não está no inventário.", "warning"); return pick([match]); }
        if (match) { stop(false); return openDevice(match.id); }
        const f = Object.fromEntries(new FormData(form));
        if (!register) {
          if (!isAdmin()) { status.textContent = "Nada encontrado. Confira o número."; return; }
          if (!clean(f.code)) { form.elements.code.focus(); return notify("Informe o número para cadastrar.", "warning"); }
          stop(false); return EquipaRegister.open("one", { code: clean(f.code), model: clean(f.model) });
        }
        if (!clean(f.code)) { form.elements.code.focus(); return notify("Informe o número do equipamento.", "warning"); }
        if (!clean(f.model)) { form.elements.model.focus(); return notify("Informe o modelo.", "warning"); }
        const known = models.find(m => norm(m.name) === norm(f.model));
        setBusy(go, true, "Salvando…");
        try {
          const row = await EquipaRegister.saveOne({ ...f, brand: known?.brand || p.model?.brand || "", school_group: known?.group || p.model?.group || guessGroup(f.model) || null });
          saved++; lastModel = clean(f.model);
          try { sessionStorage.setItem(LAST_MODEL_KEY, lastModel); sessionStorage.setItem(LAST_MODEL_KEY + "-loc", clean(f.location_text)); } catch {}
          indexDevices([{ ...row, model: f.model, status: "available" }]);
          flash(`Nº ${row.code} cadastrado`, "ok");
          idle();
        } catch (error) { setBusy(go, false); notify(error.message && /EQUIPA_|23505|duplicate/i.test(error.message) ? "Esse número, série ou patrimônio já está cadastrado." : errText(error), "error"); }
      });
      if (!p.number) form.elements.code.focus();
    }
    const sessionLocation = () => { try { return sessionStorage.getItem(LAST_MODEL_KEY + "-loc") || ""; } catch { return ""; } };

    /* --- iniciar câmera --- */
    idle();
    if (!navigator.mediaDevices?.getUserMedia) { $("#cam-sub").textContent = "Câmera ao vivo indisponível neste navegador — use Foto ou Digitar."; $("#cam-stage").classList.add("off"); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream; await video.play();
      const track = stream.getVideoTracks()[0], caps = track.getCapabilities?.() || {};
      if (caps.torch) {
        const b = $("#cam-torch"); b.hidden = false; let on = false;
        b.addEventListener("click", async () => { on = !on; try { await track.applyConstraints({ advanced: [{ torch: on }] }); b.classList.toggle("on", on); } catch { b.hidden = true; } });
      }
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        const z = $("#cam-zoom"), r = qs("input", z); z.hidden = false;
        r.min = caps.zoom.min; r.max = Math.min(caps.zoom.max, caps.zoom.min * 6); r.step = caps.zoom.step || 0.1; r.value = caps.zoom.min;
        r.addEventListener("input", () => track.applyConstraints({ advanced: [{ zoom: Number(r.value) }] }).catch(() => {}));
      }
      if (caps.focusMode?.includes?.("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      raf = requestAnimationFrame(tick);
    } catch {
      $("#cam-sub").textContent = "Sem permissão para a câmera — use Foto ou Digitar."; $("#cam-stage").classList.add("off");
    }
  }
  /** Conferir pela câmera, escolhendo o carrinho primeiro. */
  async function chooseCartForAudit() {
    const m = openSheet({ size: "sm", title: "Conferir qual carrinho?", body: loadingState() });
    try {
      const [map, devices] = await Promise.all([loadCartMap(), loadDevices()]);
      if (!m.isConnected) return;
      const byCode = new Map(devices.map(d => [norm(d.code), d]));
      setSheet(m, { body: map.carts.length ? `<div class="menu">${map.carts.map((c, i) => `<button type="button" class="menu-item" data-c="${i}">${icon("cart", 20)}<span><b>${esc(cartName(c))}</b><small>${(c.equipment_codes || []).length} equipamentos · ${esc(c.location_text || "")}</small></span>${icon("chevron", 16)}</button>`).join("")}</div>` : emptyState("Nenhum carrinho cadastrado.", "", "cart") });
      qsa("[data-c]", m).forEach(b => b.addEventListener("click", () => { m.close(); openCartAudit(map.carts[Number(b.dataset.c)], byCode); }));
    } catch (error) { setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); }
  }
  return { open, close, parseText };
})();
