/* Equipa — tela Manutenção.
 * Pendências primeiro (mais antigas no topo, com dias parados), abrir uma
 * ocorrência sem sair da tela e concluir com um toque. Abrir e concluir são RPCs
 * (open_maintenance / resolve_maintenance): o servidor valida a situação. */
"use strict";

const daysSince = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
async function renderMaintenance(gen) {
  const s = state.maint;
  qs("#view").innerHTML = `<div class="toolbar"><label class="search">${icon("search", 18)}<input id="mt-q" type="search" value="${esc(s.q)}" placeholder="Número, modelo ou problema" autocomplete="off" aria-label="Buscar manutenções"></label>
      <div class="toolbar-end"><button class="btn btn-primary" type="button" id="mt-new">${icon("plus", 18)}<span>Nova manutenção</span></button></div></div>
    <div class="chips" id="mt-chips" role="group" aria-label="Situação"></div><div id="mt-list">${loadingState()}</div>`;
  qs("#mt-new").addEventListener("click", pickForMaintenance);
  const { data, error } = await supabase.from("maintenance_events").select("id,equipment_id,title,notes,resolution,status,opened_at,closed_at,equipments(code,label,brand,model)").order("opened_at", { ascending: false }).limit(400);
  if (!alive(gen)) return;
  if (error) { qs("#mt-list").innerHTML = emptyState("Erro ao carregar.", errText(error), "warn"); return; }
  const all = data || [], open = all.filter(x => x.status === "open");
  setTitle("Manutenção", open.length ? `${open.length} pendente(s) · a mais antiga há ${daysSince(open.reduce((a, x) => a.opened_at < x.opened_at ? a : x).opened_at)} dia(s)` : "Nenhuma pendência");
  const paint = () => {
    const counts = { open: open.length, resolved: all.length - open.length, "": all.length };
    qs("#mt-chips").innerHTML = [["open", "Pendentes"], ["resolved", "Resolvidas"], ["", "Todas"]].map(([v, l]) => `<button type="button" class="chip ${s.status === v ? "on" : ""}" data-m="${v}">${l}<b>${counts[v]}</b></button>`).join("");
    qsa("[data-m]").forEach(b => b.addEventListener("click", () => { s.status = b.dataset.m; paint(); }));
    let rows = smartFilter(all, s.q, x => [x.title, x.notes, x.resolution, x.equipments?.code, x.equipments?.model]);
    if (s.status) rows = rows.filter(x => x.status === s.status);
    // Pendentes: mais antigas primeiro (são as que mais atrasam a escola).
    if (s.status === "open") rows = rows.slice().sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at));
    qs("#mt-list").innerHTML = rows.length ? `<section class="card"><div class="rows">${rows.map(x => {
      const d = daysSince(x.opened_at), open = x.status === "open";
      return `<div class="row ${open && d >= 7 ? "row-late" : ""}"><span class="row-ic s-${open ? "maintenance" : "available"}">${icon("tool", 16)}</span>
        <span class="row-main"><b>Nº ${esc(x.equipments?.code || "?")} · ${esc(x.title)}</b><small>${esc(x.equipments?.model || "")} · aberta ${esc(dateOnly(x.opened_at))}${x.notes ? ` · ${esc(x.notes)}` : ""}${x.resolution ? ` · Resolução: ${esc(x.resolution)}` : ""}</small></span>
        ${open ? `<span class="row-side ${d >= 7 ? "danger" : ""}">${d ? `há ${d} dia${d === 1 ? "" : "s"}` : "hoje"}</span><button class="btn btn-sm" type="button" data-open-dev="${esc(x.equipment_id)}" aria-label="Abrir ficha do Nº ${esc(x.equipments?.code || "")}">${icon("laptop", 15)}</button><button class="btn btn-sm btn-primary" type="button" data-fix="${x.id}">Concluir</button>`
          : `<span class="row-side">resolvida ${esc(dateOnly(x.closed_at))}</span>`}</div>`;
    }).join("")}</div></section>` : emptyState(s.status === "open" ? "Nenhuma manutenção pendente" : "Nada encontrado.", "Use “Nova manutenção” ou abra um equipamento e escolha Manutenção.", "tool");
    qsa("[data-fix]").forEach(b => b.addEventListener("click", () => resolveMaintenance(Number(b.dataset.fix))));
    qsa("[data-open-dev]").forEach(b => b.addEventListener("click", () => openDevice(b.dataset.openDev)));
  };
  let t; qs("#mt-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { s.q = e.target.value; paint(); }, 160); });
  paint();
}
/** Escolher o equipamento para abrir manutenção sem sair da tela. */
async function pickForMaintenance() {
  const m = openSheet({ size: "md", title: "Nova manutenção", subtitle: "Escolha o equipamento. Emprestados precisam ser devolvidos antes.", body: loadingState() });
  let rows; try { rows = (await loadDevices({ force: true })).filter(d => ["available", "unavailable"].includes(d.status)); } catch (error) { setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); return; }
  if (!m.isConnected) return;
  setSheet(m, { body: `<label class="search">${icon("search", 18)}<input id="pm-q" type="search" placeholder="Número ou modelo" autocomplete="off" aria-label="Buscar equipamento"></label><div class="slots" id="pm-list"></div>` });
  const paint = () => {
    const vis = smartFilter(rows, qs("#pm-q", m).value, d => [d.code, d.model, d.location_text]).slice(0, 200);
    qs("#pm-list", m).innerHTML = vis.map(d => `<button type="button" class="slot s-${esc(d.status)}" data-id="${esc(d.id)}" title="${esc(d.model || "")}">${icon("laptop", 18)}<span>${esc(d.code)}</span></button>`).join("") || `<p class="lane-empty">Nada encontrado.</p>`;
    qsa("[data-id]", m).forEach(b => b.addEventListener("click", () => { const d = rows.find(x => String(x.id) === b.dataset.id); m.close(); openMaintenanceForm(d, null); }));
  };
  qs("#pm-q", m).addEventListener("input", paint); paint(); qs("#pm-q", m).focus();
}
function resolveMaintenance(id) {
  const m = openSheet({ size: "sm", title: "Concluir manutenção", subtitle: "O equipamento volta a ficar disponível.", body: `<form id="rs-form" class="form"><label class="field"><span>O que foi feito?</span><textarea name="resolution" maxlength="1200" rows="3" placeholder="Opcional"></textarea></label></form>`, foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="rs-form">Concluir</button>` });
  qs("#rs-form", m).addEventListener("submit", async e => {
    e.preventDefault(); const b = qs('.sheet-foot [type="submit"]', m); setBusy(b, true, "Concluindo…");
    const { error } = await supabase.rpc("resolve_maintenance", { p_event_id: id, p_resolution: clean(new FormData(e.currentTarget).get("resolution")) || null });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    notify("Manutenção concluída.", "success"); m.close(); invalidateData(); refreshView();
  });
}
