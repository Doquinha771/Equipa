/* Equipa — tela Auditoria.
 * Eventos paginados no servidor, filtros por tipo e ação. */
"use strict";

/* ===================== Auditoria ===================== */
const auditActionLabel = v => ({ insert: "Criado", update: "Alterado", delete: "Excluído", approve: "Aprovado", restore: "Restaurado", remove: "Acesso removido", deactivate: "Desativado", ban: "Banido", unban: "Desbanido" })[v] || v || "Evento";
const auditEntityLabel = v => ({ equipments: "Equipamento", withdrawals: "Retirada", withdrawal_items: "Item de retirada", equipment_carts: "Carrinho", equipment_cart_items: "Item do carrinho", maintenance_events: "Manutenção", profiles: "Usuário", user_access: "Acesso de usuário", legal_acceptances: "Aceite legal" })[v] || v || "Registro";
/** Cor por gravidade: vermelho para o que apaga ou bloqueia, verde para o que cria ou libera. */
const auditTone = a => ["delete", "remove", "ban", "deactivate"].includes(a) ? "overdue" : ["insert", "approve", "restore", "unban"].includes(a) ? "available" : "in_use";
const auditIcon = a => ({ delete: "trash", remove: "lock", ban: "x", deactivate: "box", insert: "plus", approve: "check", restore: "refresh", unban: "shield" })[a] || "edit";
async function renderAudit(gen) {
  const s = state.audit;
  const sel = (id, cur, opts) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  qs("#view").innerHTML = `<div class="toolbar toolbar-wrap"><label class="search">${icon("search", 18)}<input id="au-q" type="search" value="${esc(s.q)}" placeholder="Pessoa, resumo ou registro" autocomplete="off"></label>
    <div class="toolbar-end">${sel("au-entity", s.entity, [["", "Todos os tipos"], ...["equipments", "withdrawals", "withdrawal_items", "equipment_carts", "maintenance_events", "profiles", "user_access", "legal_acceptances"].map(v => [v, auditEntityLabel(v)])])}${sel("au-action", s.action, [["", "Todas as ações"], ...["insert", "update", "delete", "approve", "remove", "ban", "unban"].map(v => [v, auditActionLabel(v)])])}</div></div><div id="au-list">${loadingState()}</div>`;
  qs("#au-entity").addEventListener("change", e => { s.entity = e.target.value; s.page = 0; loadAudit(gen); });
  qs("#au-action").addEventListener("change", e => { s.action = e.target.value; s.page = 0; loadAudit(gen); });
  let t; qs("#au-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { s.q = clean(e.target.value); s.page = 0; loadAudit(gen); }, 380); });
  await loadAudit(gen);
}
async function loadAudit(gen) {
  const s = state.audit, size = 25;
  const { data, error } = await supabase.rpc("equipa_admin_audit_page", { p_page: s.page, p_page_size: size, p_entity: s.entity || null, p_action: s.action || null, p_search: s.q || null });
  if (!alive(gen)) return;
  const host = qs("#au-list");
  if (error) { host.innerHTML = emptyState("Erro ao carregar auditoria.", errText(error), "warn"); return; }
  const p = Array.isArray(data) ? data[0] : data || {}, rows = p.rows || [], total = Number(p.total || 0), pages = Math.max(1, Math.ceil(total / size));
  setTitle("Auditoria", `${total} evento(s)`);
  host.innerHTML = rows.length ? `<section class="card"><div class="rows">${rows.map((x, i) => `<button type="button" class="row" data-a="${i}"><span class="row-ic s-${auditTone(x.action)}" aria-hidden="true">${icon(auditIcon(x.action), 16)}</span><span class="row-main"><b>${esc(x.actor_name || "Sistema")} · ${esc(auditActionLabel(x.action))}</b><small>${esc(auditEntityLabel(x.entity_type))}${x.summary ? ` · ${esc(x.summary)}` : ""}</small></span><span class="row-side">${esc(dt(x.occurred_at))}</span>${icon("chevron", 16)}</button>`).join("")}</div></section>
    ${pages > 1 ? `<div class="pager"><button class="btn btn-sm" id="au-prev" ${s.page === 0 ? "disabled" : ""}>Anterior</button><span>Página ${s.page + 1} de ${pages}</span><button class="btn btn-sm" id="au-next" ${s.page + 1 >= pages ? "disabled" : ""}>Próxima</button></div>` : ""}` : emptyState("Nenhum evento.", "Não há registros com esses filtros.", "shield");
  qsa("[data-a]", host).forEach(b => b.addEventListener("click", () => { const x = rows[Number(b.dataset.a)]; openSheet({ size: "md", title: `${esc(auditActionLabel(x.action))} · ${esc(auditEntityLabel(x.entity_type))}`, body: `<dl class="info"><div><dt>Responsável</dt><dd>${esc(x.actor_name || "Sistema")}</dd></div><div><dt>Data</dt><dd>${esc(dt(x.occurred_at))}</dd></div><div><dt>Registro</dt><dd>${esc(x.entity_id || "—")}</dd></div><div><dt>Resumo</dt><dd>${esc(x.summary || "—")}</dd></div></dl><details class="more"><summary>Detalhes técnicos</summary><pre class="code">${esc(JSON.stringify(x.details || {}, null, 2))}</pre></details>` }); }));
  qs("#au-prev")?.addEventListener("click", () => { s.page--; loadAudit(gen); });
  qs("#au-next")?.addEventListener("click", () => { s.page++; loadAudit(gen); });
}
