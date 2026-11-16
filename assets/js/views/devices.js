/* Equipa — tela Equipamentos.
 * Inventário por modelo ou lista, filtros, seleção (clique, arrasto, botão direito), ficha, edição individual e em grupo. */
"use strict";

/* ===================== Equipamentos ===================== */
const DEVICE_STATUS = [["", "Todos"], ["available", "Disponíveis"], ["in_use", "Em uso"], ["maintenance", "Manutenção"], ["unavailable", "Indisponíveis"]];
const modelKey = d => clean(d.model) || "Sem modelo";
/** Cartões mais largos quando os números são longos (ex.: "DUO-01"). */
const tileWidth = items => { const n = Math.max(1, ...items.map(d => String(d.code).length)); return n <= 3 ? "" : `--tile-min:${Math.min(150, 26 + n * 11)}px;--tile-font:${n > 7 ? 14 : 16}px`; };
function groupDevices(rows) {
  const groups = new Map();
  for (const d of rows) { const k = modelKey(d); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  return [...groups.entries()].map(([model, items]) => ({ model, items: items.sort((a, b) => numSort(a.code, b.code)) })).sort((a, b) => b.items.length - a.items.length || numSort(a.model, b.model));
}
async function renderDevices(gen) {
  const s = state.devices, admin = isAdmin();
  qs("#view").innerHTML = `
    <div class="toolbar">
      <label class="search">${icon("search", 18)}<input id="dev-q" type="search" value="${esc(s.q)}" placeholder="Número, modelo, local ou série" autocomplete="off" aria-label="Buscar equipamentos"></label>
      <div class="toolbar-end">
        <div class="segmented" role="group" aria-label="Visualização"><button type="button" data-layout="grid" class="${s.layout === "grid" ? "on" : ""}" aria-label="Por modelo">${icon("grid", 18)}</button><button type="button" data-layout="list" class="${s.layout === "list" ? "on" : ""}" aria-label="Lista">${icon("list", 18)}</button></div>
        <button type="button" class="btn ${s.selecting ? "btn-on" : ""}" id="dev-select">${icon("select", 18)}<span>${s.selecting ? "Selecionando" : "Selecionar"}</span></button>
        ${admin ? `<button type="button" class="btn" id="dev-tools" aria-label="Mais ações">${icon("more", 18)}</button><button type="button" class="btn btn-primary" id="dev-add">${icon("plus", 18)}<span>Adicionar</span></button>` : ""}
      </div>
    </div>
    <div class="chips" id="dev-chips" role="group" aria-label="Situação"></div>
    <div class="chips chips-todo" id="dev-todo" role="group" aria-label="Pendências de organização"></div>
    ${s.inactive ? `<div class="callout">${icon("info", 18)}<span>Mostrando equipamentos <b>fora do catálogo</b> (desativados).</span><button class="link" id="dev-back-active" type="button">Voltar aos ativos</button></div>` : ""}
    <div id="dev-results">${loadingState("Carregando equipamentos…")}</div>`;
  let timer;
  qs("#dev-q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => { s.q = cleanSearch(e.target.value); paintDevices(); }, 160); });
  qsa("[data-layout]").forEach(b => b.addEventListener("click", () => { s.layout = b.dataset.layout; qsa("[data-layout]").forEach(x => x.classList.toggle("on", x === b)); paintDevices(); }));
  qs("#dev-select").addEventListener("click", () => { s.selecting = !s.selecting; if (!s.selecting) s.selected.clear(); renderDevices(gen); });
  qs("#dev-add")?.addEventListener("click", () => EquipaRegister.open());
  qs("#dev-tools")?.addEventListener("click", openDeviceTools);
  qs("#dev-back-active")?.addEventListener("click", () => { s.inactive = false; renderDevices(gen); });
  let rows;
  try { rows = await loadDevices({ inactive: s.inactive }); }
  catch (error) { if (alive(gen)) qs("#dev-results").innerHTML = emptyState("Não foi possível carregar.", errText(error), "warn"); return; }
  if (!alive(gen)) return;
  // Marca atrasados nos cartões quando a conta puder ver as retiradas.
  let lateIds = new Set();
  try { (await loadOpenWithdrawals()).filter(w => w.overdue).forEach(w => w.pending.forEach(i => lateIds.add(String(i.equipment_id)))); } catch {}
  if (!alive(gen)) return;
  // Mapa número → carrinho, para a pendência "sem carrinho".
  let cartOf = new Map();
  try { cartOf = (await loadCartMap()).byCode; } catch {}
  if (!alive(gen)) return;
  devicesView = { rows, lateIds, cartOf };
  // Clique fora dos cartões (e fora da barra de ações) desmarca e sai do modo de seleção.
  const resultsHost = qs("#dev-results");
  clearOnOutsideClick({ keep: "[data-dev], #selbar, #dev-select, [data-group-all], .group-toggle", alive: () => resultsHost.isConnected, hasSelection: () => s.selecting && s.selected.size > 0,
    clear: () => { s.selected.clear(); s.selecting = false; const b = qs("#dev-select"); if (b) { b.classList.remove("btn-on"); b.querySelector("span").textContent = "Selecionar"; } paintDevices(); } });
  // Botão direito: como numa pasta — se o item não estava marcado, marca só ele; depois abre o menu.
  resultsHost.addEventListener("contextmenu", e => {
    const el = e.target.closest("[data-dev]"); if (!el) return;
    e.preventDefault();
    const byId = new Map(devicesView.rows.map(d => [String(d.id), d])), d = byId.get(el.dataset.dev); if (!d) return;
    if (!s.selected.has(d.id)) { s.selected.clear(); s.selected.set(d.id, d); }
    if (!s.selecting) { s.selecting = true; const b = qs("#dev-select"); if (b) { b.classList.add("btn-on"); b.querySelector("span").textContent = "Selecionando"; } }
    paintDevices();
    deviceContextMenu(e, [...s.selected.values()]);
  });
  // Arrastar o mouse sobre os cartões entra no modo de seleção e marca vários.
  enableMarquee(qs("#dev-results"), { item: "[data-dev]", onSelect: (els, { additive }) => {
    const byId = new Map(devicesView.rows.map(d => [String(d.id), d]));
    if (!s.selecting) { s.selecting = true; const b = qs("#dev-select"); if (b) { b.classList.add("btn-on"); b.querySelector("span").textContent = "Selecionando"; } }
    const list = els.map(el => byId.get(el.dataset.dev)).filter(Boolean);
    const allOn = list.every(d => s.selected.has(d.id));
    if (!additive && !allOn) s.selected.clear();
    list.forEach(d => allOn ? s.selected.delete(d.id) : s.selected.set(d.id, d));
    paintDevices();
  } });
  paintDevices();
}
let devicesView = { rows: [], lateIds: new Set(), cartOf: new Map() };
/** Pendências que atrapalham quem organiza: cada uma vira um filtro com contagem. */
const DEVICE_TODO = [
  ["no_cart", "Sem carrinho", d => !devicesView.cartOf.has(norm(d.code))],
  ["no_place", "Sem local", d => !clean(d.location_text)],
  ["no_type", "Sem tipo", d => !d.school_group],
  ["no_os", "Sem plataforma", d => !clean(d.operating_system)],
  ["no_serial", "Sem série", d => !clean(d.serial_number)]
];
function deviceState(d) { return d.status === "in_use" && devicesView.lateIds.has(String(d.id)) ? "overdue" : d.status; }
function paintDevices() {
  const s = state.devices, host = qs("#dev-results"); if (!host) return;
  const all = devicesView.rows;
  const searched = smartFilter(all, s.q, d => [d.code, d.model, d.brand, d.label, d.location_text, d.serial_number, d.asset_tag, schoolGroupLabel(d.school_group)]);
  const counts = { "": searched.length }; for (const d of searched) counts[d.status] = (counts[d.status] || 0) + 1;
  qs("#dev-chips").innerHTML = DEVICE_STATUS.map(([v, l]) => `<button type="button" class="chip ${s.status === v ? "on" : ""} ${v ? `chip-${v}` : ""}" data-st="${v}">${l}<b>${counts[v] || 0}</b></button>`).join("");
  qsa("[data-st]").forEach(b => b.addEventListener("click", () => { s.status = b.dataset.st; paintDevices(); }));
  const todo = DEVICE_TODO.find(t => t[0] === s.todo);
  qs("#dev-todo").innerHTML = `<span class="chips-label">Organizar:</span>${DEVICE_TODO.map(([k, l, fn]) => { const n = searched.filter(fn).length; return n ? `<button type="button" class="chip chip-todo ${s.todo === k ? "on" : ""}" data-todo="${k}">${l}<b>${n}</b></button>` : ""; }).join("") || `<span class="chips-label ok">${icon("check", 14)} cadastro completo</span>`}`;
  qsa("[data-todo]").forEach(b => b.addEventListener("click", () => { s.todo = s.todo === b.dataset.todo ? "" : b.dataset.todo; paintDevices(); }));
  const rows = (s.status ? searched.filter(d => d.status === s.status) : searched).filter(d => !todo || todo[2](d));
  setTitle("Equipamentos", `${all.length} no ${s.inactive ? "arquivo" : "inventário"}`);
  if (!all.length) {
    host.innerHTML = isAdmin() && !s.inactive
      ? `<div class="empty empty-big">${icon("devices", 34)}<strong>Nenhum equipamento ainda</strong><span>Cadastre de 1 a 30 de uma vez: digite o intervalo, escolha o modelo e pronto.</span><button class="btn btn-primary btn-lg" id="empty-add" type="button">${icon("plus", 18)} Adicionar equipamentos</button></div>`
      : emptyState("Nenhum equipamento encontrado.", "", "devices");
    qs("#empty-add")?.addEventListener("click", () => EquipaRegister.open());
    return;
  }
  if (!rows.length) { host.innerHTML = emptyState("Nada encontrado.", "Tente outro número, modelo ou local.", "search"); return; }
  const sel = s.selected;
  if (s.layout === "list") {
    host.innerHTML = `<div class="card list-card"><div class="rows">${rows.map(d => `<button type="button" class="row dev-row ${sel.has(d.id) ? "picked" : ""}" data-dev="${esc(d.id)}">${s.selecting ? `<span class="tick">${icon("check", 14)}</span>` : `<span class="row-ic s-${esc(deviceState(d))}">${groupIcon(d.school_group, 18)}</span>`}<span class="row-main"><b>Nº ${esc(d.code)}</b><small>${esc([d.model, d.location_text].filter(Boolean).join(" · ") || schoolGroupLabel(d.school_group))}</small></span>${pill(deviceState(d))}${icon("chevron", 16)}</button>`).join("")}</div></div>`;
  } else {
    host.innerHTML = groupDevices(rows).map(g => {
      const free = g.items.filter(d => d.status === "available").length;
      const collapsed = s.collapsed.has(g.model) && !s.q;
      return `<section class="group ${collapsed ? "collapsed" : ""}" data-group="${esc(g.model)}">
        <header class="group-head"><button type="button" class="group-toggle" data-toggle-group aria-expanded="${!collapsed}">${icon("down", 18)}<span class="group-ic">${groupIcon(g.items[0]?.school_group, 20)}</span><span><b>${esc(g.model)}</b><small>${free} de ${g.items.length} disponíve${free === 1 ? "l" : "is"}${g.items[0]?.school_group ? ` · ${esc(schoolGroupLabel(g.items[0].school_group))}` : ""}</small></span></button>
          <div class="group-actions">${s.selecting ? `<button type="button" class="btn btn-sm" data-group-all>Marcar todos</button>` : isAdmin() ? `<button type="button" class="btn btn-sm btn-ghost" data-group-edit>${icon("edit", 16)}<span>Editar grupo</span></button>` : ""}</div></header>
        <div class="tiles" style="${tileWidth(g.items)}">${g.items.map(d => `<button type="button" class="tile s-${esc(deviceState(d))} ${sel.has(d.id) ? "picked" : ""}" data-dev="${esc(d.id)}" title="Nº ${esc(d.code)} · ${esc(statusLabel(deviceState(d)))}${d.location_text ? ` · ${esc(d.location_text)}` : ""}"><span class="tile-num">${esc(d.code)}</span><span class="tile-st">${esc(statusLabel(deviceState(d)))}</span>${s.selecting ? `<span class="tick">${icon("check", 12)}</span>` : ""}</button>`).join("")}</div>
      </section>`;
    }).join("") + `<div class="legend"><span class="lg s-available">Disponível</span><span class="lg s-in_use">Em uso</span><span class="lg s-overdue">Atrasado</span><span class="lg s-maintenance">Manutenção</span><span class="lg s-unavailable">Indisponível</span></div>`;
  }
  const byId = new Map(all.map(d => [String(d.id), d]));
  qsa("[data-dev]", host).forEach(b => b.addEventListener("click", () => {
    const d = byId.get(b.dataset.dev); if (!d) return;
    if (!s.selecting) return openDevice(d.id);
    if (sel.has(d.id)) sel.delete(d.id); else sel.set(d.id, d);
    b.classList.toggle("picked", sel.has(d.id)); paintSelbar();
  }));
  qsa("[data-toggle-group]", host).forEach(b => b.addEventListener("click", () => {
    const sec = b.closest("[data-group]"), k = sec.dataset.group;
    if (s.collapsed.has(k)) s.collapsed.delete(k); else s.collapsed.add(k);
    sec.classList.toggle("collapsed"); b.setAttribute("aria-expanded", String(!sec.classList.contains("collapsed")));
  }));
  qsa("[data-group-all]", host).forEach(b => b.addEventListener("click", () => {
    const sec = b.closest("[data-group]"); const ids = qsa("[data-dev]", sec).map(x => x.dataset.dev);
    const allOn = ids.every(id => sel.has(byId.get(id)?.id));
    ids.forEach(id => { const d = byId.get(id); if (!d) return; if (allOn) sel.delete(d.id); else sel.set(d.id, d); });
    qsa("[data-dev]", sec).forEach(x => x.classList.toggle("picked", sel.has(byId.get(x.dataset.dev)?.id)));
    paintSelbar();
  }));
  qsa("[data-group-edit]", host).forEach(b => b.addEventListener("click", () => {
    const sec = b.closest("[data-group]"); openBulkEdit(qsa("[data-dev]", sec).map(x => byId.get(x.dataset.dev)).filter(Boolean));
  }));
  paintSelbar();
}
function paintSelbar() {
  const s = state.devices; let bar = qs("#selbar");
  if (!s.selecting || state.view !== "devices") { bar?.remove(); return; }
  const list = [...s.selected.values()], free = list.filter(d => d.status === "available").length;
  if (!bar) { bar = document.createElement("div"); bar.id = "selbar"; bar.className = "selbar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Selecionados"); document.body.append(bar); }
  bar.innerHTML = `<span class="selbar-n"><b>${list.length}</b> selecionado${list.length === 1 ? "" : "s"}</span>
    <button type="button" class="btn btn-ghost" id="sel-clear" ${list.length ? "" : "disabled"}>Limpar</button>
    ${isAdmin() ? `<button type="button" class="btn" id="sel-edit" ${list.length ? "" : "disabled"}>${icon("edit", 17)}<span>Editar</span></button><button type="button" class="btn" id="sel-labels" ${list.length ? "" : "disabled"}>${icon("tag", 17)}<span>Etiquetas</span></button>` : ""}
    <button type="button" class="btn btn-primary" id="sel-out" ${free ? "" : "disabled"}>${icon("out", 17)}<span>Retirar${free ? ` ${free}` : ""}</span></button>`;
  qs("#sel-clear", bar).addEventListener("click", () => { s.selected.clear(); paintDevices(); });
  qs("#sel-edit", bar)?.addEventListener("click", () => openBulkEdit(list));
  qs("#sel-labels", bar)?.addEventListener("click", () => EquipaRegister.downloadLabels(list, "Equipa-etiquetas"));
  qs("#sel-out", bar).addEventListener("click", () => {
    const chosen = list.filter(d => d.status === "available");
    if (chosen.length > 60) return notify("Uma retirada aceita até 60 equipamentos. Desmarque alguns.", "warning");
    openCheckoutForm(chosen);
  });
}
function openDeviceTools() {
  const m = openSheet({ size: "sm", title: "Ferramentas do inventário",
    body: `<div class="menu">
      <button type="button" class="menu-item" data-t="labels">${icon("tag", 20)}<span><b>Etiquetas QR em PDF</b><small>Por sala ou do inventário inteiro</small></span></button>
      <button type="button" class="menu-item" data-t="import">${icon("upload", 20)}<span><b>Importar planilha</b><small>CSV, Excel ou tabela do Word</small></span></button>
      <button type="button" class="menu-item" data-t="export">${icon("download", 20)}<span><b>Exportar inventário</b><small>Planilha Excel com tudo</small></span></button>
      <button type="button" class="menu-item" data-t="inactive">${icon("box", 20)}<span><b>${state.devices.inactive ? "Ver equipamentos ativos" : "Ver fora do catálogo"}</b><small>Equipamentos desativados com histórico</small></span></button>
    </div>` });
  qsa("[data-t]", m).forEach(b => b.addEventListener("click", () => {
    m.close();
    const t = b.dataset.t;
    if (t === "labels") EquipaRegister.chooseLabels();
    if (t === "import") EquipaRegister.open("import");
    if (t === "export") exportEquipments();
    if (t === "inactive") { state.devices.inactive = !state.devices.inactive; state.devices.selected.clear(); navigate("devices"); }
  }));
}

/* ----- Ficha do equipamento ----- */
async function openDevice(id) {
  const m = openSheet({ size: "md", title: "Equipamento", body: loadingState() });
  let e;
  try { e = await getDevice(id); } catch (error) { setSheet(m, { body: emptyState("Não foi possível abrir.", errText(error), "warn") }); return; }
  let holder = null;
  if (e.status === "in_use") {
    try {
      const { data } = await supabase.from("withdrawal_items").select("returned_at,withdrawals(id,status,custodian_name,responsible_name,class_name,destination,due_at,custody_mode)").eq("equipment_id", e.id).order("id", { ascending: false }).limit(5);
      holder = (data || []).find(x => !x.returned_at && x.withdrawals?.status === "open")?.withdrawals || null;
    } catch {}
    if (!holder) {
      try { const ws = await loadOpenWithdrawals(); const w = ws.find(w => w.pending.some(i => String(i.equipment_id) === String(e.id))); if (w) holder = w; } catch {}
    }
  }
  if (!m.isConnected) return;
  paintDeviceSheet(m, e, holder);
}
function paintDeviceSheet(m, e, holder) {
  const admin = isAdmin();
  const late = holder?.due_at && new Date(holder.due_at).getTime() < Date.now();
  const st = e.status === "in_use" && late ? "overdue" : e.status;
  const specs = [e.operating_system, e.processor, e.ram_gb ? `${e.ram_gb} GB RAM` : "", e.storage_gb ? `${e.storage_gb} GB` : ""].filter(Boolean).join(" · ");
  const info = [["Modelo", [e.brand !== "Não informado" ? e.brand : "", e.model].filter(Boolean).join(" ")], ["Tipo", schoolGroupLabel(e.school_group)], ["Local", e.location_text], ["Patrimônio", e.asset_tag], ["Nº de série", e.serial_number], ["Nome", e.label], ["Plataforma e configuração", specs], ...EquipaSettings.describe(e.specs), ["Observações", e.notes], ["Atualizado", dt(e.updated_at)]].filter(([, v]) => v && v !== "—" || false);
  const primary = !e.is_active ? "" : e.status === "available" ? `<button class="btn btn-primary btn-lg btn-block" data-act="out" type="button">${icon("out", 20)} Retirar este</button>`
    : e.status === "in_use" ? `<button class="btn btn-primary btn-lg btn-block" data-act="return" type="button">${icon("back", 20)} Registrar devolução</button>`
    : e.status === "maintenance" && admin ? `<button class="btn btn-primary btn-lg btn-block" data-act="fix" type="button">${icon("check", 20)} Concluir manutenção</button>` : "";
  setSheet(m, {
    title: `<span class="dev-title"><span class="dev-num">Nº ${esc(e.code)}</span></span>`, subtitle: esc(e.model || ""),
    body: `<div class="dev-status s-${esc(st)}">${groupIcon(e.school_group, 22)}<div><b>${esc(statusLabel(st))}</b><small>${holder ? `Com ${esc(holder.custodian_name || holder.responsible_name || "não identificado")} · ${esc([holder.class_name, holder.destination].filter(Boolean).join(" · "))}${holder.due_at ? ` · ${esc(relativeDue(holder.due_at))}` : ""}` : e.is_active === false ? "Fora do catálogo — histórico preservado" : e.status === "available" ? "Pronto para retirar" : e.status === "maintenance" ? "Aguardando conserto" : ""}</small></div></div>
      ${primary}
      ${holder?.id ? `<button class="link" type="button" data-act="withdrawal">Ver a retirada completa</button>` : ""}
      <dl class="info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`,
    foot: `<button class="btn" type="button" data-act="qr">${icon("qr", 18)}<span>QR</span></button>${admin ? `${["available", "unavailable"].includes(e.status) && e.is_active ? `<button class="btn" type="button" data-act="maint">${icon("tool", 18)}<span>Manutenção</span></button>` : ""}<button class="btn btn-ghost danger" type="button" data-act="delete" aria-label="Apagar">${icon("trash", 18)}</button><button class="btn btn-primary" type="button" data-act="edit">${icon("edit", 18)}<span>Editar</span></button>` : ""}`
  });
  const on = (a, fn) => qs(`[data-act="${a}"]`, m)?.addEventListener("click", fn);
  on("out", () => { m.close(); openCheckoutForm([e]); });
  on("return", async () => {
    const b = qs('[data-act="return"]', m); setBusy(b, true, "Registrando…");
    const { error } = await supabase.rpc("return_equipment", { p_equipment_id: e.id, p_client_action_id: uid() });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    invalidateData(); notify(`Nº ${e.code} devolvido.`, "success"); m.close(); refreshView();
  });
  on("fix", async () => {
    const { data } = await supabase.from("maintenance_events").select("id").eq("equipment_id", e.id).eq("status", "open").limit(1);
    if (!data?.[0]) return notify("Nenhuma manutenção aberta encontrada.", "warning");
    m.close(); resolveMaintenance(data[0].id);
  });
  on("withdrawal", () => { m.close(); openWithdrawal(holder.id); });
  on("qr", () => openQr(e.qr_token, `Nº ${e.code}`, [schoolGroupLabel(e.school_group), e.model].filter(Boolean).join(" · ")));
  on("maint", () => openMaintenanceForm(e, m));
  on("delete", () => { m.close(); deleteDevice(e); });
  on("edit", () => openDeviceEdit(e, m, holder));
}
async function openDeviceEdit(e, m, holder) {
  const models = await knownModels();
  const statusOk = ["available", "unavailable"].includes(e.status);
  const devs = await loadDevices().catch(() => []);
  setSheet(m, { title: `Editar Nº ${esc(e.code)}`, subtitle: "Só número e modelo são obrigatórios.",
    body: `<form id="edit-form" class="form" autocomplete="off">
      <div class="grid-2"><label class="field"><span>Número *</span><input name="code" required maxlength="80" value="${esc(e.code)}"></label>
      <label class="field"><span>Modelo *</span><input name="model" required maxlength="120" value="${esc(e.model)}" list="model-list"></label></div>
      <datalist id="model-list">${models.map(x => `<option value="${esc(x.name)}">`).join("")}</datalist>
      <p class="hint" id="edit-inherit"></p>
      <label class="field"><span>Local</span><input name="location_text" maxlength="160" value="${esc(e.location_text || "")}" placeholder="Ex.: Sala 12" list="edit-locs"></label>
      ${EquipaSettings.locationDatalist("edit-locs", devs.map(d => d.location_text))}
      ${statusOk ? `<fieldset class="field"><legend>Situação</legend><div class="segmented"><label><input type="radio" name="status" value="available" ${e.status === "available" ? "checked" : ""}><span>Disponível</span></label><label><input type="radio" name="status" value="unavailable" ${e.status === "unavailable" ? "checked" : ""}><span>Indisponível</span></label></div></fieldset>` : `<p class="hint">${icon("info", 15)} ${e.status === "in_use" ? "Em uso: registre a devolução para mudar a situação." : "Em manutenção: conclua a manutenção para mudar a situação."}</p>`}
      <details class="more" open><summary>Detalhes do note</summary>${EquipaSettings.specInputs({ ...e, brand: e.brand === "Não informado" ? "" : e.brand, specs: e.specs || {} })}</details>
      <details class="more"><summary>Identificação e observações</summary><div class="grid-2">
        <label class="field"><span>Patrimônio</span><input name="asset_tag" maxlength="80" value="${esc(e.asset_tag || "")}"></label>
        <label class="field"><span>Nº de série</span><input name="serial_number" maxlength="120" value="${esc(e.serial_number || "")}"></label>
        <label class="field"><span>Nome (opcional)</span><input name="label" maxlength="120" value="${esc(e.label || "")}"></label></div>
        <label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="3">${esc(e.notes || "")}</textarea></label>
        <label class="check"><input name="is_active" type="checkbox" ${e.is_active !== false ? "checked" : ""}><span>Ativo no catálogo</span></label></details>
    </form>`,
    foot: `<button class="btn" type="button" id="edit-cancel">Cancelar</button><button class="btn btn-primary" type="submit" form="edit-form">Salvar</button>` });
  const form = qs("#edit-form", m);
  // Trocar o modelo oferece os dados herdados do novo modelo (sem apagar o que já foi digitado).
  form.elements.model.addEventListener("change", async () => {
    if (norm(form.elements.model.value) === norm(e.model)) { qs("#edit-inherit", m).textContent = ""; return; }
    const h = await EquipaSettings.inherit(form.elements.model.value);
    const sum = EquipaSettings.inheritSummary(h);
    qs("#edit-inherit", m).innerHTML = sum ? `${icon("layers", 14)} Este modelo tem: ${esc(sum)} <button type="button" class="link" id="edit-apply">Usar estes dados</button>` : "";
    qs("#edit-apply", m)?.addEventListener("click", () => {
      for (const k of ["brand", "school_group", "operating_system", "processor", "ram_gb", "storage_gb"]) if (h[k]) form.elements[k].value = h[k];
      for (const [k, v] of Object.entries(h.specs || {})) if (form.elements[`spec_${k}`]) form.elements[`spec_${k}`].value = v;
      qs("#edit-inherit", m).textContent = "Dados do modelo aplicados. Confira e salve.";
    });
  });
  qs("#edit-cancel", m).addEventListener("click", () => paintDeviceSheet(m, e, holder));
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = new FormData(form), b = qs('.sheet-foot [type="submit"]', m);
    const sp = EquipaSettings.readSpecInputs(form);
    const payload = { code: clean(f.get("code")), model: clean(f.get("model")), location_text: clean(f.get("location_text")) || null,
      asset_tag: clean(f.get("asset_tag")) || null, serial_number: clean(f.get("serial_number")) || null, label: clean(f.get("label")) || null,
      notes: clean(f.get("notes")) || null, is_active: f.get("is_active") === "on", ...EquipaSettings.toEquipmentColumns(sp) };
    if (payload.specs) payload.specs = { ...(e.specs || {}), ...payload.specs };
    if (statusOk && f.get("status")) payload.status = f.get("status");
    if (!payload.code || !payload.model) return form.reportValidity();
    setBusy(b, true, "Salvando…");
    const { error } = await supabase.from("equipments").update(payload).eq("id", e.id);
    setBusy(b, false);
    if (error) return notify(/23505|duplicate/i.test(`${error.code} ${error.message}`) ? "Já existe outro equipamento com esse número, patrimônio ou série." : errText(error), "error");
    notify(`Nº ${payload.code} atualizado.`, "success"); invalidateData();
    const fresh = await getDevice(e.id).catch(() => ({ ...e, ...payload }));
    paintDeviceSheet(m, fresh, holder);
    if (state.view === "devices") renderDevices(viewGen);
  });
  form.elements.code.focus();
}
/** Edição em grupo: só os campos preenchidos são aplicados a todos. */
async function openBulkEdit(list) {
  if (!isAdmin() || !list.length) return;
  const models = await knownModels();
  const devs = await loadDevices().catch(() => []);
  const same = k => list.every(d => (d[k] || "") === (list[0][k] || "")) ? (list[0][k] || "") : "";
  const keep = "Manter como está";
  const m = openSheet({ size: "md", title: `Editar ${list.length} equipamento${list.length === 1 ? "" : "s"}`, subtitle: `Nº ${esc(list.slice(0, 6).map(d => d.code).join(", "))}${list.length > 6 ? "…" : ""}. Campos vazios não mudam.`,
    body: `<form id="bulk-form" class="form" autocomplete="off">
      <label class="field"><span>Modelo</span><input name="model" maxlength="120" list="bulk-models" value="${esc(same("model"))}" placeholder="${keep}"></label>
      <datalist id="bulk-models">${models.map(x => `<option value="${esc(x.name)}">`).join("")}</datalist>
      <label class="field"><span>Local</span><input name="location_text" maxlength="160" value="${esc(same("location_text"))}" placeholder="${keep}" list="bulk-locs"></label>
      ${EquipaSettings.locationDatalist("bulk-locs", devs.map(d => d.location_text))}
      <details class="more" open><summary>Detalhes dos notes</summary>${EquipaSettings.specInputs({}, { keepPlaceholder: keep })}</details>
      <details class="more"><summary>Renumerar em sequência</summary><p class="hint">Troca os números na ordem atual (${esc(list[0].code)} → …). Útil quando o lote foi cadastrado com o número errado.</p>
        <div class="grid-2"><label class="field"><span>Prefixo</span><input name="prefix" maxlength="30" placeholder="Opcional"></label><label class="field"><span>Começar em</span><input name="start" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" placeholder="Ex.: 31"></label></div></details>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="bulk-form">Aplicar a ${list.length}</button>` });
  const form = qs("#bulk-form", m);
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = new FormData(form), b = qs('.sheet-foot [type="submit"]', m);
    const sp = EquipaSettings.readSpecInputs(form, { onlyFilled: true });
    const specsPatch = sp.specs; delete sp.specs;
    const payload = EquipaSettings.toEquipmentColumns(sp);
    if (!sp.brand) delete payload.brand;
    for (const k of ["model", "location_text"]) { const v = clean(f.get(k)); if (v) payload[k] = v; }
    if (payload.model && !payload.school_group) { const g = guessGroup(payload.model) || models.find(x => norm(x.name) === norm(payload.model))?.group; if (g) payload.school_group = g; }
    const start = clean(f.get("start")), prefix = clean(f.get("prefix"));
    if (start && !/^\d{1,8}$/.test(start)) return notify("O número inicial deve conter só dígitos.", "warning");
    if (!Object.keys(payload).length && !specsPatch && !start) return notify("Preencha ao menos um campo para aplicar.", "warning");
    setBusy(b, true, "Aplicando…");
    try {
      const ids = list.map(d => d.id);
      if (Object.keys(payload).length) {
        for (let i = 0; i < ids.length; i += 100) { const { error } = await supabase.from("equipments").update(payload).in("id", ids.slice(i, i + 100)); if (error) throw error; }
      }
      // Campos personalizados: mescla com o que cada note já tem (não apaga os outros campos).
      if (specsPatch && EquipaSettings.hasSpecs()) {
        const inBatches = async (arr, fn) => { for (let i = 0; i < arr.length; i += 10) { const res = await Promise.all(arr.slice(i, i + 10).map(fn)); const bad = res.find(r => r.error); if (bad) throw bad.error; } };
        await inBatches(list, d => supabase.from("equipments").update({ specs: { ...(d.specs || {}), ...specsPatch } }).eq("id", d.id));
      }
      if (start) {
        const sorted = [...list].sort((a, c) => numSort(a.code, c.code));
        const codes = sorted.map((_, i) => prefix + String(Number(start) + i).padStart(start.length, "0"));
        const own = new Set(sorted.map(d => norm(d.code)));
        const { data: taken, error: te } = await supabase.rpc("equipa_existing_codes", { p_codes: codes });
        if (te) throw te;
        const clash = (taken || []).filter(c => !own.has(norm(c)));
        if (clash.length) throw new Error(`Os números ${clash.slice(0, 5).join(", ")} já pertencem a outros equipamentos.`);
        // Duas passagens evitam colisão temporária entre números do próprio grupo.
        const inBatches = async (arr, fn) => { for (let i = 0; i < arr.length; i += 10) { const res = await Promise.all(arr.slice(i, i + 10).map(fn)); const bad = res.find(r => r.error); if (bad) throw bad.error; } };
        await inBatches(sorted, d => supabase.from("equipments").update({ code: `__tmp_${d.id.slice(0, 8)}` }).eq("id", d.id));
        await inBatches(sorted.map((d, i) => [d, codes[i]]), ([d, code]) => supabase.from("equipments").update({ code }).eq("id", d.id));
      }
      notify(`${list.length} equipamento(s) atualizado(s).`, "success");
      m.close(); state.devices.selected.clear(); invalidateData(); if (state.view === "devices") renderDevices(viewGen);
    } catch (error) { notify(error.message && !error.code ? error.message : errText(error), "error"); }
    finally { setBusy(b, false); }
  });
}
/** Exclui vários do inventário. Sem histórico: apaga. Com histórico: sai do inventário ativo e o histórico fica. */
async function deleteDevices(list, after = () => refreshView()) {
  if (!isAdmin() || !list.length) return;
  const busy = list.filter(d => ["in_use", "maintenance"].includes(d.status));
  const ok = await confirmAction({ title: `Excluir ${list.length} equipamento${list.length === 1 ? "" : "s"}?`,
    message: `Nº ${list.slice(0, 15).map(d => d.code).join(", ")}${list.length > 15 ? "…" : ""}. Os que nunca foram usados são apagados; os que têm histórico saem do inventário e o histórico fica guardado. ${busy.length ? `${busy.length} estão emprestados ou em manutenção e serão pulados.` : ""}`,
    confirmText: `Excluir ${list.length - busy.length}`, danger: true });
  if (!ok) return;
  let deleted = 0, retired = 0, failed = 0;
  for (const d of list.filter(x => !busy.includes(x))) {
    const { data, error } = await supabase.rpc("remove_equipment", { p_equipment_id: d.id });
    if (error) failed++; else if (data?.mode === "deleted") deleted++; else retired++;
  }
  notify([deleted && `${deleted} apagado(s)`, retired && `${retired} fora do inventário (histórico mantido)`, (failed + busy.length) && `${failed + busy.length} não excluído(s)`].filter(Boolean).join(" · "), failed ? "warning" : "success");
  invalidateData(); cartMapCache.at = 0; after();
}
/** Menu do botão direito para os equipamentos marcados (tela Equipamentos). */
function deviceContextMenu(e, list) {
  const free = list.filter(d => d.status === "available"), admin = isAdmin();
  openContextMenu(e.clientX, e.clientY, { title: list.length === 1 ? `Nº ${list[0].code}` : `${list.length} selecionados`, items: [
    ...(list.length === 1 ? [{ label: "Abrir ficha", ic: "laptop", action: () => openDevice(list[0].id) }] : []),
    { label: free.length ? `Retirar ${free.length}` : "Retirar (nenhum livre)", ic: "out", disabled: !free.length, action: () => openCounter(free, { step: "ticket" }) },
    ...(admin ? [{ label: list.length === 1 ? "Editar" : `Editar ${list.length} juntos`, ic: "edit", action: () => list.length === 1 ? openDevice(list[0].id) : openBulkEdit(list) },
      { label: "Colocar num carrinho", ic: "cart", action: () => openCartForm({ equipment_codes: list.map(d => d.code) }) }] : []),
    { label: `Etiquetas QR (${list.length})`, ic: "qr", action: () => EquipaLabels.open(list) },
    ...(admin ? ["-", { label: `Excluir ${list.length === 1 ? "do inventário" : `${list.length} do inventário`}`, ic: "trash", danger: true, action: () => deleteDevices(list, () => { state.devices.selected.clear(); renderDevices(viewGen); }) }] : [])
  ] });
}
async function deleteDevice(e) {
  if (!isAdmin()) return;
  const ok = await confirmAction({ title: `Apagar Nº ${e.code}?`, message: "Se nunca foi usado, o cadastro é excluído. Se já tem histórico, ele sai do inventário e o histórico fica guardado. Retiradas e manutenções abertas precisam ser encerradas antes.", confirmText: "Apagar", danger: true });
  if (!ok) return;
  const { data, error } = await supabase.rpc("remove_equipment", { p_equipment_id: e.id });
  if (error) return notify(errText(error), "error");
  notify(data?.mode === "deleted" ? `Nº ${e.code} excluído.` : `Nº ${e.code} saiu do inventário; histórico preservado.`, "success");
  invalidateData(); refreshView();
}
function openMaintenanceForm(e, parent) {
  const m = openSheet({ size: "sm", title: `Manutenção · Nº ${esc(e.code)}`, subtitle: "O equipamento fica indisponível até a conclusão.",
    body: `<form id="mt-form" class="form"><label class="field"><span>O que aconteceu? *</span><input name="title" required maxlength="160" placeholder="Ex.: tela quebrada, não liga"></label><label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="3"></textarea></label></form>`,
    foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="mt-form">Enviar para manutenção</button>` });
  qs("#mt-form", m).addEventListener("submit", async ev => {
    ev.preventDefault(); const f = new FormData(ev.currentTarget), b = qs('.sheet-foot [type="submit"]', m); setBusy(b, true, "Enviando…");
    const { error } = await supabase.rpc("open_maintenance", { p_equipment_id: e.id, p_title: clean(f.get("title")), p_notes: clean(f.get("notes")) || null, p_client_action_id: uid() });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    notify(`Nº ${e.code} em manutenção.`, "success"); m.close(); parent?.close?.(); invalidateData(); refreshView();
  });
}
async function openQr(token, title, subtitle = "") {
  try { await ensureQRCodeLib(); } catch (error) { return notify(error.message, "error"); }
  const m = openSheet({ size: "sm", title: esc(title), subtitle: esc(subtitle), body: `<div class="qr-box"><div id="qr-code"></div><small>${esc(qrUrl(token))}</small></div>`,
    foot: `<button class="btn" type="button" id="qr-copy">Copiar link</button><button class="btn btn-primary" type="button" id="qr-print">Imprimir</button>` });
  new window.QRCode(qs("#qr-code", m), { text: qrUrl(token), width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
  qs("#qr-copy", m).addEventListener("click", async () => { try { await navigator.clipboard.writeText(qrUrl(token)); notify("Link copiado.", "success"); } catch { notify("Não foi possível copiar.", "warning"); } });
  qs("#qr-print", m).addEventListener("click", () => EquipaLabels.printOne({ code: String(title).replace(/^Nº\s*/, ""), model: subtitle, qr_token: token }));
}
