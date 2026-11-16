/* Equipa — tela Controle (painel de comandas e histórico).
 *
 * Visibilidade (regra do banco, policy withdrawals_select_by_role): cada professor
 * ou aluno lê só as retiradas que ELE registrou; a administração lê todas.
 *  - "Minhas": retiradas da conta, completas (prazo, turma, local).
 *  - "Todas": para a administração, tudo; para os demais, as próprias completas +
 *    quem está com cada equipamento (RPC equipa_school_activity), sem expor prazo,
 *    turma ou local de terceiros.
 * O painel funciona como um quadro de comandas: colunas por urgência, relógio e
 * botão de receber em cada cartão. */
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
