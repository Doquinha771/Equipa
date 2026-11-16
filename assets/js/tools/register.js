/* Equipa — cadastro de equipamentos.
 * Caminho principal: "De 1 até 30 · Modelo" → Cadastrar. Uma única transação no
 * PostgreSQL (equipa_register_equipment_batch): ou entra o lote inteiro, ou nada.
 *
 * Regras de organização:
 *  - Herança: o modelo já conhecido preenche plataforma, processador, memória,
 *    fabricante, tipo e campos personalizados. Tudo continua editável no lote.
 *  - Números são únicos: os que já existem NÃO são duplicados nem apagados. Por
 *    padrão ficam como estão; com "Substituir dados" ligado, recebem os dados novos
 *    (modelo, local, detalhes) mantendo número, QR, situação e histórico.
 * Também: um só, pela câmera (camera.js) e por planilha. Edição fica em app.js. */
"use strict";
const EquipaRegister = (() => {
  const MAX = 200;
  const registerError = error => {
    const raw = String(error?.message || error || "Erro desconhecido");
    if (/EQUIPA_EQUIPMENT_DUPLICATE|duplicate key|23505/i.test(raw)) return "Algum número, patrimônio ou série já está cadastrado em outro equipamento. Nada foi salvo nesta tentativa.";
    if (/EQUIPA_DUPLICATE_IN_BATCH/.test(raw)) return "Há números, patrimônios ou séries repetidos no lote.";
    if (/EQUIPA_INVALID_ROW_(\d+)/.test(raw)) return `O item ${raw.match(/EQUIPA_INVALID_ROW_(\d+)/)[1]} tem um campo inválido.`;
    if (/EQUIPA_BATCH_SIZE_INVALID/.test(raw)) return `Cadastre de 1 a ${MAX} por vez.`;
    if (/EQUIPA_BATCH_ACTION_CONFLICT/.test(raw)) return "Os dados mudaram depois do envio. Tente novamente.";
    return errText(error);
  };
  const codeFor = (prefix, startStr, i) => prefix + String(Number(startStr) + i).padStart(startStr.length, "0");
  const after = () => { invalidateData(); if (["devices", "home", "carts"].includes(state.view)) refreshView(); };
  const S = () => EquipaSettings;

  /** Grava itens já montados. Retorna as linhas criadas (id, code, qr_token). */
  async function saveItems(items, actionId) {
    const { data, error } = await supabase.rpc("equipa_register_equipment_batch", { p_items: items, p_action_id: actionId });
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== items.length || data.some(x => !x.id || !x.qr_token)) throw new Error("Resposta incerta do servidor. Confira o inventário antes de repetir.");
    return data;
  }
  function itemFrom(f) {
    const n = v => v === "" || v == null ? null : Number(v);
    return { code: clean(f.code), model: clean(f.model), brand: clean(f.brand) || "Não informado", school_group: f.school_group || null, location_text: clean(f.location_text) || null,
      serial_number: clean(f.serial_number) || null, asset_tag: clean(f.asset_tag) || null, label: clean(f.label) || null, notes: clean(f.notes) || null,
      operating_system: clean(f.operating_system) || null, processor: clean(f.processor) || null, ram_gb: n(f.ram_gb), storage_gb: n(f.storage_gb) };
  }
  /** Campos personalizados não passam pela RPC de cadastro: são gravados logo depois. */
  async function applySpecs(ids, specs) {
    if (!ids.length || !specs || !Object.keys(specs).length || !S().hasSpecs()) return;
    for (let i = 0; i < ids.length; i += 100) { const { error } = await supabase.from("equipments").update({ specs }).in("id", ids.slice(i, i + 100)); if (error) throw error; }
  }
  /** "Substituir dados": atualiza os números que já existem (sem mexer em número, QR, situação). */
  async function replaceExisting(storedCodes, cols, specs) {
    if (!storedCodes.length) return 0;
    const { data: rows, error } = await supabase.from("equipments").select("id,code,specs").in("code", storedCodes);
    if (error) throw error;
    const patch = { ...cols }; delete patch.code; delete patch.status;
    for (const k of Object.keys(patch)) if (patch[k] === null || patch[k] === "") delete patch[k];
    if (patch.brand === "Não informado") delete patch.brand;
    if (Object.keys(patch).length) {
      const ids = (rows || []).map(r => r.id);
      for (let i = 0; i < ids.length; i += 100) { const r = await supabase.from("equipments").update(patch).in("id", ids.slice(i, i + 100)); if (r.error) throw r.error; }
    }
    if (specs && Object.keys(specs).length && S().hasSpecs()) {
      for (const r of rows || []) { const u = await supabase.from("equipments").update({ specs: { ...(r.specs || {}), ...specs } }).eq("id", r.id); if (u.error) throw u.error; }
    }
    return (rows || []).length;
  }
  /** Guarda (ou atualiza) a ficha do modelo para os próximos cadastros herdarem. */
  async function saveProfile(name, sp) {
    const rows = await S().profiles(true), p = rows.find(r => norm(r.name) === norm(name));
    const row = { name: clean(name), manufacturer: sp.brand || "Não informado", school_group: sp.school_group || null, operating_system: sp.operating_system || null, processor: sp.processor || null, ram_gb: sp.ram_gb || null, storage_gb: sp.storage_gb || null };
    if (S().hasSpecs()) row.specs = { ...(p?.specs || {}), ...(sp.specs || {}) };
    const res = p ? await supabase.from("equipa_model_profiles").update(row).eq("id", p.id) : await supabase.from("equipa_model_profiles").insert({ ...row, created_by: state.profile.id });
    if (res.error) throw res.error;
  }
  /** Usado pela câmera: cadastra um equipamento herdando os dados do modelo. */
  async function saveOne(fields) {
    const h = await S().inherit(fields.model).catch(() => null) || {};
    const merged = { ...fields };
    for (const k of ["brand", "school_group", "operating_system", "processor", "ram_gb", "storage_gb"]) if (!clean(merged[k])) merged[k] = h[k] || "";
    const [row] = await saveItems([itemFrom(merged)], uid());
    await applySpecs([row.id], h.specs).catch(() => {});
    after();
    return row;
  }

  const modeTabs = mode => `<div class="segmented segmented-lg reg-tabs" role="tablist">${[["range", "layers", "Vários"], ["camera", "camera", "Câmera"], ["one", "plus", "Um só"], ["import", "upload", "Planilha"]].map(([k, ic, l]) => `<button type="button" role="tab" data-mode="${k}" class="${mode === k ? "on" : ""}" aria-selected="${mode === k}">${icon(ic, 17)}<span>${l}</span></button>`).join("")}</div>`;
  const modelChips = models => models.length ? `<div class="chips chips-tight" aria-label="Modelos já usados">${models.slice(0, 8).map(m => `<button type="button" class="chip" data-model="${esc(m.name)}">${esc(m.name)}${m.count ? `<b>${m.count}</b>` : ""}</button>`).join("")}</div>` : "";
  const modelDatalist = models => `<datalist id="reg-models">${models.map(m => `<option value="${esc(m.name)}">`).join("")}</datalist>`;
  const detailsBlock = () => `<details class="more" id="reg-details"><summary>Detalhes do modelo <small class="muted" id="reg-inherit-src"></small></summary><p class="hint" id="reg-inherit"></p>${S().specInputs({})}
    <label class="check"><input type="checkbox" name="save_profile" checked><span>Guardar estes detalhes na ficha do modelo (os próximos cadastros herdam)</span></label></details>`;
  /** Ao escolher o modelo, preenche os detalhes herdados; o que o usuário digitou não é sobrescrito. */
  function bindModel(form, models) {
    const input = form.elements.model, touched = new Set();
    form.addEventListener("input", e => { if (e.isTrusted && e.target.closest("#reg-details") && e.target.name) touched.add(e.target.name); });
    form.addEventListener("change", e => { if (e.isTrusted && e.target.closest("#reg-details") && e.target.name) touched.add(e.target.name); });
    let seq = 0;
    const apply = async () => {
      qsa("[data-model]", form).forEach(c => c.classList.toggle("on", norm(c.dataset.model) === norm(input.value)));
      const s = ++seq, h = await S().inherit(input.value).catch(() => null);
      if (s !== seq || !form.isConnected) return;
      form._inherit = h;
      const set = (name, v) => { const el = form.elements[name]; if (el && !touched.has(name)) el.value = v ?? ""; };
      for (const k of ["brand", "school_group", "operating_system", "processor", "ram_gb", "storage_gb"]) set(k, h?.[k] || "");
      for (const f of S().fields()) set(`spec_${f.key}`, h?.specs?.[f.key] || "");
      const sum = S().inheritSummary(h);
      const src = qs("#reg-inherit-src", form), hint = qs("#reg-inherit", form);
      if (src) src.textContent = !h ? "" : h.source === "ficha" ? "· da ficha do modelo" : h.source === "inventário" ? `· de ${h.count} note(s) já cadastrados` : "· preencha uma vez";
      if (hint) hint.innerHTML = sum ? `${icon("layers", 14)} Herdado: ${esc(sum)}` : clean(input.value) ? `${icon("info", 14)} Modelo novo: preencha a plataforma e o resto uma vez; fica guardado para os próximos.` : "";
      if (h && h.source !== "ficha" && clean(input.value)) qs("#reg-details", form)?.setAttribute("open", "");
    };
    qsa("[data-model]", form).forEach(c => c.addEventListener("click", () => { input.value = c.dataset.model; input.dispatchEvent(new Event("input", { bubbles: true })); apply(); }));
    let t; input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 250); }); input.addEventListener("change", apply);
    apply();
  }
  const existingMode = () => `<fieldset class="field"><legend>Números que já existem</legend><div class="segmented"><label><input type="radio" name="on_existing" value="keep" checked><span>Manter como estão</span></label><label><input type="radio" name="on_existing" value="replace"><span>Substituir dados</span></label></div>
    <small class="hint">Nunca duplica: “Substituir” troca modelo, local e detalhes, mas mantém número, QR, situação e histórico.</small></fieldset>`;

  async function open(mode = "range", preset = {}) {
    if (!isAdmin()) return notify("Apenas administradores podem cadastrar equipamentos.", "error");
    if (mode === "camera") return EquipaCamera.open({ mode: "register" });
    const m = openSheet({ size: "md", className: "reg-sheet", title: "Cadastrar equipamentos", body: loadingState() });
    const [models, devs] = await Promise.all([knownModels(), loadDevices().catch(() => [])]);
    await S().load().catch(() => {});
    if (!m.isConnected) return;
    m._locs = devs.map(d => d.location_text);
    const show = k => {
      if (m.dataset.saving) return notify("Aguarde terminar de salvar.", "warning");
      if (k === "camera") { m.close(); return EquipaCamera.open({ mode: "register" }); }
      ({ range: rangeForm, one: oneForm, import: importForm })[k](m, models, k === mode ? preset : {});
    };
    m.addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b && m.contains(b)) show(b.dataset.mode); });
    show(mode);
    return m;
  }

  /* ----- Vários: de N até M ----- */
  function rangeForm(m, models, preset) {
    setSheet(m, { title: "Cadastrar equipamentos", subtitle: "Informe o intervalo de números e o modelo.",
      body: `${modeTabs("range")}<form id="rg-form" class="form" autocomplete="off">
        <div class="range"><label class="field"><span>Do número</span><input name="start" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" required value="${esc(preset.start || "1")}"></label><span class="range-sep">até</span><label class="field"><span>Até o número</span><input name="end" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" required value="${esc(preset.end || "30")}"></label></div>
        <label class="field"><span>Modelo de todos *</span><input name="model" required maxlength="120" list="reg-models" placeholder="Ex.: Chromebook Positivo N2210" value="${esc(preset.model || "")}"></label>
        ${modelChips(models)}${modelDatalist(models)}
        <label class="field"><span>Local (opcional)</span><input name="location_text" maxlength="160" placeholder="Ex.: Laboratório 1" list="reg-locs" value="${esc(preset.location_text || "")}"></label>${S().locationDatalist("reg-locs", m._locs || [])}
        ${detailsBlock()}
        <details class="more"><summary>Opções</summary><label class="field"><span>Prefixo do número</span><input name="prefix" maxlength="30" placeholder="Ex.: CB-  →  CB-1, CB-2…"></label>
          <p class="hint">Use um prefixo quando dois modelos tiverem a mesma numeração (ex.: Chromebooks 1–30 e Positivos 1–30).</p>${existingMode()}</details>
        <div class="preview" id="rg-preview" aria-live="polite"></div>
      </form>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary btn-lg" type="submit" form="rg-form" id="rg-go">Cadastrar</button>` });
    const form = qs("#rg-form", m), preview = qs("#rg-preview", m), go = qs("#rg-go", m);
    bindModel(form, models);
    let actionId = null, existing = new Map(), checkSeq = 0;
    const calc = () => {
      const f = new FormData(form), start = clean(f.get("start")), end = clean(f.get("end")), prefix = clean(f.get("prefix"));
      if (!/^\d{1,8}$/.test(start) || !/^\d{1,8}$/.test(end)) return { error: "Use apenas números no intervalo." };
      const n = Number(end) - Number(start) + 1;
      if (n < 1) return { error: "O número final precisa ser maior ou igual ao inicial." };
      if (n > MAX) return { error: `Até ${MAX} por vez. Divida em mais de um lote.` };
      // "1" gera 1, 2…; "01" gera 01, 02… (mantém os zeros digitados).
      const codes = Array.from({ length: n }, (_, i) => codeFor(prefix, start, i));
      if (codes.at(-1).length > 80) return { error: "Os números ficaram longos demais." };
      return { codes, model: clean(f.get("model")), prefix, replace: f.get("on_existing") === "replace" };
    };
    const paint = () => {
      const r = calc();
      if (r.error) { preview.innerHTML = `<p class="callout callout-warn">${icon("warn", 16)}<span>${esc(r.error)}</span></p>`; go.disabled = true; go.textContent = "Cadastrar"; return r; }
      const fresh = r.codes.filter(c => !existing.has(norm(c))), old = r.codes.filter(c => existing.has(norm(c)));
      const shown = r.codes.length > 60 ? [...r.codes.slice(0, 40), "…", ...r.codes.slice(-10)] : r.codes;
      preview.innerHTML = `<div class="preview-head"><b>${fresh.length} novo${fresh.length === 1 ? "" : "s"}</b>${old.length ? `<span>· ${old.length} já existe${old.length === 1 ? "" : "m"} (${r.replace ? "serão atualizados" : "ficam como estão"})</span>` : ""}<span>${r.model ? `· ${esc(r.model)}` : "· escolha o modelo"}</span></div>
        <div class="mini-tiles">${shown.map(c => c === "…" ? `<span class="mini more">…</span>` : `<span class="mini ${existing.has(norm(c)) ? (r.replace ? "upd" : "skip") : ""}" title="${existing.has(norm(c)) ? (r.replace ? "Já existe — será atualizado" : "Já existe — fica como está") : "Novo"}">${esc(c)}</span>`).join("")}</div>
        ${old.length && !r.replace ? `<p class="hint">${icon("info", 14)} ${old.length === 1 ? "O número" : "Os números"} ${esc(old.slice(0, 8).join(", "))}${old.length > 8 ? "…" : ""} já ${old.length === 1 ? "existe e continua" : "existem e continuam"} único${old.length === 1 ? "" : "s"}. Para trocar os dados deles, ligue “Substituir dados” em Opções.</p>` : ""}`;
      const doNew = fresh.length, doOld = r.replace ? old.length : 0;
      go.disabled = !r.model || (!doNew && !doOld);
      go.textContent = doNew && doOld ? `Cadastrar ${doNew} e atualizar ${doOld}` : doNew ? `Cadastrar ${doNew}` : doOld ? `Atualizar ${doOld}` : "Nada a cadastrar";
      return { ...r, fresh, old };
    };
    let t;
    const check = async () => {
      const r = calc(); if (r.error) return;
      const seq = ++checkSeq;
      const { data, error } = await supabase.rpc("equipa_existing_codes", { p_codes: r.codes });
      if (seq !== checkSeq || !m.isConnected) return;
      existing = error ? new Map() : new Map((data || []).map(c => [norm(c), c]));
      paint();
    };
    form.addEventListener("input", e => { actionId = null; if (["start", "end", "prefix"].includes(e.target.name)) { clearTimeout(t); t = setTimeout(check, 250); } paint(); });
    form.addEventListener("change", () => paint());
    paint(); check();
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const r = paint(); if (r.error || go.disabled) return form.reportValidity();
      const f = new FormData(form), sp = S().readSpecInputs(form);
      const base = { model: r.model, location_text: clean(f.get("location_text")), ...sp };
      const items = r.fresh.map(code => itemFrom({ ...base, code }));
      actionId ||= uid();
      m.dataset.saving = "1"; setBusy(go, true, "Salvando…");
      try {
        const created = items.length ? await saveItems(items, actionId) : [];
        await applySpecs(created.map(x => x.id), sp.specs);
        const updated = r.replace ? await replaceExisting(r.old.map(c => existing.get(norm(c))), { model: r.model, location_text: base.location_text || null, ...S().toEquipmentColumns(sp) }, sp.specs) : 0;
        if (f.get("save_profile")) await saveProfile(r.model, sp).catch(e => console.warn("ficha do modelo", e));
        after(); notify([created.length && `${created.length} cadastrado(s)`, updated && `${updated} atualizado(s)`].filter(Boolean).join(" · ") || "Nada mudou.", "success");
        success(m, created, { ...base, start: clean(f.get("start")), end: clean(f.get("end")), prefix: r.prefix, kept: r.replace ? 0 : r.old.length, updated }, models);
      } catch (error) { notify(registerError(error), "error"); setBusy(go, false); }
      finally { delete m.dataset.saving; }
    });
    form.elements[preset.model ? "start" : "model"].focus();
  }
  function success(m, created, base, models) {
    const codes = created.map(x => x.code).sort(numSort);
    setSheet(m, { title: "Cadastro concluído", subtitle: "",
      body: `<div class="done"><span class="done-ic">${icon("check", 30)}</span><h3>${created.length ? `${created.length} equipamento${created.length === 1 ? "" : "s"} cadastrado${created.length === 1 ? "" : "s"}` : base.updated ? "Dados atualizados" : "Nada novo para cadastrar"}</h3>${codes.length ? `<p>Nº ${esc(codes[0])}${codes.length > 1 ? ` até ${esc(codes.at(-1))}` : ""} · ${esc(base.model)}${base.location_text ? ` · ${esc(base.location_text)}` : ""}</p>` : ""}
        ${base.updated ? `<p>${base.updated} já existente(s) atualizado(s) com os dados novos.</p>` : ""}${base.kept ? `<p class="muted">${base.kept} já existente(s) mantido(s) como estavam.</p>` : ""}<small class="hint">Cada um tem QR permanente e pode ser editado depois.</small></div>
        <div class="menu">${created.length ? `<button class="menu-item" type="button" id="ok-labels">${icon("tag", 20)}<span><b>Baixar etiquetas QR</b><small>PDF pronto para imprimir e colar</small></span></button>` : ""}
        <button class="menu-item" type="button" id="ok-cart">${icon("cart", 20)}<span><b>Colocar num carrinho</b><small>Cria ou completa um carrinho com estes números</small></span></button>
        <button class="menu-item" type="button" id="ok-edit">${icon("edit", 20)}<span><b>Ver e editar</b><small>Abre o grupo no inventário</small></span></button>
        <button class="menu-item" type="button" id="ok-other">${icon("layers", 20)}<span><b>Cadastrar outro modelo</b><small>Novo intervalo</small></span></button></div>`,
      foot: `<button class="btn btn-primary" type="button" data-close>Concluir</button>` });
    qs("#ok-labels", m)?.addEventListener("click", () => downloadLabels(created.map(x => ({ ...x, model: base.model })), `Equipa-etiquetas-${base.model}`));
    qs("#ok-cart", m).addEventListener("click", () => { m.close(); openCartForm({ equipment_codes: codes.length ? codes : [], location_text: base.location_text }); });
    qs("#ok-edit", m).addEventListener("click", () => { m.close(); state.devices.q = ""; state.devices.status = ""; state.devices.todo = ""; state.devices.layout = "grid"; state.devices.collapsed.clear(); navigate("devices").then(() => { const g = qsa("[data-group]").find(x => x.dataset.group === base.model); g?.scrollIntoView({ block: "start", behavior: "smooth" }); g?.classList.add("flash"); }); });
    qs("#ok-other", m).addEventListener("click", () => rangeForm(m, models, { location_text: base.location_text }));
  }

  /* ----- Um só ----- */
  function oneForm(m, models, preset = {}) {
    setSheet(m, { title: "Cadastrar equipamentos", subtitle: "Número e modelo bastam; o resto vem do modelo.",
      body: `${modeTabs("one")}<form id="one-form" class="form" autocomplete="off">
        <div class="grid-2"><label class="field"><span>Número *</span><input name="code" required maxlength="80" placeholder="Ex.: 12" value="${esc(preset.code || "")}"></label><label class="field"><span>Modelo *</span><input name="model" required maxlength="120" list="reg-models" placeholder="Ex.: ThinkPad L14" value="${esc(preset.model || "")}"></label></div>
        <p class="hint" id="one-exists"></p>
        ${modelChips(models)}${modelDatalist(models)}
        <label class="field"><span>Local (opcional)</span><input name="location_text" maxlength="160" list="reg-locs" value="${esc(preset.location_text || "")}"></label>${S().locationDatalist("reg-locs", m._locs || [])}
        ${detailsBlock()}
        <details class="more"><summary>Série, patrimônio e observações</summary><div class="grid-2"><label class="field"><span>Nº de série</span><input name="serial_number" maxlength="120" value="${esc(preset.serial_number || "")}"></label><label class="field"><span>Patrimônio</span><input name="asset_tag" maxlength="80" value="${esc(preset.asset_tag || "")}"></label></div><label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="2"></textarea></label></details>
        <label class="check" id="one-replace-wrap" hidden><input type="checkbox" name="replace"><span>Substituir os dados do número existente (mantém QR, situação e histórico)</span></label>
      </form>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary btn-lg" type="submit" form="one-form" id="one-go">Cadastrar</button>` });
    const form = qs("#one-form", m), go = qs("#one-go", m); bindModel(form, models);
    let actionId = null, found = null, seq = 0;
    const check = async () => {
      const code = clean(form.elements.code.value), s = ++seq; found = null;
      if (!code) { qs("#one-exists", m).innerHTML = ""; qs("#one-replace-wrap", m).hidden = true; go.textContent = "Cadastrar"; return; }
      const { data } = await supabase.from("equipments").select("id,code,model,status,specs").ilike("code", code.replace(/[%*,()\\]/g, "")).limit(1);
      if (s !== seq) return;
      found = data?.[0] || null;
      qs("#one-replace-wrap", m).hidden = !found;
      qs("#one-exists", m).innerHTML = found ? `${icon("info", 14)} O Nº <b>${esc(found.code)}</b> já existe (${esc(found.model)} · ${esc(statusLabel(found.status))}) e continua único. <button type="button" class="link" id="one-open">Abrir ficha</button>` : "";
      qs("#one-open", m)?.addEventListener("click", () => { m.close(); openDevice(found.id); });
      sync();
    };
    const sync = () => { go.textContent = found ? (form.elements.replace.checked ? `Atualizar Nº ${found.code}` : "Número já existe") : "Cadastrar"; go.disabled = !!found && !form.elements.replace.checked; };
    let t; form.elements.code.addEventListener("input", () => { clearTimeout(t); t = setTimeout(check, 300); });
    form.elements.replace.addEventListener("change", sync);
    form.addEventListener("input", () => { actionId = null; });
    check();
    form.addEventListener("submit", async ev => {
      ev.preventDefault(); const f = Object.fromEntries(new FormData(form)), sp = S().readSpecInputs(form);
      if (!clean(f.code) || !clean(f.model)) return form.reportValidity();
      actionId ||= uid(); m.dataset.saving = "1"; setBusy(go, true, "Salvando…");
      try {
        let row;
        if (found) {
          if (!f.replace) return;
          const cols = { model: clean(f.model), location_text: clean(f.location_text) || null, serial_number: clean(f.serial_number) || null, asset_tag: clean(f.asset_tag) || null, notes: clean(f.notes) || null, ...S().toEquipmentColumns(sp) };
          await replaceExisting([found.code], cols, sp.specs);
          row = found; notify(`Nº ${found.code} atualizado.`, "success");
        } else {
          [row] = await saveItems([itemFrom({ ...f, ...sp })], actionId);
          await applySpecs([row.id], sp.specs);
          notify(`Nº ${row.code} cadastrado.`, "success");
        }
        if (f.save_profile) await saveProfile(f.model, sp).catch(() => {});
        after();
        const next = /^\d+$/.test(clean(f.code)) ? String(Number(f.code) + 1).padStart(clean(f.code).length, "0") : "";
        oneForm(m, models, { code: next, model: f.model, location_text: f.location_text });
        qs(".sheet-body", m).insertAdjacentHTML("afterbegin", `<div class="callout callout-ok">${icon("check", 16)}<span>Nº ${esc(row.code)} salvo. Próximo:</span>${row.qr_token ? `<button type="button" class="btn btn-sm" id="one-qr">${icon("tag", 15)} Etiqueta</button>` : ""}</div>`);
        qs("#one-qr", m)?.addEventListener("click", () => downloadLabels([{ ...row, model: f.model }], `Equipa-QR-${row.code}`));
        qs('[name="code"]', m)?.focus();
      } catch (error) { notify(registerError(error), "error"); }
      finally { delete m.dataset.saving; if (go.isConnected) setBusy(go, false); }
    });
    form.elements.code.focus();
  }

  /* ----- Planilha ----- */
  const normalizeHeader = v => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, "_");
  const fieldFromRow = (row, names) => { for (const n of names) { const key = Object.keys(row).find(k => normalizeHeader(k) === n); if (key !== undefined && clean(row[key]) !== "") return clean(row[key]); } return ""; };
  const GROUP_ALIASES = { chromebook: "chromebook", positivo_novo: "positivo_novo", positivos_novos: "positivo_novo", positivo_tecnico: "positivo_tecnico", positivo_antigo: "positivo_antigo", positivos_antigos: "positivo_antigo", thinkpad: "thinkpad_lenovo", thinkpad_lenovo: "thinkpad_lenovo", lenovo: "thinkpad_lenovo", tablet: "tablet", tablete: "tablet", tabletes: "tablet", outro: "outro" };
  async function readSpreadsheet(file) {
    if (!file) throw new Error("Selecione um arquivo.");
    if (file.size > config.importMaxBytes) throw new Error("Arquivo maior que 5 MB.");
    const ext = file.name.toLowerCase().split(".").pop();
    let raw = [];
    if (ext === "docx") {
      await ensureJSZipLib();
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer()), xmlFile = zip.file("word/document.xml");
      if (!xmlFile) throw new Error("O arquivo não contém uma tabela do Word.");
      const xml = new DOMParser().parseFromString(await xmlFile.async("string"), "application/xml");
      for (const table of xml.getElementsByTagNameNS("*", "tbl")) {
        const matrix = [...table.children].filter(n => n.localName === "tr").map(tr => [...tr.children].filter(n => n.localName === "tc").map(c => [...c.getElementsByTagNameNS("*", "t")].map(t => t.textContent).join(" ").trim()));
        if (matrix.length < 2 || !matrix[0].some(k => ["numero", "codigo", "code", "n"].includes(normalizeHeader(k)))) continue;
        for (const row of matrix.slice(1)) if (row.some(Boolean)) raw.push(Object.fromEntries(matrix[0].map((k, i) => [k, row[i] || ""])));
      }
    } else if (["csv", "xlsx", "xls"].includes(ext)) {
      await ensureXLSXLib();
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
      raw = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
    } else throw new Error("Use CSV, XLSX ou DOCX com tabela.");
    if (!raw.length || raw.length > 2000) throw new Error("O arquivo deve ter de 1 a 2.000 equipamentos.");
    return raw.map((r, i) => {
      let g = normalizeHeader(fieldFromRow(r, ["tipo", "grupo", "categoria", "school_group"]));
      g = GROUP_ALIASES[g] || (g ? "outro" : "");
      const ram = fieldFromRow(r, ["ram", "ram_gb", "memoria"]), sto = fieldFromRow(r, ["armazenamento", "storage", "storage_gb", "disco"]);
      return { _raw: r, line: i + 2, code: fieldFromRow(r, ["numero", "codigo", "code", "n", "id"]), model: fieldFromRow(r, ["modelo", "model"]), brand: fieldFromRow(r, ["marca", "brand", "fabricante"]), school_group: g || null,
        asset_tag: fieldFromRow(r, ["patrimonio", "asset_tag"]) || null, serial_number: fieldFromRow(r, ["numero_de_serie", "numero_serie", "serie", "serial", "serial_number"]) || null,
        location_text: fieldFromRow(r, ["local", "localizacao", "location", "location_text"]) || null, label: fieldFromRow(r, ["nome", "label"]) || null, notes: fieldFromRow(r, ["observacao", "observacoes", "notes"]) || null,
        processor: fieldFromRow(r, ["processador", "processor", "cpu"]) || null, operating_system: fieldFromRow(r, ["sistema_operacional", "sistema", "so"]) || null,
        ram_gb: /^\d+$/.test(ram) ? Number(ram) : null, storage_gb: /^\d+$/.test(sto) ? Number(sto) : null };
    });
  }
  function importForm(m, models) {
    setSheet(m, { title: "Cadastrar equipamentos", subtitle: "Uma planilha com as colunas Número e Modelo é suficiente. Colunas com o nome de um campo personalizado também são lidas.",
      body: `${modeTabs("import")}<form id="im-form" class="form"><label class="drop"><input type="file" name="file" accept=".csv,.xlsx,.xls,.docx">${icon("upload", 26)}<b>Escolher arquivo</b><small>CSV, Excel ou tabela do Word · até 2.000 linhas</small></label>
        <div class="grid-2"><label class="field"><span>Modelo para linhas sem modelo</span><input name="model" maxlength="120" list="reg-models" placeholder="Opcional"></label><label class="field"><span>Local para linhas sem local</span><input name="location_text" maxlength="160" list="reg-locs" placeholder="Opcional"></label></div>${modelDatalist(models)}${S().locationDatalist("reg-locs", m._locs || [])}
        ${existingMode()}
        <p class="hint">${icon("layers", 14)} Plataforma, processador, memória e campos vazios na planilha são herdados do modelo.</p>
        <div class="preview" id="im-preview"></div></form>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="im-form" id="im-go" disabled>Importar</button>` });
    const form = qs("#im-form", m), preview = qs("#im-preview", m), go = qs("#im-go", m);
    let raw = [], rows = [], ids = [], offset = 0, created = [], updated = 0, existing = new Map();
    const replace = () => form.elements.on_existing.value === "replace";
    const build = () => {
      const sm = clean(form.elements.model.value), sl = clean(form.elements.location_text.value);
      rows = raw.map(r => ({ ...r, model: r.model || sm, location_text: r.location_text || sl || null }));
      const seen = new Set(), bad = [];
      rows.forEach(r => { const p = []; if (!r.code) p.push("sem número"); if (!r.model) p.push("sem modelo"); if (r.code && seen.has(norm(r.code))) p.push("número repetido na planilha"); seen.add(norm(r.code)); if (p.length) bad.push(`Linha ${r.line}: ${p.join(", ")}`); });
      const old = rows.filter(r => existing.has(norm(r.code))).length, fresh = rows.length - old;
      preview.innerHTML = rows.length ? `<div class="preview-head"><b>${fresh} novo(s)</b>${old ? `<span>· ${old} já existe(m) (${replace() ? "serão atualizados" : "ficam como estão"})</span>` : ""}<span>${bad.length ? `· ${bad.length} linha(s) para corrigir` : ""}</span></div><div class="mini-tiles">${rows.slice(0, 40).map(r => `<span class="mini ${existing.has(norm(r.code)) ? (replace() ? "upd" : "skip") : ""}">${esc(r.code || "?")}</span>`).join("")}${rows.length > 40 ? `<span class="mini more">+${rows.length - 40}</span>` : ""}</div>${bad.length ? `<div class="callout callout-warn">${icon("warn", 16)}<span>${bad.slice(0, 5).map(esc).join("<br>")}${bad.length > 5 ? "<br>…" : ""}</span></div>` : ""}` : "";
      const work = fresh + (replace() ? old : 0);
      go.disabled = !rows.length || bad.length > 0 || offset > 0 || !work; go.textContent = work ? `Importar ${work}` : "Nada a importar";
    };
    form.elements.file.addEventListener("change", async () => {
      go.disabled = true; preview.innerHTML = loadingState("Lendo arquivo…"); raw = []; ids = []; offset = 0; created = []; updated = 0;
      try {
        raw = await readSpreadsheet(form.elements.file.files?.[0]);
        const codes = raw.map(r => r.code).filter(Boolean); existing = new Map();
        for (let i = 0; i < codes.length; i += 500) { const { data } = await supabase.rpc("equipa_existing_codes", { p_codes: codes.slice(i, i + 500) }); (data || []).forEach(c => existing.set(norm(c), c)); }
        qs(".drop b", form).textContent = form.elements.file.files[0].name; build();
      } catch (error) { preview.innerHTML = `<div class="callout callout-warn">${icon("warn", 16)}<span>${esc(registerError(error))}</span></div>`; }
    });
    form.addEventListener("input", e => { if (["model", "location_text"].includes(e.target.name) && !offset) { ids = []; build(); } });
    form.addEventListener("change", e => { if (e.target.name === "on_existing" && !offset) build(); });
    form.addEventListener("submit", async ev => {
      ev.preventDefault(); if (go.disabled) return;
      m.dataset.saving = "1"; go.disabled = true;
      try {
        // Herança por modelo (uma consulta por modelo distinto).
        const inh = new Map();
        for (const name of [...new Set(rows.map(r => norm(r.model)))]) inh.set(name, await S().inherit(rows.find(r => norm(r.model) === name).model).catch(() => ({})) || {});
        const full = rows.map(r => {
          const h = inh.get(norm(r.model)) || {}, out = { ...r };
          for (const k of ["brand", "school_group", "operating_system", "processor", "ram_gb", "storage_gb"]) if (!out[k]) out[k] = h[k] || null;
          const specs = { ...(h.specs || {}) };
          for (const f of S().fields()) { const v = fieldFromRow(r._raw || {}, [normalizeHeader(f.label), f.key]); if (v) specs[f.key] = v; }
          out.specs = specs; return out;
        });
        const fresh = full.filter(r => !existing.has(norm(r.code))), old = full.filter(r => existing.has(norm(r.code)));
        while (offset < fresh.length) {
          const chunk = fresh.slice(offset, offset + MAX), k = Math.floor(offset / MAX); ids[k] ||= uid();
          go.textContent = `Salvando ${offset + 1}–${offset + chunk.length} de ${fresh.length}…`;
          const rowsOut = await saveItems(chunk.map(itemFrom), ids[k]);
          created.push(...rowsOut);
          // Campos personalizados linha a linha (podem variar entre linhas).
          if (S().hasSpecs()) for (let i = 0; i < rowsOut.length; i++) if (Object.keys(chunk[i].specs || {}).length) await supabase.from("equipments").update({ specs: chunk[i].specs }).eq("id", rowsOut[i].id);
          offset += chunk.length;
        }
        if (replace()) for (const r of old) { go.textContent = `Atualizando ${updated + 1} de ${old.length}…`; updated += await replaceExisting([existing.get(norm(r.code))], { ...itemFrom(r), code: undefined }, r.specs); }
        after(); notify([created.length && `${created.length} importado(s)`, updated && `${updated} atualizado(s)`].filter(Boolean).join(" · "), "success");
        success(m, created, { model: rows[0]?.model || "", location_text: "", updated, kept: replace() ? 0 : old.length }, models);
      } catch (error) {
        if (offset) after();
        notify(`${offset} salvos. ${registerError(error)}`, "error");
        go.disabled = false; go.textContent = `Continuar`;
      } finally { delete m.dataset.saving; }
    });
  }

  /* ----- Etiquetas: agora no gerador com prévia (labels.js) ----- */
  const downloadLabels = list => EquipaLabels.open(list, "Etiquetas QR");
  const chooseLabels = () => EquipaLabels.open(null, "Etiquetas QR");

  return { open, saveOne, downloadLabels, chooseLabels, readSpreadsheet };
})();
