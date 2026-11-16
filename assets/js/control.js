/* Equipa — Controle: retirar, receber e ver quem está com o quê.
 *
 * Por que é assim (o problema da versão anterior):
 *  - O banco só deixa cada professor/aluno ler as retiradas que ELE registrou
 *    (policy withdrawals_select_by_role). Só a administração lê todas.
 *  - A tela antiga misturava o inventário inteiro com esse pedaço parcial; quem
 *    não era admin via "Em uso" sem saber com quem nem até quando.
 * Solução sem afrouxar a segurança:
 *  - "Minhas": retiradas que a conta registrou, completas (prazo, turma, local).
 *  - "Todas": para a administração, tudo; para os demais, as próprias completas +
 *    quem está com cada equipamento (equipa_school_activity), sem expor prazo,
 *    turma ou local de terceiros.
 * O painel imita um quadro de comandas de cozinha: cada retirada é um cartão com
 * relógio, colunas por urgência e um botão para receber. */
"use strict";

/* ---------- Dados ---------- */
let cartMapCache = { at: 0, data: null };
/** Carrinhos e a qual carrinho cada número pertence. */
async function loadCartMap(force = false) {
  if (!force && cartMapCache.data && Date.now() - cartMapCache.at < 60000) return cartMapCache.data;
  const { data, error } = await supabase.rpc("cart_scan_catalog_v2");
  if (error) throw error;
  const carts = (data || []).filter(c => c.is_active !== false).sort((a, b) => numSort(a.cart_number, b.cart_number));
  const byCode = new Map();
  carts.forEach(c => (c.equipment_codes || []).forEach(code => byCode.set(norm(code), c)));
  cartMapCache = { at: Date.now(), data: { carts, byCode } };
  return cartMapCache.data;
}
const cartName = c => c ? (c.cart_name || `Carrinho ${c.cart_number}`) : "";
async function loadOccupancy() {
  const { data, error } = await supabase.rpc("equipa_school_activity", { p_limit: 30 });
  if (error) throw error;
  return data?.occupancy || [];
}
async function loadReturnedToday() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { data } = await supabase.from("withdrawals").select("id,requested_by,custodian_name,responsible_name,class_name,destination,returned_at,withdrawn_at,withdrawal_items(equipment_id,equipments(code))").eq("status", "returned").gte("returned_at", start.toISOString()).order("returned_at", { ascending: false }).limit(12);
  return data || [];
}
const minutesTo = iso => iso ? Math.round((new Date(iso).getTime() - Date.now()) / 60000) : null;
const span = mins => { const m = Math.abs(mins); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
const hhmm = iso => iso ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
const dayLabel = iso => { if (!iso) return ""; const d = new Date(iso), t = new Date(); const same = d.toDateString() === t.toDateString(); const tm = new Date(t); tm.setDate(t.getDate() + 1); return same ? "hoje" : d.toDateString() === tm.toDateString() ? "amanhã" : dateOnly(iso); };
function tone(due) { const m = minutesTo(due); return m == null ? "ok" : m < 0 ? "late" : m <= 60 ? "soon" : "ok"; }

/* ---------- Painel (comandas) ---------- */
let boardTimer = 0;
async function renderMoves(gen) {
  const s = state.moves;
  s.scope ||= "all";
  clearInterval(boardTimer);
  qs("#view").innerHTML = `<div class="toolbar">
      <div class="segmented segmented-lg" role="tablist"><button type="button" role="tab" data-tab="now" class="${s.tab === "now" ? "on" : ""}">${icon("board", 17)}<span>Painel</span></button><button type="button" role="tab" data-tab="history" class="${s.tab === "history" ? "on" : ""}">${icon("clock", 17)}<span>Histórico</span></button></div>
      <div class="toolbar-end">${state.profile?.role !== "student" ? `<button type="button" class="btn" id="mv-sheet">${icon("sheet", 18)}<span>Planilha</span></button>` : ""}<button type="button" class="btn" id="mv-back">${icon("back", 18)}<span>Receber</span></button><button type="button" class="btn btn-primary" id="mv-out">${icon("out", 18)}<span>Retirar</span></button></div></div>
    <div class="toolbar"><label class="search">${icon("search", 18)}<input id="mv-q" type="search" value="${esc(s.q)}" placeholder="Pessoa, turma, local ou número" autocomplete="off"></label>
      ${s.tab === "now" ? `<div class="segmented" role="group" aria-label="Quais retiradas"><button type="button" data-scope="all" class="${s.scope === "all" ? "on" : ""}">Todas</button><button type="button" data-scope="mine" class="${s.scope === "mine" ? "on" : ""}">Minhas</button></div>` : `<div class="segmented" role="group">${[["", "Todos"], ["open", "Em aberto"], ["returned", "Devolvidos"]].map(([v, l]) => `<button type="button" data-h="${v}" class="${s.hStatus === v ? "on" : ""}">${l}</button>`).join("")}</div>`}</div>
    <div id="mv-body">${loadingState()}</div>`;
  qsa("[data-tab]").forEach(b => b.addEventListener("click", () => { s.tab = b.dataset.tab; renderMoves(++viewGen); }));
  qsa("[data-scope]").forEach(b => b.addEventListener("click", () => { s.scope = b.dataset.scope; qsa("[data-scope]").forEach(x => x.classList.toggle("on", x === b)); paint(); }));
  qsa("[data-h]").forEach(b => b.addEventListener("click", () => { s.hStatus = b.dataset.h; renderMoves(++viewGen); }));
  qs("#mv-out").addEventListener("click", () => openCounter());
  qs("#mv-back").addEventListener("click", openReturnPicker);
  qs("#mv-sheet")?.addEventListener("click", exportEquipments);
  let paint = () => {};
  let t; qs("#mv-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { s.q = e.target.value; paint(); }, 180); });
  if (s.tab === "history") return renderHistory(gen, p => { paint = p; });

  const me = state.session?.user?.id;
  let ws = [], occ = [], done = [], devices = [];
  try {
    [ws, occ, done, devices] = await Promise.all([loadOpenWithdrawals(), isAdmin() ? [] : loadOccupancy().catch(() => []), loadReturnedToday().catch(() => []), loadDevices().catch(() => [])]);
  } catch (error) { if (alive(gen)) qs("#mv-body").innerHTML = emptyState("Não foi possível carregar.", errText(error), "warn"); return; }
  if (!alive(gen)) return;
  const codeOf = new Map(devices.map(d => [String(d.id), d]));
  const tickets = ws.map(w => ({ id: w.id, mine: w.requested_by === me, name: w.custodian_name || w.responsible_name || "Não identificado", role: w.custodian_role, declared: w.custody_mode === "delegate", place: [w.class_name, w.destination].filter(Boolean).join(" · "), start: w.withdrawn_at, due: w.due_at, purpose: w.checkout_purpose, items: w.pending.map(i => ({ id: i.equipment_id, code: i.equipments?.code || codeOf.get(String(i.equipment_id))?.code || "?" })).sort((a, b) => numSort(a.code, b.code)) }));
  // Para quem não é admin: equipamentos fora que não estão nas próprias retiradas.
  const covered = new Set(tickets.flatMap(tk => tk.items.map(i => String(i.id))));
  const others = new Map();
  for (const o of occ) {
    if (covered.has(String(o.equipment_id))) continue;
    const k = `${o.holder_name}|${o.declared ? 1 : 0}`;
    if (!others.has(k)) others.set(k, { readonly: true, name: o.holder_name || "Não identificado", role: o.holder_role, declared: o.declared, items: [] });
    others.get(k).items.push({ id: o.equipment_id, code: codeOf.get(String(o.equipment_id))?.code || "?" });
  }
  const readonly = [...others.values()].map(x => ({ ...x, items: x.items.sort((a, b) => numSort(a.code, b.code)) }));

  paint = () => {
    const filter = list => smartFilter(list, s.q, tk => [tk.name, tk.place, ...tk.items.map(i => i.code)]);
    const mineOnly = s.scope === "mine";
    const live = filter(mineOnly ? tickets.filter(tk => tk.mine) : tickets);
    const ro = mineOnly ? [] : filter(readonly);
    const cols = { late: [], soon: [], ok: [] };
    live.forEach(tk => cols[tone(tk.due)].push(tk));
    Object.values(cols).forEach(c => c.sort((a, b) => new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15)));
    const doneList = smartFilter(done.filter(w => !mineOnly || w.requested_by === me), s.q, w => [w.custodian_name, w.responsible_name, w.class_name, ...(w.withdrawal_items || []).map(i => i.equipments?.code)]);
    const outCount = live.reduce((n, tk) => n + tk.items.length, 0) + ro.reduce((n, tk) => n + tk.items.length, 0);
    setTitle("Controle", `${outCount} equipamento${outCount === 1 ? "" : "s"} fora agora`);
    const col = (key, title, list, extra = "") => `<section class="lane lane-${key}"><header class="lane-head"><span class="lane-dot"></span><h2>${title}</h2><b>${list.length + (key === "ok" ? ro.length : 0)}</b></header><div class="lane-body">${list.map(ticketHtml).join("")}${extra}${!list.length && !extra ? `<p class="lane-empty">${key === "late" ? "Nenhum atraso." : key === "soon" ? "Nada vencendo agora." : "Nenhuma retirada."}</p>` : ""}</div></section>`;
    qs("#mv-body").innerHTML = `<div class="board-sum">
        <div><b>${outCount}</b><span>fora agora</span></div><div><b>${live.length + ro.length}</b><span>${live.length + ro.length === 1 ? "comanda" : "comandas"}</span></div>
        <div class="${cols.late.length ? "is-late" : ""}"><b>${cols.late.length}</b><span>${cols.late.length === 1 ? "atrasada" : "atrasadas"}</span></div><div><b>${doneList.length}</b><span>recebidas hoje</span></div></div>
      ${!isAdmin() && !mineOnly && ro.length ? `<p class="hint">${icon("info", 14)} Comandas de outras pessoas mostram só quem está com cada número. Prazo, turma e local ficam visíveis para quem registrou e para a coordenação.</p>` : ""}
      <div class="board">
        ${col("late", "Atrasadas", cols.late)}
        ${col("soon", "Vencem em até 1 h", cols.soon)}
        ${col("ok", "No prazo", cols.ok, ro.map(ticketHtml).join(""))}
        <section class="lane lane-done"><header class="lane-head"><span class="lane-dot"></span><h2>Recebidas hoje</h2><b>${doneList.length}</b></header><div class="lane-body">${doneList.map(w => `<button type="button" class="ticket t-done" data-w="${esc(w.id)}"><header class="t-top"><span class="t-no">#${esc(w.id)}</span><span class="t-time">${esc(hhmm(w.returned_at))}</span></header><div class="t-who"><b>${esc(w.custodian_name || w.responsible_name || "—")}</b><small>${esc([w.class_name, w.destination].filter(Boolean).join(" · "))}</small></div><div class="t-items">${(w.withdrawal_items || []).map(i => `<span class="t-item">${icon("laptop", 13)}${esc(i.equipments?.code || "?")}</span>`).join("")}</div></button>`).join("") || `<p class="lane-empty">Nada recebido hoje.</p>`}</div></section>
      </div>`;
    qsa("[data-w]").forEach(b => b.addEventListener("click", e => { if (e.target.closest("[data-receive]")) return; openWithdrawal(b.dataset.w); }));
    qsa("[data-receive]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openWithdrawal(b.dataset.receive, { receiveAll: true }); }));
    qsa("[data-ro]").forEach(b => b.addEventListener("click", () => { const tk = ro[Number(b.dataset.ro)]; if (tk) openReadonlyTicket(tk); }));
  };
  const ticketHtml = tk => {
    if (tk.readonly) {
      const i = readonly.indexOf(tk);
      return `<button type="button" class="ticket t-other" data-ro="${i}"><header class="t-top"><span class="t-no">${icon("user", 14)}</span><span class="t-time">em uso</span></header><div class="t-who"><b>${esc(tk.name)}</b><small>${tk.role ? esc(roleLabel(tk.role)) : "Outra pessoa"}${tk.declared ? " · declarado" : ""}</small></div><div class="t-items">${tk.items.map(i => `<span class="t-item">${icon("laptop", 13)}${esc(i.code)}</span>`).join("")}</div></button>`;
    }
    const m = minutesTo(tk.due), late = m != null && m < 0;
    return `<article class="ticket t-${tone(tk.due)}" data-w="${esc(tk.id)}" tabindex="0" role="button" aria-label="Comanda ${esc(tk.id)} de ${esc(tk.name)}">
      <header class="t-top"><span class="t-no">#${esc(tk.id)}</span>${tk.mine ? `<span class="t-mine">minha</span>` : ""}<span class="t-time" data-since="${esc(tk.start || "")}">${tk.start ? span(Math.round((Date.now() - new Date(tk.start)) / 60000)) : ""}</span></header>
      <div class="t-who"><b>${esc(tk.name)}</b><small>${[tk.role ? roleLabel(tk.role) : "", tk.declared ? "declarado" : "", tk.place].filter(Boolean).map(esc).join(" · ")}</small></div>
      <div class="t-items">${tk.items.map(i => `<span class="t-item">${icon("laptop", 13)}${esc(i.code)}</span>`).join("")}</div>
      <footer class="t-foot"><span class="t-due" data-due="${esc(tk.due || "")}">${tk.due ? `${late ? "Atrasada" : "Até"} ${esc(hhmm(tk.due))}${dayLabel(tk.due) !== "hoje" ? ` ${esc(dayLabel(tk.due))}` : ""} · ${late ? "há" : "em"} ${span(m)}` : "Sem prazo"}</span><button type="button" class="btn btn-sm ${late ? "btn-danger" : "btn-primary"}" data-receive="${esc(tk.id)}">${icon("back", 15)}Receber</button></footer>
    </article>`;
  };
  paint();
  // Relógios das comandas andam sozinhos; os dados recarregam a cada minuto.
  let ticks = 0;
  boardTimer = setInterval(() => {
    if (!alive(gen) || state.view !== "moves" || state.moves.tab !== "now") return clearInterval(boardTimer);
    if (++ticks % 2 === 0 && !qs(".overlay")) return renderMoves(++viewGen);
    qsa("[data-since]").forEach(el => { if (el.dataset.since) el.textContent = span(Math.round((Date.now() - new Date(el.dataset.since)) / 60000)); });
  }, 30000);
}
function openReadonlyTicket(tk) {
  const m = openSheet({ size: "sm", title: esc(tk.name), subtitle: `${tk.role ? esc(roleLabel(tk.role)) : "Outra pessoa"}${tk.declared ? " · identidade declarada" : ""}`,
    body: `<p class="hint">${icon("info", 14)} Esta retirada foi registrada por outra conta. Para ver prazo, turma e local, fale com quem registrou ou com a coordenação.</p><div class="slots">${tk.items.map(i => `<button type="button" class="slot s-in_use" data-dev="${esc(i.id)}">${icon("laptop", 22)}<span>${esc(i.code)}</span></button>`).join("")}</div>` });
  qsa("[data-dev]", m).forEach(b => b.addEventListener("click", () => { m.close(); openDevice(b.dataset.dev); }));
}
async function renderHistory(gen, setPaint) {
  const s = state.moves;
  const { data, error } = await supabase.rpc("history_events", { p_from: null, p_to: null, p_equipment: null, p_label: null, p_student: null, p_professor: null, p_class_name: null, p_destination: null, p_status: s.hStatus || null, p_equipment_id: null, p_limit: 2000 });
  if (!alive(gen)) return;
  if (error) { qs("#mv-body").innerHTML = emptyState("Erro ao carregar histórico.", errText(error), "warn"); return; }
  setTitle("Controle", "Histórico de retiradas e devoluções");
  const paint = () => {
    const rows = smartFilter(data || [], s.q, x => [x.code, x.label, x.model, x.class_name, x.destination, x.student_name, x.responsible_name, statusLabel(x.status)]).slice(0, 400);
    qs("#mv-body").innerHTML = rows.length ? `<section class="card"><div class="rows">${rows.map(x => `<div class="row"><span class="row-ic s-${x.status === "returned" ? "available" : "in_use"}">${icon(x.status === "returned" ? "back" : "out", 16)}</span><span class="row-main"><b>Nº ${esc(x.code || x.label || "?")}${x.model ? ` · ${esc(x.model)}` : ""}</b><small>${esc(x.student_name || x.responsible_name || "Sem responsável")}${[x.class_name, x.destination].filter(Boolean).length ? ` · ${esc([x.class_name, x.destination].filter(Boolean).join(" · "))}` : ""}</small></span><span class="row-side">${esc(dt(x.returned_at || x.withdrawn_at))}</span></div>`).join("")}</div></section>` : emptyState("Nada encontrado.", s.q ? "Tente outro nome, número ou turma." : "As movimentações aparecem aqui.", "clock");
  };
  setPaint(paint); paint();
}

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

/* ---------- Receber ---------- */
async function openReturnPicker() {
  const m = openSheet({ size: "md", title: "Receber equipamentos", subtitle: "Escolha a comanda ou aponte a câmera para cada equipamento.", body: loadingState(), foot: `<button class="btn btn-primary" type="button" id="rt-cam">${icon("camera", 18)}<span>Receber pela câmera</span></button>` });
  qs("#rt-cam", m).addEventListener("click", () => { m.close(); openReturnCamera(); });
  let ws;
  try { ws = await loadOpenWithdrawals(); } catch (error) { setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); return; }
  if (!m.isConnected) return;
  const me = state.session?.user?.id;
  ws.sort((a, b) => (b.overdue - a.overdue) || ((b.requested_by === me) - (a.requested_by === me)) || new Date(a.due_at || 8.64e15) - new Date(b.due_at || 8.64e15));
  setSheet(m, { body: ws.length ? `<label class="search">${icon("search", 18)}<input id="rt-q" type="search" placeholder="Pessoa, turma ou número" autocomplete="off"></label><div class="rows card" id="rt-list"></div>` : emptyState("Nada para receber", "Nenhuma retirada aberta registrada por você.", "check") });
  const paint = () => {
    const vis = smartFilter(ws, qs("#rt-q", m)?.value || "", w => [w.custodian_name, w.responsible_name, w.class_name, w.destination, ...w.pending.map(i => i.equipments?.code)]);
    qs("#rt-list", m).innerHTML = vis.map(withdrawalRow).join("") || emptyState("Nada encontrado.", "", "search");
    qsa("[data-w]", m).forEach(b => b.addEventListener("click", () => { m.close(); openWithdrawal(b.dataset.w); }));
  };
  if (ws.length) { paint(); qs("#rt-q", m).addEventListener("input", paint); }
}
function openReturnCamera() {
  EquipaCamera.open({ mode: "return", doneLabel: "Concluir", onPick: async d => {
    if (d.status !== "in_use") return { ok: false, text: `Nº ${d.code} não está emprestado (${statusLabel(d.status).toLowerCase()})` };
    const { error } = await supabase.rpc("return_equipment", { p_equipment_id: d.id, p_client_action_id: uid() });
    if (error) return { ok: false, text: errText(error) };
    d.status = "available"; invalidateData();
    return { ok: true, text: `Nº ${d.code} recebido` };
  }, onClose: () => { if (["home", "moves", "devices", "carts"].includes(state.view)) refreshView(); } });
}
/** Depois de receber com avaria: abre a manutenção de cada equipamento sem precisar procurar. */
function offerMaintenance(items, withdrawalId) {
  const m = openSheet({ size: "sm", title: "Abrir manutenção?", subtitle: "Recebido com avaria: " + items.map(i => "Nº " + (i.equipments?.code || "?")).join(", "),
    body: '<form id="om-form" class="form"><label class="field"><span>O que aconteceu? *</span><input name="title" required maxlength="160" value="Avaria na devolução (comanda #' + esc(withdrawalId) + ')"></label><label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="2"></textarea></label></form>',
    foot: '<button class="btn" type="button" data-close>Agora não</button><button class="btn btn-primary" type="submit" form="om-form">Abrir manutenção</button>' });
  qs("#om-form", m).addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget), b = qs('.sheet-foot [type="submit"]', m); setBusy(b, true, "Abrindo…");
    let ok = 0, fail = 0;
    for (const i of items) {
      const { error } = await supabase.rpc("open_maintenance", { p_equipment_id: i.equipment_id, p_title: clean(f.get("title")), p_notes: clean(f.get("notes")) || null, p_client_action_id: uid() });
      if (error && !/MAINTENANCE_ALREADY_OPEN/.test(error.message || "")) fail++; else ok++;
    }
    setBusy(b, false); m.close(); invalidateData();
    notify(fail ? ok + " em manutenção, " + fail + " não foi possível." : ok + " equipamento(s) em manutenção.", fail ? "warning" : "success");
  });
}
function withdrawalRow(w) {
  const n = w.pending.length || (w.withdrawal_items || []).length;
  const codes = w.pending.map(i => i.equipments?.code).filter(Boolean).sort(numSort);
  return `<button type="button" class="row ${w.overdue ? "row-late" : ""}" data-w="${esc(w.id)}"><span class="row-dot"></span><span class="row-main"><b>${esc(w.custodian_name || w.responsible_name || "Não identificado")}</b><small>${esc([w.class_name, w.destination].filter(Boolean).join(" · "))} · ${n} equip.${codes.length ? ` · Nº ${esc(codes.slice(0, 6).join(", "))}${codes.length > 6 ? "…" : ""}` : ""}</small></span><span class="row-side ${w.overdue ? "danger" : ""}">${esc(relativeDue(w.due_at))}</span>${icon("chevron", 16)}</button>`;
}
/** Comanda aberta: toque em cada número para marcar como recebido (ou avaria / não achado). */
async function openWithdrawal(id, { receiveAll = false } = {}) {
  const m = openSheet({ size: "md", className: "receive", title: `Comanda #${esc(id)}`, body: loadingState() });
  const [{ data: w, error: we }, { data: items, error: ie }] = await Promise.all([
    supabase.from("withdrawals").select("id,class_name,destination,responsible_name,student_name,status,withdrawn_at,returned_at,due_at,checkout_purpose,purpose_details,custodian_name,custodian_role,custody_mode,recorded_by_name,recorded_by_role").eq("id", id).single(),
    supabase.from("withdrawal_items").select("id,equipment_id,returned_at,return_condition,equipments(id,code,label,model,school_group)").eq("withdrawal_id", id).order("id")
  ]);
  if (!m.isConnected) return;
  if (we || ie) { setSheet(m, { body: emptyState("Não foi possível abrir.", errText(we || ie), "warn") }); return; }
  const list = (items || []).sort((a, b) => numSort(a.equipments?.code, b.equipments?.code));
  const carts = await loadCartMap().catch(() => ({ byCode: new Map() }));
  const homeOf = new Map();
  for (const i of list) { const c = carts.byCode.get(norm(i.equipments?.code)); const k = c ? cartName(c) : "Sem carrinho"; if (!homeOf.has(k)) homeOf.set(k, []); homeOf.get(k).push(i.equipments?.code || "?"); }
  const homeLine = [...homeOf].map(([k, v]) => k + " (Nº " + v.join(", ") + ")").join(" · ");
  const pending = list.filter(x => !x.returned_at);
  const states = ["pending", "returned", "damaged", "missing"], label = { pending: "fora", returned: "recebido", damaged: "avaria", missing: "não achado" };
  const mark = new Map(pending.map(i => [String(i.equipment_id), receiveAll || pending.length === 1 ? "returned" : "pending"]));
  const mins = minutesTo(w.due_at), late = w.status === "open" && mins != null && mins < 0;
  const who = w.custodian_name || w.responsible_name || "Não identificado";
  const facts = [["Turma / setor", w.class_name], ["Onde", w.destination], ["Para quê", purposeLabel(w.checkout_purpose) + (w.purpose_details ? ` — ${w.purpose_details}` : "")], ["Registrado por", [w.recorded_by_name || w.responsible_name, w.recorded_by_role ? roleLabel(w.recorded_by_role) : ""].filter(Boolean).join(" · ")], ["Saiu", dt(w.withdrawn_at)], ["Devolver até", dt(w.due_at)], ...(w.returned_at ? [["Encerrada", dt(w.returned_at)]] : [])];
  const paint = () => {
    const n = [...mark.values()].filter(v => v !== "pending").length;
    setSheet(m, { title: `Comanda #${esc(id)} · ${esc(who)}`, subtitle: `${w.custodian_role ? esc(roleLabel(w.custodian_role)) + " · " : ""}${w.custody_mode === "delegate" ? "identidade declarada" : w.custody_mode === "self" ? "conta autenticada" : "registro antigo"}`,
      body: `${late ? `<div class="callout callout-danger">${icon("clock", 18)}<span><b>Atrasada há ${span(mins)}</b> — prazo era ${esc(dt(w.due_at))}.</span></div>` : ""}
        ${pending.length ? `<div class="section-head"><h3>Toque em cada número que voltou</h3>${pending.length > 1 ? `<button type="button" class="btn btn-sm" id="rt-all">${icon("check", 15)} Todos voltaram</button>` : ""}</div>` : ""}
        ${pending.length ? `<p class="hint">${icon("cart", 14)} Guardar em: ${esc(homeLine)}</p>` : ""}
        <div class="slots slots-lg">${list.map(i => { const st = i.returned_at ? (i.return_condition === "damaged" ? "damaged" : "returned") : mark.get(String(i.equipment_id)); return `<button type="button" class="slot r-${st} ${i.returned_at ? "locked" : ""}" data-r="${esc(i.equipment_id)}" ${i.returned_at ? "disabled" : ""}>${icon("laptop", 24)}<span>${esc(i.equipments?.code || "?")}</span><small>${i.returned_at ? `${label[st]} ${esc(hhmm(i.returned_at))}` : label[st]}</small></button>`; }).join("")}</div>
        ${pending.length > 0 ? `<p class="hint">${icon("info", 14)} Toque de novo para marcar <b>avaria</b> ou <b>não achado</b>. O que ficar “fora” continua na comanda.</p>` : ""}
        <dl class="info">${facts.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`,
      foot: pending.length ? `<button class="btn" type="button" id="rt-cam">${icon("camera", 17)}<span>Câmera</span></button><button class="btn btn-primary btn-lg" type="button" id="rt-go" ${n ? "" : "disabled"}>Receber ${n || ""}</button>` : `<button class="btn btn-primary" type="button" data-close>Fechar</button>` });
    qsa("[data-r]:not([disabled])", m).forEach(b => b.addEventListener("click", () => { const k = b.dataset.r; mark.set(k, states[(states.indexOf(mark.get(k)) + 1) % states.length]); paint(); }));
    qs("#rt-all", m)?.addEventListener("click", () => { mark.forEach((_, k) => mark.set(k, "returned")); paint(); });
    qs("#rt-cam", m)?.addEventListener("click", () => EquipaCamera.open({ mode: "return", doneLabel: "Voltar à comanda", onPick: d => { const k = String(d.id); if (!mark.has(k)) return { ok: false, text: `Nº ${d.code} não é desta comanda` }; mark.set(k, "returned"); paint(); return { ok: true, text: `Nº ${d.code} marcado` }; } }));
    qs("#rt-go", m)?.addEventListener("click", submit);
  };
  const action = uid();
  const submit = async () => {
    const entries = [...mark.entries()].map(([equipment_id, condition]) => ({ equipment_id, condition }));
    if (!entries.some(x => x.condition !== "pending")) return;
    const b = qs("#rt-go", m); setBusy(b, true, "Registrando…");
    const { data, error } = await supabase.rpc("equipa_return_items", { p_withdrawal_id: Number(id), p_items: entries, p_client_action_id: action });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    invalidateData();
    notify(data?.complete ? `Comanda #${id} encerrada.` : `${data?.pending ?? "?"} ainda fora.`, "success");
    m.close(); if (["home", "moves", "devices", "carts"].includes(state.view)) refreshView();
    const damaged = list.filter(i => mark.get(String(i.equipment_id)) === "damaged");
    if (damaged.length && isAdmin()) offerMaintenance(damaged, id);
  };
  paint();
}

/* ---------- Carrinhos (quadro com vagas) ---------- */
async function renderCarts(gen) {
  const admin = isAdmin();
  qs("#view").innerHTML = `<div class="toolbar"><label class="search">${icon("search", 18)}<input id="cr-q" type="search" value="${esc(state.carts.q)}" placeholder="Carrinho, local ou número" autocomplete="off"></label><div class="toolbar-end">${state.profile?.role !== "student" ? `<button class="btn" id="cr-sheet" type="button">${icon("sheet", 18)}<span>Planilha</span></button>` : ""}${admin ? `<button class="btn btn-primary" id="cr-new" type="button">${icon("plus", 18)}<span>Novo carrinho</span></button>` : ""}</div></div><div id="cr-list">${loadingState()}</div>`;
  qs("#cr-new")?.addEventListener("click", () => openCartForm());
  qs("#cr-sheet")?.addEventListener("click", exportEquipments);
  let map, devices, lateIds = new Set();
  try { [map, devices] = await Promise.all([loadCartMap(true), loadDevices()]); } catch (error) { if (alive(gen)) qs("#cr-list").innerHTML = emptyState("Erro ao carregar.", errText(error), "warn"); return; }
  try { (await loadOpenWithdrawals()).filter(w => w.overdue).forEach(w => w.pending.forEach(i => lateIds.add(String(i.equipment_id)))); } catch {}
  if (!alive(gen)) return;
  const byCode = new Map(devices.map(d => [norm(d.code), d]));
  const st = d => !d ? "unavailable" : d.status === "in_use" && lateIds.has(String(d.id)) ? "overdue" : d.status;
  setTitle("Carrinhos", `${map.carts.length} carrinho(s) · ${map.byCode.size} equipamento(s) guardados neles`);
  const paint = () => {
    const rows = smartFilter(map.carts, state.carts.q, c => [cartName(c), `carrinho ${c.cart_number}`, c.location_text, ...(c.equipment_codes || [])]);
    qs("#cr-list").innerHTML = rows.length ? `<div class="cart-board">${rows.map(c => {
      const codes = (c.equipment_codes || []).slice().sort(numSort), ds = codes.map(code => ({ code, d: byCode.get(norm(code)) }));
      const n = k => ds.filter(x => st(x.d) === k).length, inside = n("available");
      const cap = Number(c.capacity || 0), empty = Math.max(0, cap - codes.length);
      return `<article class="cart-panel">
        <header class="cart-head"><span class="cart-ic">${icon("cart", 24)}</span><div><h2>${esc(cartName(c))}</h2><small>${esc(c.location_text || "Local não informado")}</small></div><span class="cart-count"><b>${inside}</b>/${codes.length}<small>no carrinho</small></span></header>
        <div class="cart-stats"><span class="lg s-available">${inside} guardados</span><span class="lg s-in_use">${n("in_use")} fora</span>${n("overdue") ? `<span class="lg s-overdue">${n("overdue")} atrasados</span>` : ""}${n("maintenance") ? `<span class="lg s-maintenance">${n("maintenance")} manutenção</span>` : ""}</div>
        <div class="slots">${ds.map(x => `<button type="button" class="slot s-${st(x.d)}" ${x.d ? `data-dev="${esc(x.d.id)}"` : "disabled"} title="Nº ${esc(x.code)} · ${esc(statusLabel(st(x.d)))}">${icon("laptop", 20)}<span>${esc(x.code)}</span></button>`).join("")}${Array.from({ length: Math.min(empty, 60) }, () => `<span class="slot slot-empty" aria-hidden="true"></span>`).join("")}</div>
        <footer class="cart-foot"><button class="btn btn-sm" type="button" data-qr="${esc(c.qr_token)}">${icon("qr", 15)}QR</button>${admin ? `<button class="btn btn-sm" type="button" data-edit="${esc(c.qr_token)}">${icon("edit", 15)}Editar</button>` : ""}<button class="btn btn-sm" type="button" data-audit="${esc(c.qr_token)}">${icon("camera", 15)}Conferir</button><button class="btn btn-sm btn-primary" type="button" data-open="${esc(c.qr_token)}" ${inside ? "" : "disabled"}>${icon("out", 15)}Retirar</button></footer>
      </article>`;
    }).join("")}</div>` : emptyState("Nenhum carrinho.", admin ? "Crie um carrinho e diga quais números ficam nele (ex.: 1-30)." : "", "cart");
    const byToken = new Map(map.carts.map(c => [c.qr_token, c]));
    qsa("[data-dev]").forEach(b => b.addEventListener("click", () => openDevice(b.dataset.dev)));
    qsa("[data-open]").forEach(b => b.addEventListener("click", () => openCart(b.dataset.open)));
    qsa("[data-qr]").forEach(b => b.addEventListener("click", () => openQr(b.dataset.qr, cartName(byToken.get(b.dataset.qr)), "Carrinho")));
    qsa("[data-edit]").forEach(b => b.addEventListener("click", () => { const c = byToken.get(b.dataset.edit); openCartForm({ id: c.cart_id, number: c.cart_number, name: c.cart_name, qr_token: c.qr_token, location_text: c.location_text, capacity: c.capacity, notes: c.notes, equipment_codes: c.equipment_codes || [] }); }));
    qsa("[data-audit]").forEach(b => b.addEventListener("click", () => openCartAudit(byToken.get(b.dataset.audit), byCode)));
  };
  let t; qs("#cr-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { state.carts.q = e.target.value; paint(); }, 150); });
  paint();
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
async function openCart(token) {
  const m = openSheet({ size: "lg", title: "Carrinho", body: loadingState() });
  const { data, error } = await supabase.rpc("cart_scan_equipment_list_v2", { p_qr_token: token });
  if (!m.isConnected) return;
  if (error) { setSheet(m, { body: emptyState("Não foi possível abrir.", errText(error), "warn") }); return; }
  const items = (data || []).sort((a, b) => numSort(a.code, b.code));
  if (!items.length) { setSheet(m, { body: emptyState("Carrinho vazio ou indisponível.", "", "cart") }); return; }
  const c = items[0], title = c.cart_name || `Carrinho ${c.cart_number}`;
  const free = items.filter(x => x.is_active && x.status === "available");
  const sel = new Set(free.slice(0, 60).map(x => String(x.equipment_id)));
  const paint = () => {
    setSheet(m, { title: `${icon("cart", 20)} ${esc(title)}`, subtitle: `${esc(c.cart_location || "Local não informado")} · ${free.length} de ${items.length} no carrinho`,
      body: `<div class="row-between"><span class="hint">Toque para tirar ou pôr na comanda.</span><div class="row-wrap"><button class="btn btn-sm" type="button" id="cs-none">Nenhum</button><button class="btn btn-sm" type="button" id="cs-all">Todos livres</button></div></div>
        <div class="slots">${items.map(i => { const ok = i.is_active && i.status === "available"; return `<button type="button" class="slot s-${esc(ok ? "available" : i.status)} ${sel.has(String(i.equipment_id)) ? "picked" : ""}" data-ci="${esc(i.equipment_id)}" ${ok ? "" : "disabled"}>${icon("laptop", 22)}<span>${esc(i.code)}</span></button>`; }).join("")}</div>
        ${c.cart_notes ? `<p class="hint">${esc(c.cart_notes)}</p>` : ""}`,
      foot: `<button class="btn" type="button" id="cs-qr">${icon("qr", 18)}<span>QR</span></button><button class="btn btn-primary btn-lg" type="button" id="cs-out" ${sel.size ? "" : "disabled"}>Retirar ${sel.size}</button>` });
    qsa("[data-ci]", m).forEach(b => b.addEventListener("click", () => { const id = b.dataset.ci; if (sel.has(id)) sel.delete(id); else if (sel.size < 60) sel.add(id); else notify("Até 60 por retirada.", "warning"); paint(); }));
    qs("#cs-none", m).addEventListener("click", () => { sel.clear(); paint(); });
    qs("#cs-all", m).addEventListener("click", () => { free.slice(0, 60).forEach(x => sel.add(String(x.equipment_id))); paint(); });
    qs("#cs-qr", m).addEventListener("click", () => openQr(token, title, `${items.length} equipamentos`));
    qs("#cs-out", m).addEventListener("click", () => { const chosen = items.filter(i => sel.has(String(i.equipment_id))).map(i => ({ ...i, id: i.equipment_id })); if (!chosen.length) return; m.close(); openCounter(chosen, { step: "ticket" }); });
  };
  paint();
}
async function openCartForm(rec = null) {
  const editing = !!rec?.id;
  const [devices, map] = await Promise.all([loadDevices().catch(() => []), loadCartMap().catch(() => ({ carts: [], byCode: new Map() }))]);
  const nextNumber = Math.max(0, ...map.carts.map(c => Number(c.cart_number) || 0)) + 1;
  const m = openSheet({ size: "md", title: editing ? "Editar carrinho" : "Novo carrinho", subtitle: "Diga quais números ficam guardados nele.",
    body: `<form id="cart-form" class="form" autocomplete="off"><div class="grid-2"><label class="field"><span>Número do carrinho *</span><input name="number" type="number" min="1" required value="${esc(rec?.number || nextNumber)}"></label><label class="field"><span>Nome</span><input name="name" maxlength="120" value="${esc(rec?.name || "")}" placeholder="Ex.: Carrinho azul"></label>
      <label class="field"><span>Onde fica</span><input name="location_text" maxlength="160" value="${esc(rec?.location_text || "")}" placeholder="Ex.: Sala maker" list="cart-locs"></label><label class="field"><span>Vagas</span><input name="capacity" type="number" min="1" max="200" value="${esc(rec?.capacity || "")}" placeholder="Automático"></label></div>
      ${EquipaSettings.locationDatalist("cart-locs", devices.map(d => d.location_text))}
      <label class="field"><span>Números dos equipamentos *</span><textarea name="codes" required rows="3" placeholder="1-30  ou  1, 2, 3">${esc(compactCodes(rec?.equipment_codes || []))}</textarea><small class="hint">Aceita intervalos: “1-30” vira 1, 2, … 30. Vários: “1-15, TP-01-TP-05”.</small></label>
      <div class="preview" id="cart-check" aria-live="polite"></div>
      <label class="check" id="cart-move-wrap" hidden><input type="checkbox" name="move"><span>Tirar estes equipamentos do outro carrinho e colocar neste</span></label>
      <label class="check"><input type="checkbox" name="set_location" checked><span>Atualizar o local dos equipamentos para o local do carrinho</span></label>
      <label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="2">${esc(rec?.notes || "")}</textarea></label></form>`,
    foot: `${editing ? `<button class="btn btn-ghost danger" type="button" id="cart-off">Desativar</button>` : ""}<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="cart-form">Salvar</button>` });
  const form = qs("#cart-form", m), check = qs("#cart-check", m);
  const byCode = new Map(devices.map(d => [norm(d.code), d]));
  // Confere tudo antes de enviar: número do carrinho, números inexistentes e equipamentos em outro carrinho.
  const analyse = () => {
    const codes = expandCodes(form.elements.codes.value), number = Number(form.elements.number.value);
    const missing = codes.filter(c => !byCode.has(norm(c)));
    const taken = codes.filter(c => { const c2 = map.byCode.get(norm(c)); return c2 && String(c2.cart_id) !== String(rec?.id ?? ""); });
    const numberTaken = map.carts.find(c => Number(c.cart_number) === number && String(c.cart_id) !== String(rec?.id ?? ""));
    const cap = Number(form.elements.capacity.value) || 0;
    const msgs = [];
    if (numberTaken) msgs.push(`O número ${number} já é do “${esc(cartName(numberTaken))}”. Use ${nextNumber}.`);
    if (missing.length) msgs.push(`Não cadastrados: <b>${esc(missing.slice(0, 12).join(", "))}${missing.length > 12 ? "…" : ""}</b>. Cadastre antes ou corrija.`);
    if (taken.length) msgs.push(`Já estão em outro carrinho: <b>${esc(taken.slice(0, 12).join(", "))}${taken.length > 12 ? "…" : ""}</b>.`);
    if (cap && codes.length > cap) msgs.push(`São ${codes.length} equipamentos para ${cap} vagas.`);
    check.innerHTML = codes.length ? `<div class="preview-head"><b>${codes.length - missing.length} equipamento(s) no carrinho</b></div>${msgs.length ? `<div class="callout callout-warn">${icon("warn", 16)}<span>${msgs.join("<br>")}</span></div>` : ""}` : "";
    qs("#cart-move-wrap", m).hidden = !taken.length;
    return { codes, missing, taken, numberTaken, cap };
  };
  form.addEventListener("input", analyse); analyse();
  qs("#cart-off", m)?.addEventListener("click", async () => {
    if (!await confirmAction({ title: "Desativar carrinho?", message: "Ele sai da operação; o histórico fica guardado. O número pode ser reaproveitado depois.", confirmText: "Desativar", danger: true })) return;
    const { error } = await supabase.from("equipment_carts").update({ is_active: false }).eq("id", Number(rec.id));
    if (error) return notify(errText(error), "error"); notify("Carrinho desativado.", "success"); m.close(); cartMapCache.at = 0; refreshView();
  });
  form.addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(form), b = qs('.sheet-foot [type="submit"]', m);
    const a = analyse();
    if (!a.codes.length) return notify("Informe os números dos equipamentos.", "warning");
    if (a.numberTaken) return notify("Esse número de carrinho já está em uso.", "warning");
    if (a.missing.length) return notify("Há números que não estão cadastrados.", "warning");
    if (a.taken.length && !form.elements.move.checked) return notify("Marque a opção de tirar do outro carrinho, ou remova esses números.", "warning");
    if (a.cap && a.codes.length > a.cap) return notify("Mais equipamentos do que vagas.", "warning");
    const args = { p_cart_id: editing ? Number(rec.id) : null, p_number: Number(f.get("number")), p_name: clean(f.get("name")) || null, p_equipment_codes: a.codes, p_location_text: clean(f.get("location_text")) || null, p_capacity: f.get("capacity") ? Number(f.get("capacity")) : null, p_notes: clean(f.get("notes")) || null };
    setBusy(b, true, "Salvando…");
    try {
      let res = await supabase.rpc("equipa_save_cart", { ...args, p_move: !!form.elements.move.checked });
      // Banco sem a migração 1.0: usa a função antiga (sem mover entre carrinhos).
      if (res.error && /PGRST202|42883|could not find the function/i.test(`${res.error.code} ${res.error.message}`)) {
        if (a.taken.length) throw new Error("Para mover equipamentos entre carrinhos, aplique a migração 1.0 no Supabase.");
        res = await supabase.rpc("save_equipment_cart_v2", args);
      }
      if (res.error) throw res.error;
      if (f.get("set_location") && args.p_location_text) {
        const ids = a.codes.map(c => byCode.get(norm(c))?.id).filter(Boolean);
        for (let i = 0; i < ids.length; i += 100) await supabase.from("equipments").update({ location_text: args.p_location_text }).in("id", ids.slice(i, i + 100));
      }
      notify(editing ? "Carrinho atualizado." : res.data?.reused ? "Carrinho reativado com o mesmo número e QR." : "Carrinho criado.", "success");
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

/* ---------- Planilha: cada PC, número, carrinho e onde está ---------- */
async function exportEquipments() {
  notify("Montando a planilha…", "info");
  try {
    await ensureXLSXLib();
    const all = [];
    for (let from = 0; from < 10000; from += 1000) { const { data, error } = await supabase.from("equipments").select("id,code,asset_tag,brand,model,school_group,serial_number,location_text,status,is_active,updated_at,operating_system,processor,ram_gb,storage_gb" + (EquipaSettings.hasSpecs() ? ",specs" : "")).order("code").range(from, from + 999); if (error) throw error; all.push(...(data || [])); if ((data || []).length < 1000) break; }
    const [map, ws, occ] = await Promise.all([loadCartMap(true).catch(() => ({ byCode: new Map() })), loadOpenWithdrawals().catch(() => []), isAdmin() ? [] : loadOccupancy().catch(() => [])]);
    const holder = new Map();
    ws.forEach(w => w.pending.forEach(i => holder.set(String(i.equipment_id), { name: w.custodian_name || w.responsible_name || "", turma: w.class_name || "", destino: w.destination || "", due: w.due_at, late: w.overdue, id: w.id })));
    occ.forEach(o => { if (!holder.has(String(o.equipment_id))) holder.set(String(o.equipment_id), { name: o.holder_name || "" }); });
    const rows = all.sort((a, b) => numSort(a.code, b.code)).map(e => {
      const c = map.byCode.get(norm(e.code)), h = e.status === "in_use" ? holder.get(String(e.id)) : null;
      const where = !e.is_active ? "Fora do catálogo" : h ? `Com ${h.name || "não identificado"}${h.destino ? ` — ${h.destino}` : ""}` : e.status === "maintenance" ? "Manutenção" : c ? `${cartName(c)}${c.location_text ? ` (${c.location_text})` : ""}` : e.location_text || "Não informado";
      return { "Número": e.code, "Modelo": e.model, "Tipo": schoolGroupLabel(e.school_group), "Carrinho": cartName(c), "Onde está agora": where, "Situação": !e.is_active ? "Desativado" : h?.late ? "Atrasado" : statusLabel(e.status), "Com quem": h?.name || "", "Turma/setor": h?.turma || "", "Destino": h?.destino || "", "Devolver até": h?.due ? dt(h.due) : "", "Comanda": h?.id ? `#${h.id}` : "", "Local cadastrado": e.location_text || "", "Nº de série": e.serial_number || "", "Patrimônio": e.asset_tag || "", "Marca": e.brand && e.brand !== "Não informado" ? e.brand : "", "Plataforma": e.operating_system || "", "Processador": e.processor || "", "RAM (GB)": e.ram_gb || "", "Armazenamento (GB)": e.storage_gb || "", ...Object.fromEntries(EquipaSettings.fields().map(f => [f.label, e.specs?.[f.key] || ""])), "Atualizado": dt(e.updated_at) };
    });
    const sheet = window.XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0] || {});
    sheet["!cols"] = headers.map(h => ({ wch: Math.min(34, Math.max(9, h.length + 2, ...rows.slice(0, 200).map(r => String(r[h] ?? "").length + 1))) }));
    if (headers.length) sheet["!autofilter"] = { ref: `A1:${window.XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` };
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, sheet, "Equipamentos");
    // Uma aba por carrinho, para impressão rápida na conferência.
    (map.carts || []).forEach(c => { const set = new Set((c.equipment_codes || []).map(norm)); const part = rows.filter(r => set.has(norm(r["Número"]))).map(r => ({ "Número": r["Número"], "Modelo": r["Modelo"], "Situação": r["Situação"], "Com quem": r["Com quem"], "Conferido": "" })); if (part.length) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(part), safeFileName(cartName(c)).slice(0, 31)); });
    window.XLSX.writeFile(wb, `Equipa-onde-esta-cada-PC-${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify(`Planilha com ${rows.length} equipamentos baixada.`, "success");
  } catch (error) { notify(errText(error), "error"); }
}
