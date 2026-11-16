/* Equipa 1.0 — base de interface: utilitários, ícones, janelas, avisos e rótulos.
 * Scripts clássicos: tudo o que é declarado aqui fica disponível para app.js,
 * register.js e camera.js. Nada aqui conversa com o banco. */
"use strict";

const qs = (s, root = document) => root.querySelector(s);
const qsa = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v = "") => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const uid = () => crypto.randomUUID();
const clean = v => String(v ?? "").trim();
const norm = v => clean(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isMobile = () => matchMedia("(max-width: 860px)").matches;
const numSort = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });

/* ---------- Bibliotecas externas sob demanda ---------- */
const loadedScripts = new Map();
function loadScriptOnce(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => { loadedScripts.delete(src); reject(new Error("Não foi possível carregar um recurso necessário. Verifique a internet.")); };
    document.head.append(s);
  });
  loadedScripts.set(src, promise);
  return promise;
}
const ensureQRCodeLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js", "QRCode");
const ensureXLSXLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX");
const ensureJsQRLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js", "jsQR");
const ensureJSZipLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", "JSZip");
const ensureJsPDF = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js", "jspdf");

/* ---------- Datas ---------- */
function dt(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}
function dateOnly(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}
function relativeDue(value) {
  if (!value) return "Sem prazo";
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "Sem prazo";
  const mins = Math.round(Math.abs(diff) / 60000);
  const span = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  return diff < 0 ? `Atrasada há ${span}` : `Devolver em ${span}`;
}
function localDateTimeValue(date) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/* ---------- Rótulos ---------- */
const STATUS_LABEL = {
  available: "Disponível", in_use: "Em uso", maintenance: "Manutenção", unavailable: "Indisponível", overdue: "Atrasada",
  open: "Em aberto", returned: "Devolvida", cancelled: "Cancelada", confirmed: "Confirmada",
  fulfilled: "Utilizada", expired: "Expirada", resolved: "Resolvida",
  damaged: "Avaria", missing: "Não localizado", pending: "Pendente"
};
const statusLabel = v => STATUS_LABEL[v] ?? v ?? "—";
const roleLabel = v => ({ student: "Aluno", teacher: "Professor", admin: "Administrador", staff: "Funcionário" })[v] ?? v ?? "Usuário";
const GROUPS = [["chromebook", "Chromebook"], ["positivo_novo", "Positivo novo"], ["positivo_tecnico", "Positivo técnico"], ["positivo_antigo", "Positivo antigo"], ["thinkpad_lenovo", "ThinkPad Lenovo"], ["tablet", "Tablet"], ["outro", "Outro"]];
const schoolGroupLabel = v => Object.fromEntries(GROUPS)[v] ?? "Sem tipo";
const groupOptions = (selected = "", empty = "Sem tipo") => `<option value="">${esc(empty)}</option>` + GROUPS.map(([v, l]) => `<option value="${v}" ${selected === v ? "selected" : ""}>${l}</option>`).join("");
const purposeLabel = v => ({ lesson: "Aula", assessment: "Avaliação", project: "Projeto ou atividade", support: "Suporte técnico", other: "Outro motivo" })[v] || "Não informado";
/** Adivinha o tipo a partir do nome do modelo; o usuário sempre pode trocar. */
function guessGroup(model = "") {
  const m = norm(model);
  if (!m) return "";
  if (/chrome ?book/.test(m)) return "chromebook";
  if (/thinkpad|lenovo/.test(m)) return "thinkpad_lenovo";
  if (/tablet|tab\b|ipad|galaxy tab|tab [as]\d/.test(m)) return "tablet";
  if (/positivo/.test(m)) return /tecnic/.test(m) ? "positivo_tecnico" : /antig/.test(m) ? "positivo_antigo" : /nov/.test(m) ? "positivo_novo" : "";
  return "";
}

/* ---------- Ícones (traço 1.8, 24×24) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  devices: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
  moves: '<path d="M4 7h14m-4-4 4 4-4 4M20 17H6m4-4-4 4 4 4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3m-3 3h3m0-3v3M14 20v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  out: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 17l5-5-5-5M15 12H3"/>',
  back: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M14 7l-5 5 5 5M9 12h12"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
  moon: '<path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7z"/>',
  logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M9 12h10"/>',
  edit: '<path d="m15 5 4 4M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/>',
  tool: '<path d="M14 6a5 5 0 0 0-6 6l-5 5a2 2 0 0 0 3 3l5-5a5 5 0 0 0 6-6l-3 3-3-3z"/>',
  cart: '<path d="M3 4h2l2.5 12h11l2-9H6M9 20h.01M17 20h.01"/>',
  chart: '<path d="M4 20V11m5 9V4m5 16v-7m5 7V8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.6 3.2 7.6 7.5 9 4.3-1.4 7.5-4.4 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  tag: '<path d="M20 13 12 21 3 12V3h9zM7.5 7.5h.01"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M4 20h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  warn: '<path d="m12 3 10 18H2zM12 10v4m0 3h.01"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 7 9-7"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3.2 3.8M6.3 6.4C3.5 8.2 2 12 2 12s3.5 6 10 6a10 10 0 0 0 4.3-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  tablet: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  text: '<path d="M4 6V4h16v2M9 20h6M12 4v16"/>',
  flash: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5.5 9a7.5 7.5 0 0 1 13.4-2M18.5 15a7.5 7.5 0 0 1-13.4 2"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
  sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  select: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>'
};
function icon(name, size = 20) {
  return `<svg class="ic" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.grid}</svg>`;
}
const groupIcon = (g, size = 20) => icon(g === "tablet" ? "tablet" : g === "outro" ? "box" : "laptop", size);
function brandMark(size = 28, extra = "") {
  return `<svg class="brand-glyph notebook ${extra}" width="${Math.round(size * 1.2)}" height="${size}" viewBox="0 0 48 40" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="nb-deck"><path class="nb-base" d="M11 23h26l6.5 8.5h-39z" stroke-width="2.3"/><path class="nb-keys" d="M13.4 25.8h21.2M11.2 28.6h25.6" stroke-width="1.5"/><path class="nb-base" d="M4.5 31.5h39v1.1a1.9 1.9 0 0 1-1.9 1.9H6.4a1.9 1.9 0 0 1-1.9-1.9z" stroke-width="2.3"/></g><g class="nb-lid"><rect x="11" y="4" width="26" height="19" rx="3" class="nb-shell" stroke-width="2.3"/><rect x="14.2" y="7.2" width="19.6" height="12.6" rx="1.5" class="nb-screen"/><circle cx="24" cy="5.6" r=".7" class="nb-cam"/><path class="nb-code" d="M17 11h6M17 14h11M17 17h4.5" stroke-width="1.8"/></g></svg>`;
}

/* ---------- Avisos ---------- */
function notify(message, type = "info") {
  const host = qs("#toast-host");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span class="toast-ic">${icon(type === "success" ? "check" : type === "info" ? "info" : "warn", 18)}</span><p>${esc(message)}</p><button type="button" aria-label="Fechar aviso">${icon("x", 16)}</button>`;
  host.prepend(el);
  while (host.children.length > 3) host.lastElementChild?.remove();
  const remove = () => { el.classList.add("out"); setTimeout(() => el.remove(), 200); };
  qs("button", el).addEventListener("click", remove);
  setTimeout(remove, type === "error" ? 7000 : 4200);
}

/* ---------- Janelas: diálogo no computador, folha inferior no celular ---------- */
let dialogCount = 0;
function trapDialog(back) {
  const dialog = qs(".sheet", back);
  const previous = document.activeElement;
  const ctrl = new AbortController();
  const focusables = () => qsa('button,input,select,textarea,a[href],[tabindex="0"]', dialog).filter(el => !el.disabled && el.getClientRects().length);
  dialog.tabIndex = -1;
  const h = qs("h2,h1", dialog);
  if (h) { h.id ||= `dlg-${++dialogCount}`; dialog.setAttribute("aria-labelledby", h.id); }
  document.body.classList.add("has-dialog");
  back.addEventListener("keydown", e => {
    if (qsa(".overlay").at(-1) !== back) return;
    if (e.key === "Escape") { e.preventDefault(); qs("[data-close]", back)?.click(); return; }
    if (e.key !== "Tab") return;
    const n = focusables(), first = n[0] || dialog, last = n.at(-1) || dialog;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, { signal: ctrl.signal });
  requestAnimationFrame(() => back.isConnected && dialog.focus({ preventScroll: true }));
  const obs = new MutationObserver(() => {
    if (back.isConnected) return;
    obs.disconnect(); ctrl.abort();
    if (!qs(".overlay")) document.body.classList.remove("has-dialog");
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  });
  obs.observe(document.body, { childList: true });
}
/**
 * Abre uma janela. `title` vira o cabeçalho fixo; `body` é rolável; `foot` fica fixo embaixo.
 * size: "sm" | "md" | "lg" | "full".
 */
function openSheet({ title = "", subtitle = "", body = "", foot = "", size = "md", className = "" } = {}) {
  const back = document.createElement("div");
  back.className = "overlay";
  back.innerHTML = `<section class="sheet sheet-${size} ${className}" role="dialog" aria-modal="true">
    <header class="sheet-head"><div class="sheet-title">${title ? `<h2>${title}</h2>` : ""}${subtitle ? `<p>${subtitle}</p>` : ""}</div><button type="button" class="icon-btn" data-close aria-label="Fechar">${icon("x", 20)}</button></header>
    <div class="sheet-body">${body}</div>${foot ? `<footer class="sheet-foot">${foot}</footer>` : ""}</section>`;
  document.body.append(back);
  trapDialog(back);
  const close = () => { back.classList.add("closing"); setTimeout(() => back.remove(), 160); };
  back.close = close;
  qsa("[data-close]", back).forEach(b => b.addEventListener("click", close));
  back.addEventListener("pointerdown", e => { back.dataset.downOnBack = e.target === back ? "1" : ""; });
  back.addEventListener("click", e => { if (e.target === back && back.dataset.downOnBack === "1" && !back.dataset.locked) close(); });
  return back;
}
/** Substitui o conteúdo de uma janela aberta (para fluxos em etapas). */
function setSheet(back, { title, subtitle, body, foot } = {}) {
  const s = qs(".sheet", back);
  if (title !== undefined) qs(".sheet-title", s).innerHTML = `${title ? `<h2>${title}</h2>` : ""}${subtitle ? `<p>${subtitle}</p>` : ""}`;
  if (body !== undefined) qs(".sheet-body", s).innerHTML = body;
  let f = qs(".sheet-foot", s);
  if (foot !== undefined) {
    if (!foot) f?.remove();
    else { if (!f) { f = document.createElement("footer"); f.className = "sheet-foot"; s.append(f); } f.innerHTML = foot; }
  }
  qs(".sheet-body", s).scrollTop = 0;
  qsa("[data-close]", s).forEach(b => { if (!b.dataset.bound) { b.dataset.bound = "1"; b.addEventListener("click", back.close); } });
}
function confirmAction({ title = "Confirmar", message = "", confirmText = "Confirmar", cancelText = "Voltar", danger = false } = {}) {
  return new Promise(resolve => {
    const m = openSheet({ size: "sm", title: esc(title), body: `<p class="lead">${esc(message)}</p>`, foot: `<button class="btn" type="button" data-no>${esc(cancelText)}</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-yes>${esc(confirmText)}</button>` });
    let done = false;
    const finish = v => { if (done) return; done = true; m.close(); resolve(v); };
    qs("[data-no]", m).addEventListener("click", () => finish(false));
    qs("[data-yes]", m).addEventListener("click", () => finish(true));
    new MutationObserver((_, o) => { if (!m.isConnected) { o.disconnect(); finish(false); } }).observe(document.body, { childList: true });
  });
}
function setBusy(button, busy, text = "Aguarde…") {
  if (!button) return;
  if (busy) { button.dataset.old = button.innerHTML; button.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(text)}`; button.disabled = true; }
  else { if (button.dataset.old) button.innerHTML = button.dataset.old; button.disabled = false; }
}
const emptyState = (title, text = "", ic = "box") => `<div class="empty">${icon(ic, 28)}<strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ""}</div>`;
const loadingState = (text = "Carregando…") => `<div class="loading"><span class="spin"></span>${esc(text)}</div>`;
const pill = (st, label = statusLabel(st)) => `<span class="pill pill-${esc(st)}">${esc(label)}</span>`;

/* ---------- Arquivos ---------- */
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const safeFileName = (v = "arquivo") => String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "arquivo";

/* ---------- Busca tolerante (acentos, ordem das palavras) ---------- */
const normalizeSearchText = v => norm(v).replace(/[^a-z0-9]+/g, " ").trim();
const cleanSearch = v => String(v || "").replace(/[,%()*\\]/g, " ").trim().slice(0, 80);
function smartScore(fields, query) {
  const fs = fields.map(normalizeSearchText).filter(Boolean);
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!tokens.length) return 1;
  let score = 0;
  for (const t of tokens) {
    let best = 0;
    for (const f of fs) {
      if (f === t) best = Math.max(best, 120);
      else if (f.startsWith(t)) best = Math.max(best, 90);
      else if (f.includes(` ${t}`)) best = Math.max(best, 60);
      else if (f.includes(t)) best = Math.max(best, 40);
    }
    if (!best) return 0;
    score += best;
  }
  return score;
}
function smartFilter(rows, query, fields) {
  const q = cleanSearch(query);
  if (!q) return rows;
  return rows.map(r => ({ r, s: smartScore(fields(r), q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r);
}
