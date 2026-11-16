/* Equipa — tela Usuários.
 * Lista paginada no servidor, cargos e controle de acesso pela Edge Function. */
"use strict";

/* ===================== Usuários ===================== */
async function renderUsers(gen) {
  const s = state.users;
  qs("#view").innerHTML = `<section class="stats stats-4" id="us-stats"><div class="stat"><b id="us-total">—</b><span>Contas</span></div><div class="stat stat-available"><b id="us-active">—</b><span>Ativas</span></div><div class="stat stat-maintenance"><b id="us-pending">—</b><span>Pendentes ou inativas</span></div><div class="stat"><b id="us-db">—</b><span id="us-db-sub">Banco de dados</span></div></section>
    <div class="toolbar"><label class="search">${icon("search", 18)}<input id="us-q" type="search" value="${esc(s.q)}" placeholder="Nome do usuário" autocomplete="off"></label></div>
    <div class="chips">${[["", "Todos"], ["student", "Alunos"], ["teacher", "Professores"], ["admin", "Administradores"]].map(([v, l]) => `<button type="button" class="chip ${s.role === v ? "on" : ""}" data-r="${v}">${l}</button>`).join("")}</div>
    <div id="us-list">${loadingState()}</div>`;
  qsa("[data-r]").forEach(b => b.addEventListener("click", () => { s.role = b.dataset.r; s.page = 0; qsa("[data-r]").forEach(x => x.classList.toggle("on", x === b)); loadUsers(gen); }));
  let t; qs("#us-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { s.q = clean(e.target.value); s.page = 0; loadUsers(gen); }, 350); });
  loadCapacity(gen);
  await loadUsers(gen);
}
async function loadUsers(gen) {
  const s = state.users, size = 20;
  const { data, error } = await supabase.rpc("equipa_admin_user_page", { p_page: s.page, p_page_size: size, p_role: s.role || null, p_search: s.q || null });
  if (!alive(gen)) return;
  const host = qs("#us-list");
  if (error) { host.innerHTML = emptyState("Não foi possível carregar usuários.", errText(error), "warn"); return; }
  const p = Array.isArray(data) ? data[0] : data || {};
  const users = (p.rows || []).map(u => ({ ...u, is_banned: !!(u.banned_until && new Date(u.banned_until).getTime() > Date.now()) }));
  const pages = Math.max(1, Math.ceil(Number(p.filtered_total || 0) / size));
  qs("#us-total").textContent = Number(p.total || 0); qs("#us-active").textContent = Number(p.active || 0); qs("#us-pending").textContent = Math.max(0, Number(p.total || 0) - Number(p.active || 0));
  setTitle("Usuários", `${Number(p.total || 0)} conta(s)`);
  const status = u => !u.is_active ? ["maintenance", "Aguardando aprovação"] : u.is_banned ? ["overdue", "Banido"] : ["available", "Ativo"];
  // Pendentes e banidos primeiro: são os que pedem ação da administração.
  const rank = u => !u.is_active ? 0 : u.is_banned ? 1 : 2;
  const sorted = users.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u));
  const pendingHere = users.filter(u => !u.is_active).length;
  host.innerHTML = users.length ? `${pendingHere ? `<div class="callout callout-warn">${icon("users", 18)}<span><b>${pendingHere} conta(s) aguardando aprovação</b> nesta página. Confira o nome antes de aprovar.</span></div>` : ""}
    <section class="card"><div class="rows">${sorted.map(({ u, i }) => { const [k, l] = status(u); return `<div class="row user-row"><button type="button" class="row-hit" data-u="${i}" aria-label="Gerenciar ${esc(u.full_name || "usuário")}"><span class="avatar avatar-sm" aria-hidden="true">${esc((u.full_name || "U").trim().slice(0, 1).toUpperCase())}</span><span class="row-main"><b>${esc(u.full_name || "Usuário")}</b><small>${esc(roleLabel(u.role))} · ${esc(u.masked_email || "—")}</small></span></button>${pill(k, l)}${!u.is_active ? `<button class="btn btn-sm btn-primary" type="button" data-approve="${i}">${icon("check", 15)}Aprovar</button>` : ""}<button class="icon-btn" type="button" data-u="${i}" aria-label="Mais opções de ${esc(u.full_name || "usuário")}">${icon("chevron", 16)}</button></div>`; }).join("")}</div></section>
    ${pages > 1 ? `<div class="pager"><button class="btn btn-sm" id="us-prev" ${s.page === 0 ? "disabled" : ""}>Anterior</button><span>Página ${s.page + 1} de ${pages}</span><button class="btn btn-sm" id="us-next" ${s.page + 1 >= pages ? "disabled" : ""}>Próxima</button></div>` : ""}` : emptyState("Nenhum usuário encontrado.", "", "users");
  qsa("[data-u]").forEach(b => b.addEventListener("click", () => openUser(users[Number(b.dataset.u)], gen)));
  qsa("[data-approve]").forEach(b => b.addEventListener("click", async () => {
    const u = users[Number(b.dataset.approve)]; setBusy(b, true, "Aprovando…");
    const { data, error } = await supabase.functions.invoke("equipa-admin-users", { body: { action: "approve", userId: u.id } });
    if (error || data?.error) { setBusy(b, false); return notify(data?.error || errText(error), "error"); }
    notify(`${u.full_name || "Conta"} aprovada.`, "success"); loadUsers(gen);
  }));
  qs("#us-prev")?.addEventListener("click", () => { s.page--; loadUsers(gen); });
  qs("#us-next")?.addEventListener("click", () => { s.page++; loadUsers(gen); });
}
async function loadCapacity(gen) {
  let { data, error } = await supabase.rpc("equipa_admin_capacity"); let legacy = false;
  if (error) { legacy = true; ({ data, error } = await supabase.rpc("admin_capacity_status")); }
  if (!alive(gen)) return;
  const x = Array.isArray(data) ? data[0] : data;
  const mb = legacy ? Number(x?.database_mb) : Number(x?.database_bytes) / 1e6, limit = legacy ? Number(x?.free_limit_mb) : 500;
  if (error || !Number.isFinite(mb)) { qs("#us-db").textContent = "—"; return; }
  qs("#us-db").textContent = `${mb.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  qs("#us-db-sub").textContent = `${(100 * mb / limit).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% de ${limit} MB${x?.warning ? " · atenção" : ""}`;
}
function openUser(u, gen) {
  const m = openSheet({ size: "sm", title: esc(u.full_name || "Usuário"), subtitle: esc(u.masked_email || ""),
    body: `<form id="user-form" class="form"><label class="field"><span>Nome</span><input name="full_name" required maxlength="120" value="${esc(u.full_name || "")}"></label>
      <fieldset class="field"><legend>Cargo</legend><div class="segmented">${["student", "teacher", "admin"].map(r => `<label><input type="radio" name="role" value="${r}" ${u.role === r ? "checked" : ""}><span>${roleLabel(r)}</span></label>`).join("")}</div></fieldset></form>
      <div class="menu">${!u.is_active ? `<button class="menu-item" type="button" data-a="approve">${icon("check", 20)}<span><b>Aprovar acesso</b><small>Libera o inventário para esta conta</small></span></button>` : `<button class="menu-item danger" type="button" data-a="remove">${icon("lock", 20)}<span><b>Remover acesso</b><small>A conta deixa de entrar</small></span></button>`}
      ${u.is_banned ? `<button class="menu-item" type="button" data-a="unban">${icon("shield", 20)}<span><b>Remover banimento</b></span></button>` : `<button class="menu-item danger" type="button" data-a="ban">${icon("x", 20)}<span><b>Banir temporariamente</b><small>Bloqueia novos logins</small></span></button>`}</div>`,
    foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="user-form">Salvar</button>` });
  qs("#user-form", m).addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget), b = qs('.sheet-foot [type="submit"]', m); setBusy(b, true, "Salvando…");
    const { error } = await supabase.rpc("admin_update_user", { p_user_id: u.id, p_full_name: clean(f.get("full_name")), p_role: f.get("role") });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    notify("Usuário atualizado.", "success"); m.close(); loadUsers(gen);
  });
  qsa("[data-a]", m).forEach(b => b.addEventListener("click", async () => {
    const action = b.dataset.a; let hours = null;
    if (action === "ban") {
      const pick = await new Promise(res => { const p = openSheet({ size: "sm", title: `Banir ${esc(u.full_name)}`, subtitle: "O histórico é preservado.", body: `<div class="chips-radio">${[["24", "24 horas"], ["168", "7 dias"], ["720", "30 dias"], ["876000", "Indeterminado"]].map(([v, l], i) => `<label class="chip-radio"><input type="radio" name="ban" value="${v}" ${i === 1 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`, foot: `<button class="btn" data-close type="button">Cancelar</button><button class="btn btn-danger" type="button" id="ban-go">Banir</button>` }); qs("#ban-go", p).addEventListener("click", () => { const v = Number(qs('input[name="ban"]:checked', p).value); p.close(); res(v); }); new MutationObserver((_, o) => { if (!p.isConnected) { o.disconnect(); res(null); } }).observe(document.body, { childList: true }); });
      if (!pick) return; hours = pick;
    } else if (action === "remove" && !await confirmAction({ title: "Remover acesso?", message: `${u.full_name} deixará de entrar. O evento fica na auditoria.`, confirmText: "Remover", danger: true })) return;
    const { data, error } = await supabase.functions.invoke("equipa-admin-users", { body: { action, userId: u.id, hours } });
    if (error || data?.error) return notify(data?.error || errText(error), "error");
    notify("Acesso atualizado.", "success"); m.close(); loadUsers(gen);
  }));
}
