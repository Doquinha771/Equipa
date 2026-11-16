/* Equipa — tela Início.
 * Indicadores de situação, ações frequentes e retiradas em andamento. */
"use strict";

/* ===================== Início ===================== */
function greeting() { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; }
async function renderHome(gen) {
  const admin = isAdmin();
  setTitle(`${greeting()}, ${firstName()}`, new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date()));
  const count = q => q.then(x => x.count || 0).catch(() => 0);
  const [available, inUse, maint, home, overdueRes] = await Promise.all([
    count(supabase.from("equipments").select("id", { count: "exact", head: true }).eq("is_active", true).eq("status", "available")),
    count(supabase.from("equipments").select("id", { count: "exact", head: true }).eq("status", "in_use")),
    count(supabase.from("equipments").select("id", { count: "exact", head: true }).eq("status", "maintenance")),
    supabase.rpc("home_withdrawals", { p_query: null }),
    supabase.rpc("overdue_withdrawals_count")
  ]);
  if (!alive(gen)) return;
  const overdue = Number(overdueRes?.data || 0);
  const isLate = r => !r.returned_at && r.status !== "returned" && r.due_at && new Date(r.due_at).getTime() < Date.now();
  const rows = (home?.data || []).filter(r => r.status !== "returned" && !r.returned_at)
    .sort((a, b) => (isLate(b) - isLate(a)) || new Date(a.due_at || 8.64e15) - new Date(b.due_at || 8.64e15)).slice(0, 6);
  const action = (id, ic, title, sub, cls = "") => `<button type="button" class="action ${cls}" id="${id}"><span class="action-ic">${icon(ic, 24)}</span><span><b>${title}</b><small>${sub}</small></span></button>`;
  const stat = (key, n, label) => `<button type="button" class="stat stat-${key} ${key === "overdue" && n ? "alert" : ""}" data-stat="${key}"><b>${Number(n).toLocaleString("pt-BR")}</b><span>${label}</span></button>`;
  qs("#view").innerHTML = `
    <section class="actions">
      ${action("a-out", "out", "Retirar", "Abrir uma comanda", "action-primary")}
      ${action("a-back", "back", "Receber", "Guardar de volta")}
      ${action("a-cam", "camera", "Câmera", "Identificar, retirar, conferir")}
      ${admin ? action("a-add", "plus", "Cadastrar", "Novos computadores") : action("a-list", "cart", "Carrinhos", "Ver o que está guardado")}
    </section>
    <section class="stats" aria-label="Situação agora">${stat("available", available, "Disponíveis")}${stat("in_use", inUse, "Em uso")}${stat("overdue", overdue, "Atrasadas")}${stat("maintenance", maint, "Manutenção")}</section>
    <section class="card">
      <header class="card-head"><h2>Fora agora</h2>${rows.length ? `<button type="button" class="link" id="see-moves">Abrir painel</button>` : ""}</header>
      ${rows.length ? `<div class="rows">${rows.map(r => {
        const late = isLate(r), n = Number(r.pending_count || r.total_count || 1);
        return `<button type="button" class="row ${late ? "row-late" : ""}" data-w="${esc(r.withdrawal_id)}"><span class="row-dot"></span><span class="row-main"><b>${esc(r.custodian_name || r.responsible_name || "Não identificado")}</b><small>${esc([r.class_name, r.destination].filter(Boolean).join(" · ") || "Sem turma")} · ${n} ${n === 1 ? "equipamento" : "equipamentos"}</small></span><span class="row-side ${late ? "danger" : ""}">${esc(relativeDue(r.due_at))}</span>${icon("chevron", 16)}</button>`;
      }).join("")}</div>` : emptyState("Nenhum equipamento fora", "Quando alguém retirar, a comanda aparece aqui.", "check")}
    </section>`;
  qs("#a-out").addEventListener("click", () => openCounter());
  qs("#a-back").addEventListener("click", openReturnPicker);
  qs("#a-cam").addEventListener("click", () => EquipaCamera.open({ mode: "find" }));
  qs("#a-add")?.addEventListener("click", () => EquipaRegister.open());
  qs("#a-list")?.addEventListener("click", () => navigate("carts"));
  qs("#see-moves")?.addEventListener("click", () => navigate("moves"));
  qsa("[data-w]").forEach(b => b.addEventListener("click", () => openWithdrawal(b.dataset.w)));
  qsa("[data-stat]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.stat;
    if (k === "overdue") { state.moves.tab = "now"; return navigate("moves"); }
    state.devices.status = k; state.devices.q = ""; navigate("devices");
  }));
}
