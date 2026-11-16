/* Equipa — Carrinhos: quadro, página de cada carrinho e editor.
 * Um computador fica em um carrinho só; gravação pela RPC equipa_save_cart. */
"use strict";

/* ---------- Carrinhos ---------- */
/** Situação de cada computador para os carrinhos (com quem está, atrasado ou não). */
async function cartContext(force = false) {
  const [map, devices] = await Promise.all([loadCartMap(force), loadDevices({ force })]);
  const holder = new Map();
  try { (await loadOpenWithdrawals()).forEach(w => w.pending.forEach(i => holder.set(String(i.equipment_id), w))); } catch {}
  const byCode = new Map(devices.map(d => [norm(d.code), d]));
  const st = d => !d ? "unavailable" : d.status === "in_use" ? (holder.get(String(d.id))?.overdue ? "overdue" : "in_use") : d.status;
  return { map, devices, byCode, holder, st };
}
async function renderCarts(gen) {
  if (state.carts.open) return renderCartDetail(gen, state.carts.open);
  const admin = isAdmin();
  qs("#view").innerHTML = `<div class="toolbar"><label class="search">${icon("search", 18)}<input id="cr-q" type="search" value="${esc(state.carts.q)}" placeholder="Carrinho, local ou número de computador" autocomplete="off"></label><div class="toolbar-end">${state.profile?.role !== "student" ? `<button class="btn" id="cr-sheet" type="button">${icon("sheet", 18)}<span>Planilha</span></button>` : ""}${admin ? `<button class="btn btn-primary" id="cr-new" type="button">${icon("plus", 18)}<span>Novo carrinho</span></button>` : ""}</div></div><div id="cr-list">${loadingState()}</div>`;
  qs("#cr-new")?.addEventListener("click", () => openCartForm());
  qs("#cr-sheet")?.addEventListener("click", exportEquipments);
  let ctx;
  try { ctx = await cartContext(true); } catch (error) { if (alive(gen)) qs("#cr-list").innerHTML = emptyState("Erro ao carregar.", errText(error), "warn"); return; }
  if (!alive(gen)) return;
  const { map, devices, byCode, st } = ctx;
  const loose = devices.filter(d => !map.byCode.has(norm(d.code)));
  setTitle("Carrinhos", `${map.carts.length} carrinho(s) · ${map.byCode.size} computador(es) com carrinho`);
  const paint = () => {
    const rows = smartFilter(map.carts, state.carts.q, c => [cartName(c), `carrinho ${c.cart_number}`, c.location_text, ...(c.equipment_codes || [])]);
    const card = c => {
      const ds = (c.equipment_codes || []).map(code => byCode.get(norm(code))).filter(Boolean).sort((a, b) => numSort(a.code, b.code));
      const n = k => ds.filter(d => st(d) === k).length, inside = n("available"), out = n("in_use") + n("overdue");
      const cap = Number(c.capacity || 0) || ds.length, pct = k => cap ? (n(k) * 100 / cap) : 0;
      const models = [...ds.reduce((a, d) => a.set(modelKey(d), (a.get(modelKey(d)) || 0) + 1), new Map())];
      return `<button type="button" class="cart-card2" data-open="${esc(c.cart_id)}">
        <span class="cc-top"><span class="cart-ic">${icon("cart", 22)}</span><span class="cc-name"><b>${esc(cartName(c))}</b><small>${esc(c.location_text || "Local não informado")}</small></span><span class="cc-num"><b>${inside}</b><small>de ${ds.length} guardados</small></span></span>
        <span class="cc-bar"><i class="s-available" style="width:${pct("available")}%"></i><i class="s-in_use" style="width:${pct("in_use")}%"></i><i class="s-overdue" style="width:${pct("overdue")}%"></i><i class="s-maintenance" style="width:${pct("maintenance")}%"></i></span>
        <span class="cc-dots">${ds.map(d => `<i class="s-${st(d)}" title="Nº ${esc(d.code)} · ${esc(statusLabel(st(d)))}"></i>`).join("")}${Array.from({ length: Math.max(0, Math.min(60, cap - ds.length)) }, () => `<i class="empty"></i>`).join("")}</span>
        <span class="cc-foot">${out ? `<span class="lg s-in_use">${out} fora</span>` : `<span class="lg s-available">todos guardados</span>`}${n("overdue") ? `<span class="lg s-overdue">${n("overdue")} atrasado(s)</span>` : ""}${n("maintenance") ? `<span class="lg s-maintenance">${n("maintenance")} manutenção</span>` : ""}<span class="cc-models">${esc(models.map(([k, v]) => `${v}× ${k}`).join(" · "))}</span></span>
      </button>`;
    };
    qs("#cr-list").innerHTML = (rows.length ? `<div class="cart-board2">${rows.map(card).join("")}</div>` : emptyState("Nenhum carrinho.", admin ? "Crie um carrinho e escolha os computadores que ficam nele." : "", "cart"))
      + (loose.length && !state.carts.q ? `<div class="callout">${icon("laptop", 18)}<span><b>${loose.length} computador(es) sem carrinho</b> — ${esc(groupDevices(loose).map(g => `${g.items.length}× ${g.model}`).join(" · "))}</span>${admin ? `<button class="btn btn-sm" type="button" id="cr-loose">Montar carrinho com eles</button>` : ""}</div>` : "");
    qsa("[data-open]").forEach(b => b.addEventListener("click", () => { state.carts.open = b.dataset.open; renderCarts(++viewGen); }));
    qsa("[data-open]").forEach(b => b.addEventListener("contextmenu", e => {
      e.preventDefault();
      const c = map.carts.find(x => String(x.cart_id) === b.dataset.open); if (!c) return;
      const ds = (c.equipment_codes || []).map(code => byCode.get(norm(code))).filter(Boolean), free = ds.filter(d => st(d) === "available");
      openContextMenu(e.clientX, e.clientY, { title: cartName(c), items: [
        { label: "Abrir carrinho", ic: "cart", action: () => { state.carts.open = c.cart_id; renderCarts(++viewGen); } },
        { label: free.length ? `Retirar os ${free.length} guardados` : "Retirar (nenhum livre)", ic: "out", disabled: !free.length, action: () => openCounter(free, { step: "ticket" }) },
        { label: `Etiquetas QR (${ds.length})`, ic: "qr", action: () => EquipaLabels.open(ds, `Etiquetas · ${cartName(c)}`) },
        ...(admin ? [{ label: "Editar", ic: "edit", action: () => openCartForm({ id: c.cart_id, number: c.cart_number, name: c.cart_name, location_text: c.location_text, capacity: c.capacity, notes: c.notes, equipment_codes: c.equipment_codes || [] }) },
          "-", { label: "Excluir carrinho", ic: "trash", danger: true, action: () => deleteCart(c) }] : [])
      ] });
    }));
    qs("#cr-loose")?.addEventListener("click", () => openCartForm({ equipment_codes: [] }));
  };
  let t; qs("#cr-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { state.carts.q = e.target.value; paint(); }, 150); });
  paint();
}

/** Exclui o carrinho inteiro. Os computadores continuam no inventário, "sem carrinho". */
async function deleteCart(c) {
  const n = (c.equipment_codes || []).length;
  if (!await confirmAction({ title: `Excluir ${cartName(c)}?`, message: `${n ? `Os ${n} computador(es) dele ficam “sem carrinho” e continuam no inventário. ` : ""}O histórico de retiradas é preservado.`, confirmText: "Excluir carrinho", danger: true })) return;
  let { data, error } = await supabase.from("equipment_carts").delete().eq("id", Number(c.cart_id));
  // Sem permissão o banco apaga 0 linhas sem erro; com registros ligados, dá erro. Nos dois casos, desativa.
  if (error || !(data || []).length) ({ data, error } = await supabase.from("equipment_carts").update({ is_active: false }).eq("id", Number(c.cart_id)));
  if (error) return notify(errText(error), "error");
  if (!(data || []).length) return notify("O banco não permitiu excluir este carrinho. Confira se sua conta é de administrador.", "error");
  notify(`${cartName(c)} excluído.`, "success");
  state.carts.open = null; cartMapCache.at = 0; invalidateData(); if (state.view === "carts") renderCarts(++viewGen);
}
/** Página do carrinho: cada vaga mostra qual computador do inventário está nela. */
async function renderCartDetail(gen, cartId) {
  const admin = isAdmin();
  qs("#view").innerHTML = loadingState();
  let ctx;
  try { ctx = await cartContext(true); } catch (error) { if (alive(gen)) qs("#view").innerHTML = emptyState("Erro ao carregar.", errText(error), "warn"); return; }
  if (!alive(gen)) return;
  const { map, byCode, holder, st } = ctx;
  const cart = map.carts.find(c => String(c.cart_id) === String(cartId));
  if (!cart) { state.carts.open = null; return renderCarts(++viewGen); }
  const ds = (cart.equipment_codes || []).map(code => byCode.get(norm(code))).filter(Boolean).sort((a, b) => numSort(a.code, b.code));
  const byId = new Map(ds.map(d => [String(d.id), d]));
  const sel = new Set(), ui = { filter: "", focus: null };
  const cap = Number(cart.capacity || 0);
  const n = k => ds.filter(d => st(d) === k).length;
  setTitle(cartName(cart), `${cart.location_text || "Local não informado"}${cap ? ` · ${cap} vagas` : ""}`);
  qs("#view").innerHTML = `<div class="cd-head"><button class="btn btn-ghost" type="button" id="cd-back">${icon("chevron", 16)}<span>Carrinhos</span></button>
      <div class="toolbar-end">${admin ? `<button class="btn" type="button" id="cd-edit">${icon("edit", 17)}<span>Editar</span></button>` : ""}<button class="btn" type="button" id="cd-audit">${icon("camera", 17)}<span>Conferir</span></button><button class="btn" type="button" id="cd-qr">${icon("qr", 17)}<span>QR</span></button></div></div>
    <div class="board-sum board-sum-5"><div><b>${n("available")}</b><span>guardados</span></div><div><b>${n("in_use") + n("overdue")}</b><span>fora</span></div><div class="${n("overdue") ? "is-late" : ""}"><b>${n("overdue")}</b><span>atrasados</span></div><div><b>${n("maintenance")}</b><span>manutenção</span></div><div><b>${cap ? Math.max(0, cap - ds.length) : "—"}</b><span>vagas livres</span></div></div>
    <div class="cd-grid">
      <section class="card cd-slots-card">
        <header class="card-head"><div class="chips chips-tight" id="cd-filter">${[["", "Todos", ds.length], ["available", "Guardados", n("available")], ["out", "Fora", n("in_use") + n("overdue")], ["maintenance", "Manutenção", n("maintenance")]].map(([k, l, c]) => `<button type="button" class="chip ${k === "" ? "on" : ""}" data-f="${k}">${l}<b>${c}</b></button>`).join("")}</div>
          <span class="hint">${icon("select", 14)} Clique para marcar · arraste para marcar vários · clique fora para limpar</span></header>
        <div class="slots cd-slots" id="cd-slots"></div>
      </section>
      <aside class="cd-panel" id="cd-panel"></aside>
    </div>`;
  const slotsHost = qs("#cd-slots"), panel = qs("#cd-panel");
  const visible = () => ds.filter(d => !ui.filter || (ui.filter === "out" ? ["in_use", "overdue"].includes(st(d)) : st(d) === ui.filter));
  const paintSlots = () => {
    slotsHost.innerHTML = visible().map(d => `<button type="button" class="slot slot-xl s-${esc(st(d))} ${sel.has(String(d.id)) ? "picked" : ""}" data-id="${esc(d.id)}" title="Nº ${esc(d.code)} · ${esc(d.model || "")}">${icon("laptop", 20)}<span>${esc(d.code)}</span><small>${esc(st(d) === "available" ? "guardado" : statusLabel(st(d)).toLowerCase())}</small></button>`).join("") || `<p class="lane-empty">Nenhum computador com esse filtro.</p>`;
  };
  const info = d => {
    const h = holder.get(String(d.id));
    const rows = [["Modelo", [d.brand !== "Não informado" ? d.brand : "", d.model].filter(Boolean).join(" ")], ["Tipo", schoolGroupLabel(d.school_group)], ["Plataforma", [d.operating_system, d.processor, d.ram_gb ? `${d.ram_gb} GB` : ""].filter(Boolean).join(" · ")], ["Nº de série", d.serial_number], ["Patrimônio", d.asset_tag], ["Local cadastrado", d.location_text], ...EquipaSettings.describe(d.specs)].filter(([, v]) => v && v !== "Sem tipo");
    return `<div class="cd-pc"><div class="dev-status s-${esc(st(d))}">${groupIcon(d.school_group, 22)}<div><b>Nº ${esc(d.code)} · ${esc(st(d) === "available" ? "No carrinho" : statusLabel(st(d)))}</b><small>${h ? `Com ${esc(h.custodian_name || h.responsible_name || "não identificado")} · ${esc([h.class_name, h.destination].filter(Boolean).join(" · "))} · ${esc(relativeDue(h.due_at))}` : esc(d.model || "")}</small></div></div>
      <dl class="info info-1">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <div class="row-wrap"><button class="btn btn-sm" type="button" data-act="open">${icon("laptop", 15)}Abrir ficha</button>${h ? `<button class="btn btn-sm" type="button" data-act="ticket">${icon("board", 15)}Ver comanda</button>` : ""}</div></div>`;
  };
  const paintPanel = () => {
    const list = [...sel].map(id => byId.get(id)).filter(Boolean).sort((a, b) => numSort(a.code, b.code));
    const free = list.filter(d => st(d) === "available");
    if (!list.length) {
      const models = [...ds.reduce((a, d) => a.set(modelKey(d), (a.get(modelKey(d)) || 0) + 1), new Map())];
      panel.innerHTML = `<h3>Neste carrinho</h3><div class="ce-mix">${models.map(([k, v]) => `<span>${icon("laptop", 13)} ${v} × ${esc(k)}</span>`).join("") || "<span>Vazio</span>"}</div>
        <p class="hint">${icon("info", 14)} Clique numa vaga para ver qual computador do inventário está nela (modelo, série, patrimônio, com quem está).</p>
        <div class="legend"><span class="lg s-available">Guardado</span><span class="lg s-in_use">Fora</span><span class="lg s-overdue">Atrasado</span><span class="lg s-maintenance">Manutenção</span></div>
        ${n("available") ? `<button class="btn btn-primary btn-block" type="button" data-act="out-all">${icon("out", 17)}Retirar do carrinho (${n("available")} livres)</button>` : ""}`;
    } else if (list.length === 1) {
      panel.innerHTML = info(list[0]) + actions(list, free);
    } else {
      panel.innerHTML = `<h3>${list.length} selecionados</h3><div class="ce-chips">${list.map(d => `<span class="t-item s-${esc(st(d))}">${icon("laptop", 13)}${esc(d.code)}</span>`).join("")}</div>${actions(list, free)}`;
    }
    const on = (a, fn) => qs(`[data-act="${a}"]`, panel)?.addEventListener("click", fn);
    on("open", () => openDevice(list[0].id));
    on("ticket", () => openWithdrawal(holder.get(String(list[0].id)).id));
    on("out", () => openCounter(free, { step: "ticket" }));
    on("out-all", () => openCounter(ds.filter(d => st(d) === "available"), { step: "ticket" }));
    on("labels", () => EquipaLabels.open(list, `Etiquetas · ${cartName(cart)}`));
    on("remove", () => removeFromCart(list));
    on("move", () => moveToCart(list));
    on("clear", () => { sel.clear(); paintSlots(); paintPanel(); });
  };
  const actions = (list, free) => `<div class="cd-actions">
      ${free.length ? `<button class="btn btn-primary" type="button" data-act="out">${icon("out", 16)}Retirar ${free.length}</button>` : ""}
      ${admin ? `<button class="btn" type="button" data-act="move">${icon("cart", 16)}Mover para outro carrinho</button><button class="btn btn-ghost danger" type="button" data-act="remove">${icon("trash", 16)}Tirar do carrinho</button>` : ""}
      ${admin ? `<button class="btn" type="button" data-act="labels">${icon("tag", 16)}Etiquetas</button>` : ""}
      ${list.length > 1 ? `<button class="btn btn-ghost" type="button" data-act="clear">Limpar seleção</button>` : ""}</div>`;
  const save = async (target, codes, move) => {
    let res = await supabase.rpc("equipa_save_cart", { p_cart_id: Number(target.cart_id), p_number: Number(target.cart_number), p_name: target.cart_name || null, p_equipment_codes: codes, p_location_text: target.location_text || null, p_capacity: target.capacity || null, p_notes: target.notes || null, p_move: move });
    if (res.error) throw res.error;
  };
  async function removeFromCart(list) {
    const ids = new Set(list.map(d => String(d.id)));
    const rest = ds.filter(d => !ids.has(String(d.id))).map(d => d.code);
    const msg = `Nº ${list.slice(0, 12).map(d => d.code).join(", ")}${list.length > 12 ? "…" : ""} saem deste carrinho e ficam “sem carrinho”. Eles continuam cadastrados no inventário.`;
    if (!rest.length) {
      if (!await confirmAction({ title: "Esvaziar o carrinho?", message: `${msg} O carrinho ficará vazio e será desativado (o número e o QR podem ser reaproveitados).`, confirmText: "Esvaziar e desativar", danger: true })) return;
      const { error } = await supabase.from("equipment_carts").update({ is_active: false }).eq("id", Number(cart.cart_id));
      if (error) return notify(errText(error), "error");
      notify("Carrinho esvaziado e desativado.", "success"); state.carts.open = null; cartMapCache.at = 0; return renderCarts(++viewGen);
    }
    if (!await confirmAction({ title: `Tirar ${list.length} do carrinho?`, message: msg, confirmText: `Tirar ${list.length}`, danger: true })) return;
    try { await save(cart, rest, false); notify(`${list.length} computador(es) tirado(s) do carrinho.`, "success"); cartMapCache.at = 0; renderCarts(++viewGen); }
    catch (error) { notify(errText(error), "error"); }
  }
  async function moveToCart(list) {
    const others = map.carts.filter(c => String(c.cart_id) !== String(cart.cart_id));
    if (!others.length) return notify("Não há outro carrinho. Crie um primeiro.", "warning");
    const m = openSheet({ size: "sm", title: `Mover ${list.length} para…`, body: `<div class="menu">${others.map((c, i) => { const used = (c.equipment_codes || []).length, room = c.capacity ? c.capacity - used : null; return `<button type="button" class="menu-item" data-c="${i}" ${room !== null && room < list.length ? "disabled" : ""}>${icon("cart", 20)}<span><b>${esc(cartName(c))}</b><small>${used} computador(es)${room !== null ? ` · ${room} vaga(s) livre(s)` : ""} · ${esc(c.location_text || "")}</small></span>${icon("chevron", 16)}</button>`; }).join("")}</div>` });
    qsa("[data-c]", m).forEach(b => b.addEventListener("click", async () => {
      const target = others[Number(b.dataset.c)]; setBusy(b, true, "Movendo…");
      try {
        await save(target, [...new Set([...(target.equipment_codes || []), ...list.map(d => d.code)])], true);
        m.close(); notify(`${list.length} computador(es) movido(s) para ${cartName(target)}.`, "success"); cartMapCache.at = 0; renderCarts(++viewGen);
      } catch (error) { setBusy(b, false); notify(errText(error), "error"); }
    }));
  }
  slotsHost.addEventListener("click", e => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    const id = b.dataset.id;
    // Clique marca/desmarca e soma à seleção (com 1 marcado, o painel mostra a ficha dele).
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    paintSlots(); paintPanel();
  });
  slotsHost.addEventListener("contextmenu", e => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    e.preventDefault();
    if (!sel.has(b.dataset.id)) { sel.clear(); sel.add(b.dataset.id); }
    paintSlots(); paintPanel();
    const list = [...sel].map(id => byId.get(id)).filter(Boolean).sort((a, c) => numSort(a.code, c.code)), free = list.filter(d => st(d) === "available");
    openContextMenu(e.clientX, e.clientY, { title: list.length === 1 ? `Nº ${list[0].code}` : `${list.length} selecionados`, items: [
      ...(list.length === 1 ? [{ label: "Abrir ficha", ic: "laptop", action: () => openDevice(list[0].id) }] : []),
      { label: free.length ? `Retirar ${free.length}` : "Retirar (nenhum livre)", ic: "out", disabled: !free.length, action: () => openCounter(free, { step: "ticket" }) },
      { label: `Etiquetas QR (${list.length})`, ic: "qr", action: () => EquipaLabels.open(list) },
      ...(admin ? ["-", { label: "Mover para outro carrinho", ic: "cart", action: () => moveToCart(list) },
        { label: `Tirar do carrinho (${list.length})`, ic: "x", action: () => removeFromCart(list) },
        { label: `Excluir do inventário (${list.length})`, ic: "trash", danger: true, action: () => deleteDevices(list, () => { cartMapCache.at = 0; renderCarts(++viewGen); }) }] : [])
    ] });
  });
  enableMarquee(slotsHost, { onSelect: (els, { additive }) => { const ids = els.map(el => el.dataset.id); if (!additive) sel.clear(); ids.forEach(id => sel.add(id)); paintSlots(); paintPanel(); } });
  clearOnOutsideClick({ keep: "#cd-slots [data-id], #cd-panel", alive: () => slotsHost.isConnected, hasSelection: () => sel.size > 0, clear: () => { sel.clear(); paintSlots(); paintPanel(); } });
  qsa("[data-f]").forEach(b => b.addEventListener("click", () => { ui.filter = b.dataset.f; qsa("[data-f]").forEach(x => x.classList.toggle("on", x === b)); paintSlots(); }));
  qs("#cd-back").addEventListener("click", () => { state.carts.open = null; renderCarts(++viewGen); });
  qs("#cd-edit")?.addEventListener("click", () => openCartForm({ id: cart.cart_id, number: cart.cart_number, name: cart.cart_name, location_text: cart.location_text, capacity: cart.capacity, notes: cart.notes, equipment_codes: cart.equipment_codes || [] }));
  qs("#cd-qr").addEventListener("click", () => openQr(cart.qr_token, cartName(cart), "Carrinho"));
  qs("#cd-audit").addEventListener("click", () => openCartAudit(cart, byCode));
  document.addEventListener("keydown", function esc(e) { if (!qs("#cd-slots")) return document.removeEventListener("keydown", esc); if (e.key === "Escape" && !qs(".overlay") && sel.size) { sel.clear(); paintSlots(); paintPanel(); } });
  paintSlots(); paintPanel();
}
/** Conferência: aponte a câmera (ou fotografe o carrinho) e veja o que falta. */
function openCartAudit(cart, byCode) {
  const expected = (cart.equipment_codes || []).slice().sort(numSort);
  const seen = new Set();
  EquipaCamera.open({ mode: "audit", title: `Conferir ${cartName(cart)}`, doneLabel: "Ver resultado", expected,
    onPick: d => { if (!expected.some(c => norm(c) === norm(d.code))) return { ok: false, text: `Nº ${d.code} não é deste carrinho` }; const novo = !seen.has(norm(d.code)); seen.add(norm(d.code)); return { ok: true, text: novo ? `Nº ${d.code} conferido (${seen.size}/${expected.length})` : `Nº ${d.code} já conferido`, progress: { seen: [...seen], expected } }; },
    onClose: () => {
      const missing = expected.filter(c => !seen.has(norm(c)));
      const m = openSheet({ size: "md", title: `Conferência · ${esc(cartName(cart))}`, subtitle: `${seen.size} de ${expected.length} encontrados`,
        body: `<div class="slots">${expected.map(c => { const d = byCode.get(norm(c)); const ok = seen.has(norm(c)); return `<button type="button" class="slot ${ok ? "r-returned" : d?.status === "in_use" ? "s-in_use" : "r-missing"}" ${d ? `data-dev="${esc(d.id)}"` : ""}>${icon("laptop", 20)}<span>${esc(c)}</span><small>${ok ? "conferido" : d?.status === "in_use" ? "emprestado" : "faltando"}</small></button>`; }).join("")}</div>
          ${missing.length ? `<div class="callout callout-warn">${icon("warn", 16)}<span><b>${missing.length} não conferido(s):</b> ${esc(missing.join(", "))}. Os marcados “emprestado” estão numa retirada aberta.</span></div>` : `<div class="callout callout-ok">${icon("check", 16)}<span>Carrinho completo.</span></div>`}`,
        foot: `<button class="btn btn-primary" type="button" data-close>Fechar</button>` });
      qsa("[data-dev]", m).forEach(b => b.addEventListener("click", () => { m.close(); openDevice(b.dataset.dev); }));
    } });
}
/** Aberto pelo QR do carrinho ou por um atalho: vai para a página do carrinho. */
async function openCart(token) {
  try {
    const map = await loadCartMap(true);
    const c = map.carts.find(x => x.qr_token === token);
    if (!c) return notify("Carrinho não encontrado ou desativado.", "warning");
    qsa(".overlay").forEach(o => o.close ? o.close() : o.remove());
    state.carts.open = c.cart_id;
    if (state.view === "carts") renderCarts(++viewGen); else navigate("carts");
  } catch (error) { notify(errText(error), "error"); }
}
async function openCartForm(rec = null) {
  const editing = !!rec?.id;
  const m = openSheet({ size: "full", className: "cart-editor", title: editing ? `Editar ${esc(cartName({ cart_name: rec.name, cart_number: rec.number }))}` : "Novo carrinho", subtitle: "Escolha entre os computadores registrados. Toque para pôr ou tirar.", body: loadingState("Carregando computadores…") });
  let devices, map;
  try { [devices, map] = await Promise.all([loadDevices({ force: true }), loadCartMap(true)]); }
  catch (error) { setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); return; }
  if (!m.isConnected) return;
  const nextNumber = Math.max(0, ...map.carts.map(c => Number(c.cart_number) || 0)) + 1;
  const byId = new Map(devices.map(d => [String(d.id), d]));
  const byCode = new Map(devices.map(d => [norm(d.code), d]));
  const myId = String(rec?.id ?? "");
  const otherCart = d => { const c = map.byCode.get(norm(d.code)); return c && String(c.cart_id) !== myId ? c : null; };
  // Seleção atual: os do carrinho (edição) ou os sugeridos (ex.: vindos do cadastro).
  const chosen = new Set((rec?.equipment_codes || []).map(c => byCode.get(norm(c))?.id).filter(Boolean).map(String));
  const ui = { q: "", by: "model", show: "free", open: new Set() };
  const rmSel = new Set();

  setSheet(m, { body: `<div class="ce-grid">
      <section class="ce-pick">
        <div class="toolbar toolbar-tight">
          <label class="search">${icon("search", 18)}<input id="ce-q" type="search" placeholder="Número ou modelo" autocomplete="off"></label>
          <div class="segmented" role="group" aria-label="Agrupar"><button type="button" data-by="model" class="on">${icon("laptop", 15)}<span>Modelo</span></button><button type="button" data-by="type">${icon("layers", 15)}<span>Tipo</span></button></div>
          <div class="segmented" role="group" aria-label="Mostrar"><button type="button" data-show="free" class="on">Sem carrinho</button><button type="button" data-show="all">Todos</button></div>
        </div>
        <div id="ce-groups"></div>
      </section>
      <aside class="ce-side">
        <form id="cart-form" class="form" autocomplete="off">
          <div class="grid-2"><label class="field"><span>Número *</span><input name="number" type="number" min="1" required value="${esc(rec?.number || nextNumber)}"></label><label class="field"><span>Vagas</span><input name="capacity" type="number" min="1" max="200" value="${esc(rec?.capacity || "")}" placeholder="Sem limite"></label></div>
          <label class="field"><span>Nome</span><input name="name" maxlength="120" value="${esc(rec?.name || "")}" placeholder="Ex.: Carrinho azul"></label>
          <label class="field"><span>Onde fica</span><input name="location_text" maxlength="160" value="${esc(rec?.location_text || "")}" placeholder="Ex.: Sala maker" list="cart-locs"></label>
          ${EquipaSettings.locationDatalist("cart-locs", devices.map(d => d.location_text))}
        </form>
        <div class="ce-sum" id="ce-sum"></div>
        <div class="ce-in"><div class="section-head"><h3>No carrinho</h3><span class="row-wrap"><button type="button" class="btn btn-sm btn-ghost danger" id="ce-rm-sel" hidden></button><button type="button" class="link" id="ce-clear">Tirar todos</button></span></div><p class="hint">Clique num número para tirar · arraste por cima de vários para marcar.</p><div class="ce-chips" id="ce-in"></div></div>
        <label class="check"><input type="checkbox" id="ce-setloc" checked><span>Atualizar o local dos computadores para o local do carrinho</span></label>
        <label class="field"><span>Observações</span><textarea name="notes" form="cart-form" maxlength="1200" rows="2">${esc(rec?.notes || "")}</textarea></label>
      </aside></div>`,
    foot: `${editing ? `<button class="btn btn-ghost danger" type="button" id="cart-off">Desativar</button>` : ""}<span class="foot-info" id="ce-foot"></span><button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary btn-lg" type="submit" form="cart-form" id="ce-save">Salvar carrinho</button>` });

  const form = qs("#cart-form", m), groupsHost = qs("#ce-groups", m);
  const groupKey = d => ui.by === "type" ? schoolGroupLabel(d.school_group) : modelKey(d);
  const free = d => !otherCart(d) && !chosen.has(String(d.id));
  const add = ids => { const cap = Number(form.elements.capacity.value) || 0; let n = 0; for (const id of ids) { if (cap && chosen.size >= cap) { notify(`O carrinho tem ${cap} vagas.`, "warning"); break; } if (!chosen.has(id)) { chosen.add(id); n++; } } return n; };

  const paintSide = () => {
    const list = [...chosen].map(id => byId.get(id)).filter(Boolean).sort((a, b) => numSort(a.code, b.code));
    const cap = Number(form.elements.capacity.value) || 0;
    const fromOther = list.filter(otherCart), out = list.filter(d => d.status === "in_use"), fix = list.filter(d => d.status === "maintenance");
    const count = (arr, f) => { const c = new Map(); arr.forEach(d => { const k = f(d) || "—"; c.set(k, (c.get(k) || 0) + 1); }); return [...c].sort((a, b) => b[1] - a[1]); };
    const types = count(list, d => modelKey(d)), oss = count(list, d => d.operating_system);
    for (const id of [...rmSel]) if (!chosen.has(id)) rmSel.delete(id);
    const rb = qs("#ce-rm-sel", m); rb.hidden = !rmSel.size; rb.textContent = `Tirar ${rmSel.size} marcados`;
    qs("#ce-in", m).innerHTML = list.length ? list.map(d => `<button type="button" class="t-item t-item-x ${otherCart(d) ? "warn" : ""} ${rmSel.has(String(d.id)) ? "sel" : ""}" data-rm="${esc(d.id)}" title="Tirar Nº ${esc(d.code)}">${icon("laptop", 13)}${esc(d.code)}<i>${icon("x", 11)}</i></button>`).join("") : `<p class="lane-empty">Nenhum computador ainda. Escolha à esquerda.</p>`;
    qs("#ce-sum", m).innerHTML = `<div class="ce-cap ${cap && list.length > cap ? "over" : ""}"><b>${list.length}</b><span>${cap ? `de ${cap} vagas${list.length < cap ? ` · faltam ${cap - list.length}` : list.length > cap ? ` · ${list.length - cap} a mais` : " · completo"}` : "computadores"}</span>${cap ? `<i style="width:${Math.min(100, Math.round(list.length * 100 / cap))}%"></i>` : ""}</div>
      ${types.length ? `<div class="ce-mix">${types.map(([k, n]) => `<span>${icon("laptop", 13)} ${n} × ${esc(k)}</span>`).join("")}</div>` : ""}
      ${oss.length > 1 ? `<p class="hint">${icon("info", 14)} Plataformas misturadas: ${esc(oss.map(([k, n]) => `${n} ${k}`).join(", "))}.</p>` : ""}
      ${fromOther.length ? `<p class="hint warn">${icon("cart", 14)} ${fromOther.length} sairão de outro carrinho: ${esc(fromOther.slice(0, 8).map(d => `${d.code} (${cartName(otherCart(d))})`).join(", "))}${fromOther.length > 8 ? "…" : ""}.</p>` : ""}
      ${out.length ? `<p class="hint">${icon("clock", 14)} ${out.length} estão emprestados agora (${esc(out.slice(0, 6).map(d => d.code).join(", "))}); voltam para este carrinho na devolução.</p>` : ""}
      ${fix.length ? `<p class="hint">${icon("tool", 14)} ${fix.length} em manutenção.</p>` : ""}`;
    qs("#ce-foot", m).textContent = list.length ? `${list.length} no carrinho` : "Carrinho vazio";
    qs("#ce-save", m).disabled = !list.length || (cap && list.length > cap);
    qsa("[data-rm]", m).forEach(b => b.addEventListener("click", () => { chosen.delete(b.dataset.rm); paint(); }));
  };
  const paint = () => {
    const vis = smartFilter(devices, ui.q, d => [d.code, d.model, schoolGroupLabel(d.school_group), d.location_text]).filter(d => ui.show === "all" || free(d) || chosen.has(String(d.id)));
    const groups = new Map();
    vis.forEach(d => { const k = groupKey(d); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
    const list = [...groups].map(([k, items]) => ({ k, items: items.sort((a, b) => numSort(a.code, b.code)) })).sort((a, b) => b.items.length - a.items.length || numSort(a.k, b.k));
    groupsHost.innerHTML = list.length ? list.map((g, gi) => {
      const nFree = g.items.filter(free).length, nIn = g.items.filter(d => chosen.has(String(d.id))).length, nOther = g.items.filter(d => otherCart(d) && !chosen.has(String(d.id))).length;
      const open = ui.open.has(g.k) || !!ui.q;
      return `<section class="group ce-group ${open ? "" : "collapsed"}" data-g="${gi}">
        <header class="group-head"><button type="button" class="group-toggle" data-toggle>${icon("down", 18)}<span class="group-ic">${groupIcon(g.items[0]?.school_group, 20)}</span><span><b>${esc(g.k)}</b><small>${nFree} sem carrinho${nIn ? ` · ${nIn} neste` : ""}${nOther ? ` · ${nOther} em outro` : ""}</small></span></button>
          <div class="group-actions"><span class="qty"><input type="number" min="1" max="${Math.max(1, nFree)}" placeholder="Qtd." data-qty aria-label="Quantos de ${esc(g.k)}"><button type="button" class="btn btn-sm btn-primary" data-qty-go ${nFree ? "" : "disabled"}>Pôr</button></span><button type="button" class="btn btn-sm" data-all ${nFree ? "" : "disabled"}>Todos (${nFree})</button>${nIn ? `<button type="button" class="btn btn-sm btn-ghost" data-none>Tirar ${nIn}</button>` : ""}</div></header>
        <div class="slots">${g.items.map(d => { const id = String(d.id), on = chosen.has(id), oc = otherCart(d); return `<button type="button" class="slot ${on ? "picked" : oc ? "s-maintenance" : `s-${esc(d.status === "in_use" ? "in_use" : "available")}`}" data-id="${esc(id)}" title="Nº ${esc(d.code)}${oc ? ` · está no ${esc(cartName(oc))}` : ""}">${icon("laptop", 20)}<span>${esc(d.code)}</span>${oc && !on ? `<small>${esc(cartName(oc)).slice(0, 12)}</small>` : ""}</button>`; }).join("")}</div>
      </section>`;
    }).join("") : emptyState(ui.show === "free" ? "Todos os computadores já estão em carrinhos." : "Nada encontrado.", ui.show === "free" ? "Mostre “Todos” para mover de outro carrinho." : "", "laptop");
    qsa("[data-toggle]", groupsHost).forEach(b => b.addEventListener("click", () => { const k = list[Number(b.closest("[data-g]").dataset.g)].k; if (ui.open.has(k)) ui.open.delete(k); else ui.open.add(k); paint(); }));
    qsa("[data-id]", groupsHost).forEach(b => b.addEventListener("click", () => { const id = b.dataset.id; if (chosen.has(id)) chosen.delete(id); else add([id]); paint(); }));
    qsa("[data-all]", groupsHost).forEach(b => b.addEventListener("click", () => { const g = list[Number(b.closest("[data-g]").dataset.g)]; add(g.items.filter(free).map(d => String(d.id))); paint(); }));
    qsa("[data-none]", groupsHost).forEach(b => b.addEventListener("click", () => { const g = list[Number(b.closest("[data-g]").dataset.g)]; g.items.forEach(d => chosen.delete(String(d.id))); paint(); }));
    qsa("[data-qty-go]", groupsHost).forEach(b => b.addEventListener("click", () => {
      const sec = b.closest("[data-g]"), g = list[Number(sec.dataset.g)], want = Number(qs("[data-qty]", sec).value) || 0;
      if (want < 1) return qs("[data-qty]", sec).focus();
      const pool = g.items.filter(free).map(d => String(d.id));
      const n = add(pool.slice(0, want));
      if (n < want) notify(`Só havia ${n} ${g.k} sem carrinho.`, "warning");
      paint();
    }));
    qsa("[data-by]", m).forEach(x => x.classList.toggle("on", x.dataset.by === ui.by));
    qsa("[data-show]", m).forEach(x => x.classList.toggle("on", x.dataset.show === ui.show));
    paintSide();
  };
  qsa("[data-by]", m).forEach(b => b.addEventListener("click", () => { ui.by = b.dataset.by; ui.open.clear(); paint(); }));
  qsa("[data-show]", m).forEach(b => b.addEventListener("click", () => { ui.show = b.dataset.show; paint(); }));
  let t; qs("#ce-q", m).addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { ui.q = e.target.value; paint(); }, 120); });
  qs("#ce-clear", m).addEventListener("click", () => { chosen.clear(); rmSel.clear(); paint(); });
  qs("#ce-rm-sel", m).addEventListener("click", () => { rmSel.forEach(id => chosen.delete(id)); rmSel.clear(); paint(); });
  m.addEventListener("click", e => { if (rmSel.size && !e.target.closest("[data-rm], #ce-rm-sel")) { rmSel.clear(); paintSide(); } });
  // Arrastar sobre as vagas à esquerda: põe todos (ou tira, se todos já estavam).
  enableMarquee(groupsHost, { onSelect: els => { const ids = els.map(el => el.dataset.id); if (ids.every(id => chosen.has(id))) ids.forEach(id => chosen.delete(id)); else add(ids.filter(id => !chosen.has(id))); paint(); } });
  // Arrastar sobre a lista “No carrinho”: marca para tirar de uma vez.
  enableMarquee(qs("#ce-in", m), { item: "[data-rm]", onSelect: (els, { additive }) => { if (!additive) rmSel.clear(); toggleMany(rmSel, els.map(el => el.dataset.rm)); paintSide(); } });
  form.elements.capacity.addEventListener("input", paintSide);
  // Abre o primeiro grupo para ninguém ficar diante de uma lista fechada.
  const first = [...devices].sort((a, b) => numSort(a.code, b.code)).find(free); if (first) ui.open.add(modelKey(first));
  paint();

  qs("#cart-off", m)?.addEventListener("click", async () => {
    if (!await confirmAction({ title: "Desativar carrinho?", message: "Ele sai da operação; os computadores ficam livres para outro carrinho e o histórico é guardado.", confirmText: "Desativar", danger: true })) return;
    const { error } = await supabase.from("equipment_carts").update({ is_active: false }).eq("id", Number(rec.id));
    if (error) return notify(errText(error), "error"); notify("Carrinho desativado.", "success"); m.close(); cartMapCache.at = 0; refreshView();
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(form), b = qs("#ce-save", m);
    const list = [...chosen].map(id => byId.get(id)).filter(Boolean);
    if (!list.length) return notify("Escolha ao menos um computador.", "warning");
    const number = Number(f.get("number"));
    const taken = map.carts.find(c => Number(c.cart_number) === number && String(c.cart_id) !== myId);
    if (taken) return notify(`O número ${number} já é do “${cartName(taken)}”. Use ${nextNumber}.`, "warning");
    const moving = list.filter(otherCart);
    if (moving.length && !await confirmAction({ title: `Mover ${moving.length} computador(es)?`, message: `Eles saem de outro carrinho: ${moving.slice(0, 10).map(d => `${d.code} (${cartName(otherCart(d))})`).join(", ")}${moving.length > 10 ? "…" : ""}.`, confirmText: "Mover para este" })) return;
    const args = { p_cart_id: editing ? Number(rec.id) : null, p_number: number, p_name: clean(f.get("name")) || null, p_equipment_codes: list.map(d => d.code), p_location_text: clean(f.get("location_text")) || null, p_capacity: f.get("capacity") ? Number(f.get("capacity")) : null, p_notes: clean(qs('[name="notes"]', m).value) || null };
    setBusy(b, true, "Salvando…");
    try {
      let res = await supabase.rpc("equipa_save_cart", { ...args, p_move: moving.length > 0 });
      if (res.error && /PGRST202|42883|could not find the function/i.test(`${res.error.code} ${res.error.message}`)) {
        if (moving.length) throw new Error("Para mover computadores entre carrinhos, aplique a migração 1.0 no Supabase.");
        res = await supabase.rpc("save_equipment_cart_v2", args);
      }
      if (res.error) throw res.error;
      if (qs("#ce-setloc", m).checked && args.p_location_text) {
        const ids = list.filter(d => norm(d.location_text) !== norm(args.p_location_text)).map(d => d.id);
        for (let i = 0; i < ids.length; i += 100) await supabase.from("equipments").update({ location_text: args.p_location_text }).in("id", ids.slice(i, i + 100));
      }
      notify(editing ? `Carrinho atualizado: ${list.length} computador(es).` : res.data?.reused ? "Carrinho reativado com o mesmo número e QR." : `Carrinho criado com ${list.length} computador(es).`, "success");
      m.close(); cartMapCache.at = 0; invalidateData(); if (state.view === "carts") refreshView();
    } catch (error) { notify(error.message && !error.code ? error.message : errText(error), "error"); }
    finally { setBusy(b, false); }
  });
}
/** "1-30, 35, NOTE-01-NOTE-05" → lista de números sem repetição. */
function expandCodes(text) {
  const out = [];
  for (const part of String(text).split(/[\n,;]+/).map(clean).filter(Boolean)) {
    const r = part.match(/^([A-Za-z_-]*?)(\d{1,6})\s*(?:-|a|até)\s*\1?(\d{1,6})$/i);
    if (r && Number(r[3]) >= Number(r[2]) && Number(r[3]) - Number(r[2]) < 500) for (let n = Number(r[2]); n <= Number(r[3]); n++) out.push(r[1] + String(n).padStart(r[2].length, "0"));
    else out.push(part);
  }
  return [...new Set(out)];
}
/** Inverso de expandCodes, para mostrar "1-30" em vez de 30 números. */
function compactCodes(codes) {
  const parsed = codes.map(c => { const m = String(c).match(/^(.*?)(\d+)$/); return m ? { p: m[1], n: Number(m[2]), w: m[2].length, raw: c } : { raw: c }; }).sort((a, b) => numSort(a.raw, b.raw));
  const out = []; let run = null;
  const flush = () => { if (!run) return; out.push(run.a === run.b ? run.first : `${run.first}-${run.last}`); run = null; };
  for (const x of parsed) {
    if (x.n == null) { flush(); out.push(x.raw); continue; }
    if (run && run.p === x.p && run.w === x.w && x.n === run.b + 1) { run.b = x.n; run.last = x.raw; }
    else { flush(); run = { p: x.p, w: x.w, a: x.n, b: x.n, first: x.raw, last: x.raw }; }
  }
  flush(); return out.join(", ");
}
