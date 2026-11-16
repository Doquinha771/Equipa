/* Equipa — Ajustes da escola: modelos (com herança), campos personalizáveis e locais.
 *
 * Herança: um notebook novo de um modelo já conhecido recebe automaticamente os
 * dados desse modelo (fabricante, tipo, plataforma, processador, RAM, armazenamento
 * e campos personalizados). A fonte é a ficha do modelo; se não houver ficha, usa
 * o valor mais comum entre os equipamentos já cadastrados desse modelo.
 *
 * Tudo aqui degrada com segurança: sem a migração 1.0 aplicada no Supabase
 * (tabela equipa_settings e coluna specs), os recursos novos ficam ocultos. */
"use strict";
const EquipaSettings = (() => {
  const DEFAULTS = { custom_fields: [], locations: [] };
  let cache = { at: 0, values: { ...DEFAULTS }, table: null, specs: null };

  async function load(force = false) {
    if (!force && cache.table !== null && Date.now() - cache.at < 60000) return cache;
    const [settings, specs] = await Promise.all([
      supabase.from("equipa_settings").select("key,value"),
      supabase.from("equipments").select("specs").limit(1)
    ]);
    const values = { ...DEFAULTS };
    if (!settings.error) for (const row of settings.data || []) values[row.key] = row.value;
    cache = { at: Date.now(), values, table: !settings.error, specs: !specs.error };
    return cache;
  }
  const get = key => cache.values[key] ?? DEFAULTS[key];
  const hasSpecs = () => cache.specs === true;
  const hasTable = () => cache.table === true;
  async function save(key, value) {
    const by = state.session?.user?.id || null;
    const up = await supabase.from("equipa_settings").update({ value, updated_at: new Date().toISOString(), updated_by: by }).eq("key", key);
    if (up.error) throw up.error;
    if (!(up.data || []).length) { const ins = await supabase.from("equipa_settings").insert({ key, value, updated_by: by }); if (ins.error) throw ins.error; }
    cache.values[key] = value;
  }

  /* ---------- Campos personalizáveis ---------- */
  const fields = () => (hasSpecs() ? get("custom_fields") : []).filter(f => f && f.key && f.label);
  const slug = s => norm(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "campo";
  /** Campos personalizados como inputs (prefixo spec_). */
  function fieldsHtml(values = {}, { keepPlaceholder = "" } = {}) {
    const list = fields(); if (!list.length) return "";
    return `<div class="grid-2">${list.map(f => {
      const v = values?.[f.key] ?? "", name = `spec_${esc(f.key)}`;
      if (f.type === "select") return `<label class="field"><span>${esc(f.label)}</span><select name="${name}"><option value="">${esc(keepPlaceholder || "—")}</option>${(f.options || []).map(o => `<option ${String(v) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
      if (f.type === "yesno") return `<label class="field"><span>${esc(f.label)}</span><select name="${name}"><option value="">${esc(keepPlaceholder || "—")}</option><option value="Sim" ${v === "Sim" ? "selected" : ""}>Sim</option><option value="Não" ${v === "Não" ? "selected" : ""}>Não</option></select></label>`;
      return `<label class="field"><span>${esc(f.label)}</span><input name="${name}" maxlength="120" value="${esc(v)}" placeholder="${esc(keepPlaceholder)}"></label>`;
    }).join("")}</div>`;
  }
  /** Lê os campos spec_* de um formulário. `onlyFilled` ignora vazios (edição em grupo). */
  function readFields(form, { onlyFilled = false } = {}) {
    const out = {};
    for (const f of fields()) { const el = form.elements[`spec_${f.key}`]; if (!el) continue; const v = clean(el.value); if (v || !onlyFilled) out[f.key] = v; }
    return out;
  }
  const describe = specs => fields().map(f => specs?.[f.key] ? [f.label, specs[f.key]] : null).filter(Boolean);

  /* ---------- Locais padronizados ---------- */
  function locationList(extra = []) {
    const set = new Map();
    for (const l of [...get("locations"), ...extra]) { const k = norm(l); if (k && !set.has(k)) set.set(k, clean(l)); }
    return [...set.values()].sort(numSort);
  }
  const locationDatalist = (id, extra = []) => `<datalist id="${id}">${locationList(extra).map(l => `<option value="${esc(l)}">`).join("")}</datalist>`;

  /* ---------- Modelos: fichas e herança ---------- */
  const SPEC_KEYS = ["brand", "school_group", "operating_system", "processor", "ram_gb", "storage_gb"];
  let profileCache = { at: 0, rows: [] };
  async function profiles(force = false) {
    if (!force && Date.now() - profileCache.at < 60000) return profileCache.rows;
    const { data, error } = await supabase.from("equipa_model_profiles").select("id,name,manufacturer,school_group,processor,ram_gb,storage_gb,operating_system,specs,notes").order("name").limit(500);
    profileCache = { at: Date.now(), rows: error ? [] : data || [] };
    return profileCache.rows;
  }
  const mostCommon = values => { const c = new Map(); for (const v of values) if (v !== null && v !== undefined && v !== "" && v !== "Não informado") c.set(JSON.stringify(v), (c.get(JSON.stringify(v)) || 0) + 1); let best = null, n = 0; for (const [k, v] of c) if (v > n) { n = v; best = JSON.parse(k); } return best; };
  /** Dados herdados para um modelo (ficha > equipamentos existentes > palpite pelo nome). */
  async function inherit(modelName) {
    const name = clean(modelName); if (!name) return null;
    const [rows, devs] = await Promise.all([profiles(), loadDevices().catch(() => [])]);
    const p = rows.find(r => norm(r.name) === norm(name));
    const same = devs.filter(d => norm(d.model) === norm(name));
    const out = { source: p ? "ficha" : same.length ? "inventário" : "nome", profileId: p?.id || null, count: same.length };
    out.brand = p?.manufacturer || mostCommon(same.map(d => d.brand)) || "";
    out.school_group = p?.school_group || mostCommon(same.map(d => d.school_group)) || guessGroup(name) || "";
    for (const k of ["operating_system", "processor", "ram_gb", "storage_gb"]) out[k] = p?.[k] ?? mostCommon(same.map(d => d[k])) ?? "";
    const specs = {};
    for (const f of fields()) { const v = p?.specs?.[f.key] || mostCommon(same.map(d => d.specs?.[f.key])); if (v) specs[f.key] = v; }
    out.specs = specs;
    return out;
  }
  const inheritSummary = h => !h ? "" : [h.brand, schoolGroupLabel(h.school_group) !== "Sem tipo" ? schoolGroupLabel(h.school_group) : "", h.operating_system, h.processor, h.ram_gb ? `${h.ram_gb} GB RAM` : "", h.storage_gb ? `${h.storage_gb} GB` : "", ...describe(h.specs).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(" · ");
  /** Campos técnicos do modelo como inputs (usado no cadastro e na ficha do modelo). */
  function specInputs(h = {}, { keepPlaceholder = "" } = {}) {
    const ph = keepPlaceholder;
    return `<div class="grid-2">
      <label class="field"><span>Fabricante</span><input name="brand" maxlength="100" value="${esc(h.brand || "")}" placeholder="${esc(ph || "Ex.: Positivo")}"></label>
      <label class="field"><span>Tipo</span><select name="school_group">${groupOptions(h.school_group || "", ph || "Sem tipo")}</select></label>
      <label class="field"><span>Plataforma / sistema</span><input name="operating_system" maxlength="120" value="${esc(h.operating_system || "")}" placeholder="${esc(ph || "Ex.: ChromeOS, Windows 11")}" list="os-list"></label>
      <label class="field"><span>Processador</span><input name="processor" maxlength="120" value="${esc(h.processor || "")}" placeholder="${esc(ph || "Ex.: Celeron N4500")}"></label>
      <label class="field"><span>RAM (GB)</span><input name="ram_gb" type="number" min="1" max="1024" value="${esc(h.ram_gb || "")}" placeholder="${esc(ph)}"></label>
      <label class="field"><span>Armazenamento (GB)</span><input name="storage_gb" type="number" min="1" max="1048576" value="${esc(h.storage_gb || "")}" placeholder="${esc(ph)}"></label>
    </div><datalist id="os-list"><option value="ChromeOS"><option value="Windows 11"><option value="Windows 10"><option value="Linux Educacional"><option value="Android"><option value="iPadOS"></datalist>
    ${fieldsHtml(h.specs || {}, { keepPlaceholder: ph })}`;
  }
  /** Lê os campos técnicos; `onlyFilled` devolve só o que foi preenchido. */
  function readSpecInputs(form, { onlyFilled = false } = {}) {
    const f = new FormData(form), out = {};
    const put = (k, v) => { if (v !== "" && v !== null && v !== undefined) out[k] = v; else if (!onlyFilled) out[k] = null; };
    put("brand", clean(f.get("brand")));
    put("school_group", f.get("school_group") || "");
    put("operating_system", clean(f.get("operating_system")));
    put("processor", clean(f.get("processor")));
    put("ram_gb", f.get("ram_gb") ? Number(f.get("ram_gb")) : "");
    put("storage_gb", f.get("storage_gb") ? Number(f.get("storage_gb")) : "");
    const specs = readFields(form, { onlyFilled });
    if (Object.keys(specs).length) out.specs = specs;
    return out;
  }
  /** Converte o resultado de readSpecInputs em colunas de equipments. */
  function toEquipmentColumns(s, { forInsert = false } = {}) {
    const row = {};
    for (const k of SPEC_KEYS) if (k in s) row[k] = s[k] === "" ? null : s[k];
    if ("brand" in row) row.brand = row.brand || (forInsert ? "Não informado" : "Não informado");
    if (s.specs && hasSpecs()) row.specs = s.specs;
    return row;
  }

  /* ---------- Tela de Ajustes ---------- */
  async function render(gen) {
    const s = (state.settingsTab ||= "models");
    await load(true);
    if (!alive(gen)) return;
    qs("#view").innerHTML = `${!hasTable() || !hasSpecs() ? `<div class="callout callout-warn">${icon("warn", 18)}<span>Falta aplicar a migração <b>20261116010000_equipa_1_0_carts_models_settings.sql</b> no Supabase. Sem ela, campos personalizados e a lista de locais ficam desligados.</span></div>` : ""}
      <div class="toolbar"><div class="segmented segmented-lg" role="tablist">${[["models", "laptop", "Modelos"], ["fields", "list", "Campos dos notes"], ["locations", "pin", "Locais"]].map(([k, ic, l]) => `<button type="button" role="tab" data-st="${k}" class="${s === k ? "on" : ""}">${icon(ic, 16)}<span>${l}</span></button>`).join("")}</div></div>
      <div id="st-body">${loadingState()}</div>`;
    qsa("[data-st]").forEach(b => b.addEventListener("click", () => { state.settingsTab = b.dataset.st; render(++viewGen); }));
    setTitle("Ajustes", "Como os notes são descritos e organizados na escola");
    if (s === "models") return renderModels(gen);
    if (s === "fields") return renderFields();
    return renderLocations();
  }
  async function renderModels(gen) {
    const [rows, devs] = await Promise.all([profiles(true), loadDevices({ force: true }).catch(() => [])]);
    if (!alive(gen)) return;
    const byName = new Map();
    for (const d of devs) { const k = norm(d.model); if (!k) continue; if (!byName.has(k)) byName.set(k, { name: clean(d.model), count: 0 }); byName.get(k).count++; }
    const list = rows.map(r => ({ ...r, count: byName.get(norm(r.name))?.count || 0, hasProfile: true }));
    for (const [k, v] of byName) if (!rows.some(r => norm(r.name) === k)) list.push({ name: v.name, count: v.count, hasProfile: false });
    list.sort((a, b) => b.count - a.count || numSort(a.name, b.name));
    qs("#st-body").innerHTML = `<p class="hint">${icon("info", 14)} A ficha do modelo é a fonte dos dados herdados: ao cadastrar um note desse modelo, plataforma, processador, memória e campos personalizados vêm preenchidos.</p>
      <div class="toolbar"><div class="toolbar-end"><button class="btn btn-primary" type="button" id="md-new">${icon("plus", 18)}<span>Novo modelo</span></button></div></div>
      ${list.length ? `<section class="card"><div class="rows">${list.map((m, i) => `<button type="button" class="row" data-m="${i}"><span class="row-ic">${icon("laptop", 18)}</span><span class="row-main"><b>${esc(m.name)}</b><small>${m.hasProfile ? esc([m.manufacturer, schoolGroupLabel(m.school_group) !== "Sem tipo" ? schoolGroupLabel(m.school_group) : "", m.operating_system, m.ram_gb ? `${m.ram_gb} GB` : ""].filter(Boolean).join(" · ") || "Ficha sem detalhes") : "Sem ficha — os dados vêm dos equipamentos"}</small></span><span class="row-side">${m.count} note${m.count === 1 ? "" : "s"}</span>${m.hasProfile ? "" : `<span class="pill">sem ficha</span>`}${icon("chevron", 16)}</button>`).join("")}</div></section>` : emptyState("Nenhum modelo ainda.", "Os modelos aparecem quando você cadastra equipamentos.", "laptop")}`;
    qs("#md-new").addEventListener("click", () => openModel(null));
    qsa("[data-m]").forEach(b => b.addEventListener("click", () => openModel(list[Number(b.dataset.m)])));
  }
  /** Ficha do modelo. Salvar pode aplicar os dados a todos os notes do modelo. */
  async function openModel(m) {
    const base = m ? (m.hasProfile ? { brand: m.manufacturer, school_group: m.school_group, operating_system: m.operating_system, processor: m.processor, ram_gb: m.ram_gb, storage_gb: m.storage_gb, specs: m.specs || {} } : await inherit(m.name)) : {};
    const sheet = openSheet({ size: "md", title: m ? esc(m.name) : "Novo modelo", subtitle: m ? `${m.count} note(s) com este modelo` : "Os notes desse modelo herdam estes dados.",
      body: `<form id="md-form" class="form" autocomplete="off"><label class="field"><span>Nome do modelo *</span><input name="name" required maxlength="120" value="${esc(m?.name || "")}"></label>
        ${specInputs(base)}
        <label class="field"><span>Observações do modelo</span><textarea name="notes" maxlength="1200" rows="2">${esc(m?.notes || "")}</textarea></label>
        ${m?.count ? `<label class="check check-box"><input type="checkbox" name="apply" checked><span>Aplicar estes dados aos <b>${m.count}</b> notes deste modelo agora (número, local e situação não mudam).</span></label>` : ""}</form>`,
      foot: `${m?.hasProfile ? `<button class="btn btn-ghost danger" type="button" id="md-del">Apagar ficha</button>` : ""}<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="md-form">Salvar</button>` });
    const form = qs("#md-form", sheet);
    qs("#md-del", sheet)?.addEventListener("click", async () => {
      if (!await confirmAction({ title: "Apagar a ficha do modelo?", message: "Os notes continuam cadastrados com os dados que já têm. Só a ficha deixa de existir.", confirmText: "Apagar ficha", danger: true })) return;
      const { error } = await supabase.from("equipa_model_profiles").delete().eq("id", m.id);
      if (error) return notify(errText(error), "error");
      notify("Ficha apagada.", "success"); sheet.close(); profileCache.at = 0; modelCache.at = 0; refreshView();
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const b = qs('.sheet-foot [type="submit"]', sheet), name = clean(form.elements.name.value);
      const sp = readSpecInputs(form);
      const row = { name, manufacturer: sp.brand || "Não informado", school_group: sp.school_group || null, operating_system: sp.operating_system || null, processor: sp.processor || null, ram_gb: sp.ram_gb || null, storage_gb: sp.storage_gb || null };
      if (hasSpecs()) { row.specs = sp.specs || {}; row.notes = clean(form.elements.notes.value) || null; }
      setBusy(b, true, "Salvando…");
      try {
        const res = m?.hasProfile ? await supabase.from("equipa_model_profiles").update(row).eq("id", m.id) : await supabase.from("equipa_model_profiles").insert({ ...row, created_by: state.profile.id });
        if (res.error) throw res.error;
        let applied = 0;
        if (m?.count && form.elements.apply?.checked) {
          const cols = toEquipmentColumns(sp); cols.model = name;
          if (!hasSpecs()) delete cols.specs;
          const { data, error } = await supabase.from("equipments").update(cols).eq("model", m.name);
          if (error) throw error; applied = (data || []).length;
        }
        notify(applied ? `Modelo salvo e aplicado a ${applied} note(s).` : "Modelo salvo.", "success");
        sheet.close(); profileCache.at = 0; modelCache.at = 0; invalidateData(); refreshView();
      } catch (error) { notify(errText(error), "error"); } finally { setBusy(b, false); }
    });
  }
  function renderFields() {
    if (!hasTable() || !hasSpecs()) { qs("#st-body").innerHTML = emptyState("Indisponível até aplicar a migração.", "", "warn"); return; }
    let list = (get("custom_fields") || []).map(f => ({ ...f }));
    const paint = () => {
      qs("#st-body").innerHTML = `<p class="hint">${icon("info", 14)} Crie os campos que a escola precisa saber de cada note (ex.: Carregador, Cor, Capa, Conta Google, Etiqueta antiga). Eles aparecem no cadastro, na ficha, na edição em grupo e na planilha.</p>
        <section class="card"><div class="rows" id="cf-rows">${list.map((f, i) => `<div class="row cf-row" data-i="${i}"><span class="row-ic">${icon("text", 16)}</span>
          <input class="cf-label" value="${esc(f.label)}" maxlength="40" aria-label="Nome do campo">
          <select class="cf-type" aria-label="Tipo"><option value="text" ${f.type === "text" ? "selected" : ""}>Texto</option><option value="select" ${f.type === "select" ? "selected" : ""}>Lista</option><option value="yesno" ${f.type === "yesno" ? "selected" : ""}>Sim/Não</option></select>
          <input class="cf-options" value="${esc((f.options || []).join(", "))}" placeholder="Opções, separadas por vírgula" ${f.type === "select" ? "" : "hidden"}>
          <button type="button" class="icon-btn" data-up="${i}" aria-label="Subir">${icon("down", 16)}</button><button type="button" class="icon-btn danger" data-rm="${i}" aria-label="Remover">${icon("trash", 16)}</button></div>`).join("") || `<p class="lane-empty">Nenhum campo personalizado.</p>`}</div></section>
        <div class="toolbar"><button class="btn" type="button" id="cf-add">${icon("plus", 17)}<span>Adicionar campo</span></button><div class="toolbar-end"><button class="btn btn-primary" type="button" id="cf-save">Salvar campos</button></div></div>
        <p class="hint">Remover um campo não apaga o que já foi preenchido nos notes; só deixa de aparecer.</p>`;
      const sync = () => qsa(".cf-row").forEach(r => { const f = list[Number(r.dataset.i)]; f.label = clean(qs(".cf-label", r).value); f.type = qs(".cf-type", r).value; f.options = clean(qs(".cf-options", r).value).split(",").map(clean).filter(Boolean); });
      qsa(".cf-type").forEach(s => s.addEventListener("change", () => { sync(); paint(); }));
      qsa("[data-rm]").forEach(b => b.addEventListener("click", () => { sync(); list.splice(Number(b.dataset.rm), 1); paint(); }));
      qsa("[data-up]").forEach(b => b.addEventListener("click", () => { sync(); const i = Number(b.dataset.up); if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; paint(); }));
      qs("#cf-add").addEventListener("click", () => { sync(); list.push({ key: "", label: "", type: "text", options: [] }); paint(); qsa(".cf-label").at(-1)?.focus(); });
      qs("#cf-save").addEventListener("click", async () => {
        sync();
        const used = new Set(), out = [];
        for (const f of list.filter(f => f.label)) { let k = f.key || slug(f.label); while (used.has(k)) k += "_2"; used.add(k); out.push({ key: k, label: f.label, type: f.type, options: f.type === "select" ? f.options : [] }); }
        const b = qs("#cf-save"); setBusy(b, true, "Salvando…");
        try { await save("custom_fields", out); list = out; notify("Campos salvos.", "success"); paint(); } catch (error) { notify(errText(error), "error"); setBusy(b, false); }
      });
    };
    paint();
  }
  async function renderLocations() {
    if (!hasTable()) { qs("#st-body").innerHTML = emptyState("Indisponível até aplicar a migração.", "", "warn"); return; }
    const devs = await loadDevices().catch(() => []);
    const used = [...new Set(devs.map(d => clean(d.location_text)).filter(Boolean))];
    const saved = get("locations") || [];
    const loose = used.filter(u => !saved.some(s => norm(s) === norm(u)));
    qs("#st-body").innerHTML = `<p class="hint">${icon("info", 14)} Uma lista única de salas, laboratórios e armários evita “Sala 12”, “sala12” e “S. 12” para o mesmo lugar. Ela aparece como sugestão em todo campo de local.</p>
      <label class="field"><span>Locais da escola (um por linha)</span><textarea id="loc-list" rows="10">${esc(saved.join("\n"))}</textarea></label>
      ${loose.length ? `<div class="callout">${icon("pin", 16)}<span>Usados no inventário e fora da lista: ${esc(loose.slice(0, 20).join(", "))}${loose.length > 20 ? "…" : ""}</span><button class="btn btn-sm" type="button" id="loc-import">Adicionar à lista</button></div>` : ""}
      <div class="toolbar"><div class="toolbar-end"><button class="btn btn-primary" type="button" id="loc-save">Salvar locais</button></div></div>`;
    qs("#loc-import")?.addEventListener("click", () => { const t = qs("#loc-list"); t.value = [...t.value.split("\n").map(clean).filter(Boolean), ...loose].join("\n"); });
    qs("#loc-save").addEventListener("click", async () => {
      const list = [...new Map(qs("#loc-list").value.split("\n").map(clean).filter(Boolean).map(l => [norm(l), l])).values()].slice(0, 300);
      const b = qs("#loc-save"); setBusy(b, true, "Salvando…");
      try { await save("locations", list); notify(`${list.length} local(is) salvos.`, "success"); } catch (error) { notify(errText(error), "error"); } finally { setBusy(b, false); }
    });
  }

  return { load, get, save, hasSpecs, hasTable, fields, fieldsHtml, readFields, describe, locationList, locationDatalist, profiles, inherit, inheritSummary, specInputs, readSpecInputs, toEquipmentColumns, render, openModel };
})();
