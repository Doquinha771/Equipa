/* Equipa — gerador de etiquetas QR.
 * Por que existia "tela branca": a impressão usava window.print() sobre a janela
 * animada do app; o Chrome imprimia o primeiro quadro da animação (opacidade 0).
 * Agora a impressão monta uma página própria (iframe) só com as etiquetas, sem
 * animações nem o resto do app, e a prévia aparece na tela antes de imprimir. */
"use strict";
const EquipaLabels = (() => {
  // Folha A4 (210×297 mm), margem de 8 mm.
  const LAYOUTS = {
    small: { label: "Pequena · 21 por folha", cols: 3, rows: 7, w: 64, h: 38, qr: 30, num: 20 },
    medium: { label: "Média · 12 por folha", cols: 3, rows: 4, w: 64, h: 66, qr: 46, num: 26 },
    large: { label: "Grande · 4 por folha", cols: 2, rows: 2, w: 96, h: 136, qr: 82, num: 44 }
  };
  const qrCache = new Map();
  async function qrDataURL(text, px = 360) {
    const key = `${px}|${text}`;
    if (qrCache.has(key)) return qrCache.get(key);
    await ensureQRCodeLib();
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden";
    document.body.append(el);
    try {
      new window.QRCode(el, { text, width: px, height: px, correctLevel: window.QRCode.CorrectLevel.M });
      const c = qs("canvas", el);
      const url = c ? c.toDataURL("image/png") : await new Promise(r => requestAnimationFrame(() => r(qs("img", el)?.src || "")));
      if (!url) throw new Error("Não foi possível gerar o QR Code.");
      qrCache.set(key, url);
      return url;
    } finally { el.remove(); }
  }
  async function withQrs(items, onProgress) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      if (!d.qr_token) continue;
      out.push({ ...d, qr: await qrDataURL(qrUrl(d.qr_token)) });
      if (i % 10 === 0) { onProgress?.(i + 1, items.length); await sleep(0); }
    }
    return out;
  }
  const labelInner = (d, o) => `<img src="${d.qr}" alt=""><div class="t"><small>${esc(o.school ? "EQUIPA · " + o.school : "EQUIPA")}</small><b>${esc(d.code)}</b>${o.model && d.model ? `<span>${esc(d.model)}</span>` : ""}${o.cart && d.cart ? `<span>${esc(d.cart)}</span>` : ""}</div>`;
  /** HTML de impressão (A4 em milímetros). Usado na prévia e no iframe de impressão. */
  function sheetCss(L, forPrint) {
    return `@page{size:A4;margin:8mm}*{box-sizing:border-box}${forPrint ? "html,body{margin:0;background:#fff}" : ""}
      .pg{width:194mm;display:grid;grid-template-columns:repeat(${L.cols},${L.w}mm);grid-auto-rows:${L.h}mm;gap:0 1mm;justify-content:center;align-content:start;page-break-after:always;break-after:page;${forPrint ? "height:281mm;" : ""}}
      .pg:last-child{page-break-after:auto;break-after:auto}
      .lb{display:flex;${L.cols === 2 && L.rows === 2 ? "flex-direction:column;justify-content:center;text-align:center;" : ""}align-items:center;gap:2mm;padding:2.5mm;border:.3mm dashed #b9b2a6;border-radius:2mm;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff}
      .lb img{width:${L.qr}mm;height:${L.qr}mm;flex:none;image-rendering:pixelated}
      .lb .t{display:flex;flex-direction:column;min-width:0;gap:.6mm}
      .lb small{font-size:2.4mm;letter-spacing:.3mm;color:#555;font-weight:700}
      .lb b{font-size:${L.num / 3}mm;line-height:1;font-weight:800;word-break:break-all}
      .lb span{font-size:2.6mm;color:#333;line-height:1.15}`;
  }
  function pagesHtml(rows, L, o) {
    const per = L.cols * L.rows, pages = [];
    for (let i = 0; i < rows.length; i += per) pages.push(`<div class="pg">${rows.slice(i, i + per).map(d => `<div class="lb">${labelInner(d, o)}</div>`).join("")}</div>`);
    return pages.join("");
  }
  /** Imprime numa página própria, sem o app por trás (evita a tela branca). */
  async function printRows(rows, L, o) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas Equipa</title><style>${sheetCss(L, true)}</style></head><body>${pagesHtml(rows, L, o)}</body></html>`);
    doc.close();
    await Promise.all([...doc.images].map(img => img.decode().catch(() => {})));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }
  async function pdfRows(rows, L, o, filename) {
    await ensureJsPDF();
    const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const per = L.cols * L.rows, gx = 1, totalW = L.cols * L.w + (L.cols - 1) * gx, x0 = (210 - totalW) / 2, y0 = 8;
    const big = L.cols === 2 && L.rows === 2;
    rows.forEach((d, i) => {
      if (i && i % per === 0) pdf.addPage();
      const p = i % per, x = x0 + (p % L.cols) * (L.w + gx), y = y0 + Math.floor(p / L.cols) * L.h;
      pdf.setDrawColor(185, 178, 166); pdf.setLineDashPattern([1, 1], 0); pdf.roundedRect(x + .5, y + .5, L.w - 1, L.h - 1, 2, 2);
      if (big) {
        pdf.addImage(d.qr, "PNG", x + (L.w - L.qr) / 2, y + 8, L.qr, L.qr);
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(L.num * 2); pdf.setTextColor(17); pdf.text(String(d.code), x + L.w / 2, y + L.qr + 24, { align: "center", maxWidth: L.w - 6 });
        if (o.model && d.model) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.text(String(d.model), x + L.w / 2, y + L.qr + 32, { align: "center", maxWidth: L.w - 6 }); }
      } else {
        const qy = y + (L.h - L.qr) / 2;
        pdf.addImage(d.qr, "PNG", x + 2.5, qy, L.qr, L.qr);
        const tx = x + L.qr + 5, tw = L.w - L.qr - 7;
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.5); pdf.setTextColor(85); pdf.text("EQUIPA", tx, qy + 5);
        const code = String(d.code); pdf.setTextColor(17); pdf.setFontSize(code.length <= 4 ? L.num * 1.5 : code.length <= 8 ? L.num : L.num * .7); pdf.text(code, tx, qy + L.qr / 2 + 3, { maxWidth: tw });
        let ty = qy + L.qr / 2 + 9;
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(50);
        if (o.model && d.model) { pdf.text(String(d.model).slice(0, 60), tx, ty, { maxWidth: tw }); ty += 6; }
        if (o.cart && d.cart) pdf.text(String(d.cart), tx, ty, { maxWidth: tw });
      }
    });
    pdf.save(`${safeFileName(filename)}.pdf`);
  }

  /**
   * Gerador: escolha quais equipamentos (filtros, clique, arrasto), veja a prévia
   * real das folhas e imprima ou baixe em PDF. `preselect` = equipamentos já escolhidos.
   */
  async function open(preselect = null, title = "Etiquetas QR") {
    const m = openSheet({ size: "full", className: "labels-sheet", title: esc(title), subtitle: "Escolha os equipamentos, confira a prévia e imprima.", body: loadingState("Carregando equipamentos…") });
    let devices, map;
    try { [devices, map] = await Promise.all([loadDevices({ force: true }), loadCartMap().catch(() => ({ carts: [], byCode: new Map() }))]); }
    catch (error) { setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); return; }
    if (!m.isConnected) return;
    devices = devices.filter(d => d.qr_token).map(d => ({ ...d, cart: cartName(map.byCode.get(norm(d.code))) })).sort((a, b) => numSort(a.code, b.code));
    const pre = preselect ? new Set(preselect.map(d => String(d.id || d.equipment_id))) : null;
    const sel = new Set(pre ? devices.filter(d => pre.has(String(d.id))).map(d => String(d.id)) : []);
    // Equipamentos recém-cadastrados podem ainda não estar no cache: entram direto.
    if (preselect) for (const d of preselect) if (d.qr_token && !devices.some(x => String(x.id) === String(d.id))) { devices.push({ ...d, cart: "" }); sel.add(String(d.id)); }
    const opt = { layout: "small", model: true, cart: false, school: "" };
    const ui = { model: "", cart: "", loc: "", q: "" };
    const models = [...new Set(devices.map(modelKey))].sort(numSort), locs = [...new Set(devices.map(d => d.location_text).filter(Boolean))].sort(numSort);
    setSheet(m, { body: `<div class="lb-grid">
        <section class="lb-pick">
          <div class="toolbar toolbar-tight toolbar-wrap"><label class="search">${icon("search", 18)}<input id="lb-q" type="search" placeholder="Número" autocomplete="off"></label>
            <select id="lb-model"><option value="">Todos os modelos</option>${models.map(x => `<option>${esc(x)}</option>`).join("")}</select>
            <select id="lb-cart"><option value="">Todos os carrinhos</option><option value="__none">Sem carrinho</option>${map.carts.map(c => `<option>${esc(cartName(c))}</option>`).join("")}</select>
            ${locs.length ? `<select id="lb-loc"><option value="">Todos os locais</option>${locs.map(x => `<option>${esc(x)}</option>`).join("")}</select>` : ""}</div>
          <div class="row-between"><span class="hint">${icon("select", 14)} Clique ou arraste para escolher.</span><span class="row-wrap"><button class="btn btn-sm" type="button" id="lb-all">Marcar visíveis</button><button class="btn btn-sm btn-ghost" type="button" id="lb-none">Limpar</button></span></div>
          <div class="slots" id="lb-slots"></div>
        </section>
        <aside class="lb-side">
          <fieldset class="field"><legend>Tamanho</legend><div class="chips-radio">${Object.entries(LAYOUTS).map(([k, L]) => `<label class="chip-radio"><input type="radio" name="lb-layout" value="${k}" ${k === opt.layout ? "checked" : ""}><span>${L.label}</span></label>`).join("")}</div></fieldset>
          <label class="check"><input type="checkbox" id="lb-o-model" checked><span>Mostrar o modelo</span></label>
          <label class="check"><input type="checkbox" id="lb-o-cart"><span>Mostrar o carrinho</span></label>
          <label class="field"><span>Texto extra (opcional)</span><input id="lb-o-school" maxlength="30" placeholder="Ex.: E.E. Amador"></label>
          <div class="lb-count" id="lb-count"></div>
          <div class="lb-preview-wrap"><div class="lb-preview" id="lb-preview"></div></div>
        </aside></div>`,
      foot: `<span class="foot-info" id="lb-foot"></span><button class="btn" type="button" id="lb-pdf">${icon("download", 17)}<span>Baixar PDF</span></button><button class="btn btn-primary btn-lg" type="button" id="lb-print">${icon("file", 17)}<span>Imprimir</span></button>` });
    const slots = qs("#lb-slots", m);
    const visible = () => devices.filter(d => (!ui.model || modelKey(d) === ui.model) && (!ui.cart || (ui.cart === "__none" ? !d.cart : d.cart === ui.cart)) && (!ui.loc || d.location_text === ui.loc) && (!ui.q || norm(d.code).includes(norm(ui.q))));
    const chosen = () => devices.filter(d => sel.has(String(d.id)));
    let previewSeq = 0;
    const paintPreview = async () => {
      const L = LAYOUTS[opt.layout], list = chosen(), per = L.cols * L.rows, sheets = Math.ceil(list.length / per);
      qs("#lb-count", m).innerHTML = `<b>${list.length}</b> etiqueta${list.length === 1 ? "" : "s"} · <b>${sheets}</b> folha${sheets === 1 ? "" : "s"} A4`;
      qs("#lb-foot", m).textContent = list.length ? `${list.length} etiqueta(s)` : "Nenhuma escolhida";
      qs("#lb-print", m).disabled = qs("#lb-pdf", m).disabled = !list.length;
      const host = qs("#lb-preview", m), s = ++previewSeq;
      if (!list.length) { host.innerHTML = `<p class="lane-empty">Escolha os equipamentos para ver a prévia.</p>`; return; }
      host.innerHTML = loadingState("Gerando prévia…");
      const rows = await withQrs(list.slice(0, per));
      if (s !== previewSeq || !host.isConnected) return;
      host.innerHTML = `<style>${sheetCss(L, false).replace(/@page\{[^}]*\}/, "")}</style>${pagesHtml(rows, L, opt)}${sheets > 1 ? `<p class="hint center">Prévia da 1ª folha de ${sheets}.</p>` : ""}`;
    };
    const paint = () => {
      slots.innerHTML = visible().map(d => `<button type="button" class="slot ${sel.has(String(d.id)) ? "picked" : "s-available"}" data-id="${esc(d.id)}" title="${esc(d.model || "")}${d.cart ? ` · ${esc(d.cart)}` : ""}">${icon("qr", 18)}<span>${esc(d.code)}</span></button>`).join("") || `<p class="lane-empty">Nada com esses filtros.</p>`;
      paintPreview();
    };
    slots.addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (!b) return; if (sel.has(b.dataset.id)) sel.delete(b.dataset.id); else sel.add(b.dataset.id); paint(); });
    enableMarquee(slots, { onSelect: els => { toggleMany(sel, els.map(el => el.dataset.id)); paint(); } });
    const bindSel = (id, k) => qs(id, m)?.addEventListener("change", e => { ui[k] = e.target.value; paint(); });
    bindSel("#lb-model", "model"); bindSel("#lb-cart", "cart"); bindSel("#lb-loc", "loc");
    let t; qs("#lb-q", m).addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { ui.q = e.target.value; paint(); }, 120); });
    qs("#lb-all", m).addEventListener("click", () => { visible().forEach(d => sel.add(String(d.id))); paint(); });
    qs("#lb-none", m).addEventListener("click", () => { sel.clear(); paint(); });
    qsa('input[name="lb-layout"]', m).forEach(r => r.addEventListener("change", () => { opt.layout = r.value; paintPreview(); }));
    qs("#lb-o-model", m).addEventListener("change", e => { opt.model = e.target.checked; paintPreview(); });
    qs("#lb-o-cart", m).addEventListener("change", e => { opt.cart = e.target.checked; paintPreview(); });
    qs("#lb-o-school", m).addEventListener("input", e => { opt.school = clean(e.target.value); clearTimeout(t); t = setTimeout(paintPreview, 250); });
    const run = async (btn, fn) => {
      const list = chosen(); if (!list.length) return;
      if (list.length > 2000) return notify("Gere até 2.000 etiquetas por vez (filtre por modelo ou carrinho).", "warning");
      setBusy(btn, true, "Gerando QR…");
      try { const rows = await withQrs(list, (i, n) => { btn.lastChild.textContent = `Gerando ${i}/${n}…`; }); await fn(rows); }
      catch (error) { notify(errText(error), "error"); }
      finally { setBusy(btn, false); }
    };
    qs("#lb-print", m).addEventListener("click", e => run(e.currentTarget, rows => printRows(rows, LAYOUTS[opt.layout], opt)));
    qs("#lb-pdf", m).addEventListener("click", e => run(e.currentTarget, async rows => { await pdfRows(rows, LAYOUTS[opt.layout], opt, `Equipa-etiquetas-${ui.model || ui.cart || "selecao"}`); notify(`${rows.length} etiqueta(s) em PDF.`, "success"); }));
    paint();
  }
  /** Imprime direto uma etiqueta grande (botão "Imprimir" da ficha do equipamento ou do carrinho). */
  async function printOne(item) {
    try { const rows = await withQrs([item]); await printRows(rows, LAYOUTS.large, { model: true, cart: false, school: "" }); }
    catch (error) { notify(errText(error), "error"); }
  }
  return { open, printOne, qrDataURL };
})();
