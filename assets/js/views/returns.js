/* Equipa — recebimento (devolução e conferência).
 * Comanda por toque (recebido/avaria/não achado), câmera e abertura de manutenção após avaria. */
"use strict";

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
