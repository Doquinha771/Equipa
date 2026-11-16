/* Equipa — balcão de retirada.
 * Monta a comanda (por carrinho ou modelo, câmera, arrasto) e registra pela RPC equipa_checkout_with_context. */
"use strict";

/* ---------- Balcão de retirada ---------- */
function schoolClock() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const today = `${p.year}-${p.month}-${p.day}`;
  const t = new Date(`${today}T12:00:00-03:00`); t.setUTCDate(t.getUTCDate() + 1);
  return { today, tomorrow: t.toISOString().slice(0, 10), afterClose: `${p.hour}:${p.minute}` >= "21:05" };
}
const openCheckoutPicker = (pre = []) => openCounter(Array.isArray(pre) ? pre : []);
const openCheckoutForm = items => openCounter(items, { step: "ticket" });
/**
 * Balcão: à esquerda os equipamentos livres (por carrinho ou modelo); à direita a
 * comanda que vai sendo montada. No celular vira duas etapas.
 */
async function openCounter(pre = [], { step = "pick" } = {}) {
  const MAX = 60;
  const basket = new Map(pre.map(x => [String(x.equipment_id || x.id), { ...x, id: x.equipment_id || x.id }]));
  const m = openSheet({ size: "full", className: "counter", title: "Retirar equipamentos", subtitle: "Escolha os números e preencha a comanda.", body: loadingState("Carregando equipamentos livres…") });
  let devices, carts, recent = { classes: [], places: [] };
  try {
    [devices, carts] = await Promise.all([loadDevices({ force: true }), loadCartMap().catch(() => ({ carts: [], byCode: new Map() }))]);
    const { data } = await supabase.from("withdrawals").select("class_name,destination").order("created_at", { ascending: false }).limit(60);
    recent = { classes: [...new Set((data || []).map(x => x.class_name).filter(Boolean))].slice(0, 12), places: EquipaSettings.locationList((data || []).map(x => x.destination)).slice(0, 80) };
  } catch (error) { if (m.isConnected) setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); return; }
  if (!m.isConnected) return;
  const free = devices.filter(d => d.status === "available");
  const ui = { by: carts.carts.length ? "cart" : "model", q: "", step };
  const clock = schoolClock(), canDelegate = state.profile?.role !== "student";
  const chip = (name, value, label, checked) => `<label class="chip-radio"><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  setSheet(m, { body: `<div class="counter-grid" data-step="${ui.step}">
      <section class="counter-pick">
        <div class="toolbar toolbar-tight"><div class="segmented" role="group" aria-label="Agrupar">${carts.carts.length ? `<button type="button" data-by="cart">${icon("cart", 16)}<span>Carrinhos</span></button>` : ""}<button type="button" data-by="model">${icon("laptop", 16)}<span>Modelos</span></button></div>
          <label class="search">${icon("search", 18)}<input id="ct-q" type="search" placeholder="Número, modelo ou local" autocomplete="off"></label>
          <button type="button" class="btn" id="ct-cam">${icon("camera", 18)}<span>Câmera</span></button></div>
        <div id="ct-groups"></div>
      </section>
      <aside class="counter-ticket"><div class="ticket ticket-paper">
        <header class="t-top"><span class="t-no">Comanda</span><span class="t-time" id="ct-n">0 itens</span></header>
        <div class="t-items t-items-edit" id="ct-basket"></div>
        <form id="co-form" class="form" autocomplete="off">
          ${canDelegate ? `<fieldset class="field"><legend>Com quem fica?</legend><div class="segmented"><label><input type="radio" name="holder_mode" value="self" checked><span>Comigo</span></label><label><input type="radio" name="holder_mode" value="delegate"><span>Outra pessoa</span></label></div></fieldset>
          <div class="delegate" hidden><label class="field"><span>Nome completo *</span><input name="holder_name" maxlength="120" placeholder="Ex.: João Pedro da Silva"></label><div class="chips-radio">${chip("holder_role", "student", "Aluno", true)}${chip("holder_role", "teacher", "Professor")}${chip("holder_role", "staff", "Funcionário")}</div></div>` : `<input type="hidden" name="holder_mode" value="self">`}
          <div class="grid-2"><label class="field"><span>Turma ou setor *</span><input name="class_name" required maxlength="120" placeholder="3º A" list="co-classes"></label><label class="field"><span>Onde *</span><input name="destination" required maxlength="160" placeholder="Sala 12" list="co-places"></label></div>
          <datalist id="co-classes">${recent.classes.map(x => `<option value="${esc(x)}">`).join("")}</datalist><datalist id="co-places">${recent.places.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
          <fieldset class="field"><legend>Para quê</legend><div class="chips-radio">${chip("purpose", "lesson", "Aula", true)}${chip("purpose", "assessment", "Avaliação")}${chip("purpose", "project", "Projeto")}${chip("purpose", "support", "Suporte")}${chip("purpose", "other", "Outro")}</div></fieldset>
          <label class="field purpose-other" hidden><span>Qual? *</span><input name="purpose_details" maxlength="240"></label>
          <fieldset class="field"><legend>Devolve até</legend><div class="chips-radio">${clock.afterClose ? "" : chip("due", "today", "Hoje 21h15", true)}${chip("due", "tomorrow", "Amanhã 21h15", clock.afterClose)}${chip("due", "custom", "Outra data")}</div></fieldset>
          <label class="field due-custom" hidden><span>Data e hora (até 21h15)</span><input name="due_at" type="datetime-local" min="${localDateTimeValue(new Date(Date.now() + 6 * 60000))}" max="${localDateTimeValue(new Date(Date.now() + 30 * 86400000))}" value="${clock.tomorrow}T21:15"></label>
        </form>
      </div></aside>
    </div>`,
    foot: `<button type="button" class="btn counter-back" id="ct-to-pick">${icon("plus", 17)}<span>Adicionar mais</span></button><span class="foot-info" id="ct-foot-n"></span><button type="button" class="btn btn-primary counter-next" id="ct-to-ticket">Ver comanda</button><button type="submit" form="co-form" class="btn btn-primary btn-lg counter-go" id="ct-go">Confirmar retirada</button>` });
  const groupsHost = qs("#ct-groups", m), basketHost = qs("#ct-basket", m), grid = qs(".counter-grid", m), form = qs("#co-form", m);
  const setStep = s => { ui.step = s; grid.dataset.step = s; m.querySelector(".sheet").dataset.step = s; };
  setStep(ui.step);
  const paintBasket = () => {
    const list = [...basket.values()].sort((a, b) => numSort(a.code, b.code)), n = list.length;
    basketHost.innerHTML = n ? list.map(d => `<button type="button" class="t-item t-item-x" data-rm="${esc(d.id)}" title="Remover">${icon("laptop", 13)}${esc(d.code)}<i>${icon("x", 11)}</i></button>`).join("") : `<p class="lane-empty">Toque nos números à esquerda${isMobile() ? "" : ""} ou use a câmera.</p>`;
    qs("#ct-n", m).textContent = `${n} ${n === 1 ? "item" : "itens"}`;
    qs("#ct-foot-n", m).textContent = n ? `${n} na comanda` : "Comanda vazia";
    qs("#ct-go", m).disabled = !n; qs("#ct-to-ticket", m).disabled = !n;
    qs("#ct-to-ticket", m).textContent = n ? `Ver comanda (${n})` : "Ver comanda";
    qsa("[data-rm]", basketHost).forEach(b => b.addEventListener("click", () => { basket.delete(b.dataset.rm); paintBasket(); paintGroups(); }));
  };
  const add = (d, on = true) => { const id = String(d.id); if (on && !basket.has(id)) { if (basket.size >= MAX) { notify(`Até ${MAX} por retirada.`, "warning"); return false; } basket.set(id, d); } else if (!on) basket.delete(id); return true; };
  const paintGroups = () => {
    const vis = smartFilter(free, ui.q, d => [d.code, d.model, d.location_text, cartName(carts.byCode.get(norm(d.code)))]);
    let groups;
    if (ui.by === "cart") {
      const map = new Map();
      vis.forEach(d => { const c = carts.byCode.get(norm(d.code)); const k = c ? cartName(c) : "Sem carrinho"; if (!map.has(k)) map.set(k, { title: k, sub: c?.location_text || "", ic: c ? "cart" : "laptop", items: [] }); map.get(k).items.push(d); });
      groups = [...map.values()].sort((a, b) => (a.title === "Sem carrinho") - (b.title === "Sem carrinho") || numSort(a.title, b.title));
    } else groups = groupDevices(vis).map(g => ({ title: g.model, sub: schoolGroupLabel(g.items[0]?.school_group), ic: "laptop", items: g.items }));
    groups.forEach(g => g.items.sort((a, b) => numSort(a.code, b.code)));
    groupsHost.innerHTML = groups.length ? groups.map((g, gi) => `<section class="group" data-g="${gi}"><header class="group-head"><span class="group-ic">${icon(g.ic, 20)}</span><span class="group-label"><b>${esc(g.title)}</b><small>${g.items.length} livre${g.items.length === 1 ? "" : "s"}${g.sub ? ` · ${esc(g.sub)}` : ""}</small></span>
      <div class="group-actions"><span class="qty"><input type="number" min="1" max="${Math.min(MAX, g.items.length)}" placeholder="Qtd." aria-label="Quantos de ${esc(g.title)}" data-qty><button type="button" class="btn btn-sm" data-qty-go>Pegar</button></span><button type="button" class="btn btn-sm" data-all>Todos</button></div></header>
      <div class="slots">${g.items.map(d => `<button type="button" class="slot s-available ${basket.has(String(d.id)) ? "picked" : ""}" data-id="${esc(d.id)}">${icon("laptop", 22)}<span>${esc(d.code)}</span></button>`).join("")}</div></section>`).join("")
      : emptyState(free.length ? "Nada encontrado." : "Nenhum equipamento livre agora.", free.length ? "" : "Todos estão em uso ou em manutenção.", "laptop");
    const byId = new Map(free.map(d => [String(d.id), d]));
    qsa("[data-id]", groupsHost).forEach(b => b.addEventListener("click", () => { const d = byId.get(b.dataset.id); if (!d) return; add(d, !basket.has(b.dataset.id)); b.classList.toggle("picked", basket.has(b.dataset.id)); paintBasket(); }));
    qsa("[data-all]", groupsHost).forEach(b => b.addEventListener("click", () => { const g = groups[Number(b.closest("[data-g]").dataset.g)]; const allIn = g.items.every(d => basket.has(String(d.id))); g.items.forEach(d => add(d, !allIn)); paintGroups(); paintBasket(); }));
    qsa("[data-qty-go]", groupsHost).forEach(b => b.addEventListener("click", () => { const sec = b.closest("[data-g]"), g = groups[Number(sec.dataset.g)], want = Number(qs("[data-qty]", sec).value) || 0; if (want < 1) return qs("[data-qty]", sec).focus(); let n = 0; for (const d of g.items) { if (n >= want) break; if (!basket.has(String(d.id))) { if (!add(d)) break; n++; } } if (n < want) notify(`Peguei ${n}.`, "warning"); paintGroups(); paintBasket(); }));
    qsa("[data-by]", m).forEach(b => b.classList.toggle("on", b.dataset.by === ui.by));
  };
  qsa("[data-by]", m).forEach(b => b.addEventListener("click", () => { ui.by = b.dataset.by; paintGroups(); }));
  enableMarquee(groupsHost, { onSelect: els => { const byIdF = new Map(free.map(d => [String(d.id), d])); const ids = els.map(el => el.dataset.id); const allIn = ids.every(id => basket.has(id)); ids.forEach(id => { const d = byIdF.get(id); if (d) add(d, !allIn); }); paintGroups(); paintBasket(); } });
  let t; qs("#ct-q", m).addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { ui.q = e.target.value; paintGroups(); }, 120); });
  qs("#ct-cam", m).addEventListener("click", () => EquipaCamera.open({ mode: "checkout", onPick: d => { if (d.status !== "available") return { ok: false, text: `Nº ${d.code} está ${statusLabel(d.status).toLowerCase()}` }; if (basket.has(String(d.id))) return { ok: true, text: `Nº ${d.code} já está na comanda` }; if (!add(d)) return { ok: false, text: "Comanda cheia" }; paintBasket(); paintGroups(); return { ok: true, text: `Nº ${d.code} adicionado` }; }, doneLabel: "Voltar à comanda" }));
  qs("#ct-to-ticket", m).addEventListener("click", () => setStep("ticket"));
  qs("#ct-to-pick", m).addEventListener("click", () => setStep("pick"));
  const sync = () => {
    const del = form.elements.holder_mode?.value === "delegate";
    const d = qs(".delegate", form); if (d) d.hidden = !del; if (form.elements.holder_name) form.elements.holder_name.required = del;
    const other = form.elements.purpose.value === "other"; qs(".purpose-other", form).hidden = !other; form.elements.purpose_details.required = other;
    const custom = form.elements.due.value === "custom"; qs(".due-custom", form).hidden = !custom; form.elements.due_at.required = custom;
  };
  form.addEventListener("change", sync); sync();
  const action = uid();
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const items = [...basket.values()];
    if (!items.length) return notify("A comanda está vazia.", "warning");
    if (!form.reportValidity()) return setStep("ticket");
    const f = new FormData(form), b = qs("#ct-go", m);
    const mode = String(f.get("holder_mode") || "self");
    const name = mode === "delegate" ? clean(f.get("holder_name")) : null, role = mode === "delegate" ? String(f.get("holder_role") || "") : null;
    if (mode === "delegate" && (name.length < 3 || !role)) return notify("Informe o nome completo e o vínculo de quem vai receber.", "warning");
    const purpose = String(f.get("purpose") || ""), details = clean(f.get("purpose_details"));
    if (purpose === "other" && details.length < 8) return notify("Descreva a finalidade com pelo menos 8 caracteres.", "warning");
    const due = String(f.get("due"));
    const dueValue = due === "today" ? `${clock.today}T21:15` : due === "tomorrow" ? `${clock.tomorrow}T21:15` : String(f.get("due_at") || "");
    const dueDate = new Date(`${dueValue}:00-03:00`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueValue) || dueValue.slice(11) > "21:15") return notify("O horário máximo de devolução é 21h15.", "warning");
    if (!Number.isFinite(dueDate.getTime()) || dueDate.getTime() <= Date.now() + 5 * 60000 || dueDate.getTime() > Date.now() + 30 * 86400000) return notify("Escolha um prazo futuro de até 30 dias.", "warning");
    setBusy(b, true, "Registrando…");
    let result;
    try { result = await supabase.rpc("equipa_checkout_with_context", { p_equipment_ids: items.map(x => x.id), p_class_name: clean(f.get("class_name")), p_destination: clean(f.get("destination")), p_due_at: dueDate.toISOString(), p_client_action_id: action, p_holder_mode: mode, p_holder_name: name, p_holder_role: role, p_purpose: purpose, p_purpose_details: details || null }); }
    catch (error) { result = { error }; }
    setBusy(b, false);
    if (result.error) return notify(errText(result.error), "error");
    invalidateData(); state.devices.selected.clear(); state.devices.selecting = false;
    notify(`Retirada registrada: ${items.length} equipamento${items.length > 1 ? "s" : ""}.`, "success"); m.close();
    state.moves.tab = "now"; navigate("moves");
  });
  paintGroups(); paintBasket();
}
