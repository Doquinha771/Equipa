/* Equipa — tela Relatórios.
 * Indicadores agregados no PostgreSQL e exportação CSV. */
"use strict";

/* ===================== Relatórios ===================== */
async function renderReports(gen) {
  const end = new Date(), from = new Date(Date.now() - 30 * 86400000);
  qs("#view").innerHTML = `<div class="toolbar toolbar-wrap"><label class="field field-inline"><span>De</span><input id="rp-from" type="date" value="${from.toISOString().slice(0, 10)}"></label><label class="field field-inline"><span>Até</span><input id="rp-to" type="date" value="${end.toISOString().slice(0, 10)}"></label>
    <label class="field field-inline"><span>Turma</span><input id="rp-class" placeholder="Todas"></label><label class="field field-inline"><span>Tipo</span><select id="rp-group">${groupOptions("", "Todos")}</select></label>
    <div class="toolbar-end"><button class="btn" id="rp-export" type="button">${icon("download", 18)}<span>Exportar</span></button><button class="btn btn-primary" id="rp-go" type="button">${icon("refresh", 18)}<span>Atualizar</span></button></div></div><div id="rp-body">${loadingState("Calculando…")}</div>`;
  qs("#rp-go").addEventListener("click", () => loadReports(gen));
  // Atalhos de período: o caso comum sem abrir calendário.
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  qs("#view .toolbar").insertAdjacentHTML("beforebegin", `<div class="chips" role="group" aria-label="Período">${[[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [365, "12 meses"]].map(([n, l]) => `<button type="button" class="chip ${n === 30 ? "on" : ""}" data-days="${n}">${l}</button>`).join("")}</div>`);
  qsa("[data-days]").forEach(b => b.addEventListener("click", () => {
    const n = Number(b.dataset.days); qs("#rp-to").value = iso(new Date()); qs("#rp-from").value = iso(new Date(Date.now() - n * 86400000));
    qsa("[data-days]").forEach(x => x.classList.toggle("on", x === b)); loadReports(gen);
  }));
  ["#rp-from", "#rp-to", "#rp-group"].forEach(sel => qs(sel).addEventListener("change", () => { qsa("[data-days]").forEach(x => x.classList.remove("on")); loadReports(gen); }));
  qs("#rp-export").addEventListener("click", exportReport);
  await loadReports(gen);
}
async function loadReports(gen) {
  const host = qs("#rp-body"); if (!host) return;
  const start = qs("#rp-from").value, finish = qs("#rp-to").value;
  if (!start || !finish || start > finish) { host.innerHTML = emptyState("Período inválido", "Confira as datas.", "warn"); return; }
  const a = new Date(`${start}T00:00:00`), z = new Date(`${finish}T00:00:00`); z.setDate(z.getDate() + 1);
  if ((z - a) / 86400000 > 370) { host.innerHTML = emptyState("Período muito longo", "Selecione até 370 dias.", "warn"); return; }
  host.innerHTML = loadingState("Calculando…");
  const { data, error } = await supabase.rpc("equipa_admin_report_dashboard", { p_from: a.toISOString(), p_to: z.toISOString(), p_class: clean(qs("#rp-class").value).toLowerCase() || null, p_group: qs("#rp-group").value || null, p_status: null });
  if (!alive(gen)) return;
  if (error || !data) { host.innerHTML = emptyState("Relatório indisponível", errText(error || new Error("Sem dados.")), "warn"); return; }
  const inv = data.inventory || {}, total = Number(inv.total || 0);
  const pct = v => total ? Math.round(Number(v || 0) * 100 / total) : 0;
  const days = Math.min(60, Math.round((z - a) / 86400000)), base = new Date(z.getTime() - days * 86400000);
  const byDay = new Map((data.activity_days || []).map(x => [String(x.day), Number(x.total || 0)]));
  const list = Array.from({ length: days }, (_, i) => new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10));
  const max = Math.max(1, ...byDay.values());
  const avg = data.avg_minutes == null ? null : Number(data.avg_minutes);
  const top = (data.top_equipment || []).slice(0, 8);
  host.innerHTML = `<section class="stats stats-4">
      <div class="stat stat-available"><b>${Number(inv.available || 0)}</b><span>Disponíveis · ${pct(inv.available)}%</span></div>
      <div class="stat stat-in_use"><b>${Number(inv.in_use || 0)}</b><span>Em uso · ${pct(inv.in_use)}%</span></div>
      <div class="stat stat-maintenance"><b>${Number(data.maintenance_open || 0)}</b><span>Manutenções abertas</span></div>
      <div class="stat"><b>${avg != null && Number.isFinite(avg) ? `${Math.round(avg)} min` : "—"}</b><span>Tempo médio de uso</span></div></section>
    <section class="card"><header class="card-head"><h2>Distribuição do inventário</h2><span class="count">${total}</span></header>
      <div class="stackbar">${[["available", inv.available], ["in_use", inv.in_use], ["maintenance", inv.maintenance], ["unavailable", inv.unavailable]].map(([k, v]) => pct(v) ? `<i class="s-${k}" style="width:${pct(v)}%" title="${statusLabel(k)}: ${Number(v || 0)}"></i>` : "").join("")}</div>
      <div class="legend">${["available", "in_use", "maintenance", "unavailable"].map(k => `<span class="lg s-${k}">${statusLabel(k)} · ${Number(inv[k] || 0)}</span>`).join("")}</div></section>
    <div class="grid-2 grid-wide"><section class="card"><header class="card-head"><h2>Atividade por dia</h2><small class="hint">últimos ${days} dias</small></header><div class="bars">${list.map(d => { const n = byDay.get(d) || 0; return `<span title="${d.slice(8, 10)}/${d.slice(5, 7)}: ${n}"><i style="height:${n ? Math.max(6, Math.round(n / max * 100)) : 0}%"></i></span>`; }).join("")}</div></section>
    <section class="card"><header class="card-head"><h2>Mais usados</h2></header>${top.length ? `<div class="rows">${top.map((x, i) => `<div class="row"><span class="rank">${i + 1}</span><span class="row-main"><b>Nº ${esc(x.code || "?")}</b></span><span class="row-side">${Number(x.uses || 0)} retirada(s)</span></div>`).join("")}</div>` : emptyState("Sem movimentações no período.", "", "chart")}</section></div>`;
}
async function exportReport() {
  const start = qs("#rp-from")?.value, finish = qs("#rp-to")?.value || start;
  try {
    const { data, error } = await supabase.rpc("equipa_admin_reports", { p_from: new Date(`${start}T00:00:00`).toISOString(), p_to: new Date(`${finish}T23:59:59`).toISOString() });
    if (error) throw error;
    const lines = [["Métrica", "Valor"], ["Retiradas", data?.withdrawals ?? 0], ["Equipamentos utilizados", data?.used_equipment ?? 0], ["Itens devolvidos", data?.returned ?? 0], ["Com avaria", data?.damaged ?? 0], ["Retiradas atrasadas em aberto", data?.late_open ?? 0], ["Manutenções abertas", data?.maintenance_open ?? 0], ["Duração média (min)", data?.avg_minutes ?? ""]];
    downloadBlob(new Blob(["﻿" + lines.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }), `Equipa-relatorio-${start}-${finish}.csv`);
    notify("Relatório exportado.", "success");
  } catch (error) { notify(errText(error), "error"); }
}
