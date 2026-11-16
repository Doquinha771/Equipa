/* Equipa 1.0 — cadastro de equipamentos.
 * Caminho principal: "De 1 até 30 · Modelo" → Cadastrar. Uma única transação no
 * PostgreSQL (equipa_register_equipment_batch): ou entra o lote inteiro, ou nada.
 * Também: um só, pela câmera (camera.js) e por planilha. Edição fica em app.js. */
"use strict";
const EquipaRegister = (() => {
  const MAX = 200;
  const registerError = error => {
    const raw = String(error?.message || error || "Erro desconhecido");
    if (/EQUIPA_EQUIPMENT_DUPLICATE|duplicate key|23505/i.test(raw)) return "Algum desses números, patrimônios ou séries já está cadastrado. Nada foi salvo nesta tentativa.";
    if (/EQUIPA_DUPLICATE_IN_BATCH/.test(raw)) return "Há números, patrimônios ou séries repetidos no lote.";
    if (/EQUIPA_INVALID_ROW_(\d+)/.test(raw)) return `O item ${raw.match(/EQUIPA_INVALID_ROW_(\d+)/)[1]} tem um campo inválido.`;
    if (/EQUIPA_BATCH_SIZE_INVALID/.test(raw)) return `Cadastre de 1 a ${MAX} por vez.`;
    if (/EQUIPA_BATCH_ACTION_CONFLICT/.test(raw)) return "Os dados mudaram depois do envio. Tente novamente.";
    return errText(error);
  };
  const codeFor = (prefix, startStr, i) => prefix + String(Number(startStr) + i).padStart(startStr.length, "0");
  const after = () => { invalidateData(); if (state.view === "devices" || state.view === "home") refreshView(); };

  /** Grava itens já montados. Retorna as linhas criadas (id, code, qr_token). */
  async function saveItems(items, actionId) {
    const { data, error } = await supabase.rpc("equipa_register_equipment_batch", { p_items: items, p_action_id: actionId });
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== items.length || data.some(x => !x.id || !x.qr_token)) throw new Error("Resposta incerta do servidor. Confira o inventário antes de repetir.");
    return data;
  }
  function itemFrom({ code, model, brand, school_group, location_text, serial_number, asset_tag, label, notes }) {
    return { code: clean(code), model: clean(model), brand: clean(brand) || "Não informado", school_group: school_group || null, location_text: clean(location_text) || null, serial_number: clean(serial_number) || null, asset_tag: clean(asset_tag) || null, label: clean(label) || null, notes: clean(notes) || null };
  }
  /** Usado pela câmera: cadastra um único equipamento. */
  async function saveOne(fields) {
    const [row] = await saveItems([itemFrom(fields)], uid());
    after();
    return row;
  }

  const modeTabs = mode => `<div class="segmented segmented-lg reg-tabs" role="tablist">${[["range", "layers", "Vários"], ["camera", "camera", "Câmera"], ["one", "plus", "Um só"], ["import", "upload", "Planilha"]].map(([k, ic, l]) => `<button type="button" role="tab" data-mode="${k}" class="${mode === k ? "on" : ""}" aria-selected="${mode === k}">${icon(ic, 17)}<span>${l}</span></button>`).join("")}</div>`;
  const modelChips = models => models.length ? `<div class="chips chips-tight" aria-label="Modelos já usados">${models.slice(0, 8).map(m => `<button type="button" class="chip" data-model="${esc(m.name)}">${esc(m.name)}${m.count ? `<b>${m.count}</b>` : ""}</button>`).join("")}</div>` : "";
  const modelDatalist = models => `<datalist id="reg-models">${models.map(m => `<option value="${esc(m.name)}">`).join("")}</datalist>`;
  function bindModel(form, models) {
    const input = form.elements.model, group = form.elements.school_group, brand = form.elements.brand;
    const apply = () => {
      const known = models.find(m => norm(m.name) === norm(input.value));
      const g = known?.group || guessGroup(input.value);
      if (group && !group.dataset.touched) group.value = g || "";
      if (brand && !brand.dataset.touched) brand.value = known?.brand || "";
      qsa("[data-model]", form).forEach(c => c.classList.toggle("on", norm(c.dataset.model) === norm(input.value)));
    };
    qsa("[data-model]", form).forEach(c => c.addEventListener("click", () => { input.value = c.dataset.model; apply(); input.dispatchEvent(new Event("input", { bubbles: true })); }));
    input.addEventListener("input", apply); input.addEventListener("change", apply);
    group?.addEventListener("change", () => { group.dataset.touched = "1"; });
    brand?.addEventListener("input", () => { brand.dataset.touched = "1"; });
    apply();
  }

  async function open(mode = "range", preset = {}) {
    if (!isAdmin()) return notify("Apenas administradores podem cadastrar equipamentos.", "error");
    if (mode === "camera") return EquipaCamera.open({ mode: "register" });
    const m = openSheet({ size: "md", className: "reg-sheet", title: "Adicionar equipamentos", body: loadingState() });
    const models = await knownModels();
    if (!m.isConnected) return;
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
    setSheet(m, { title: "Adicionar equipamentos", subtitle: "Informe o intervalo de números e o modelo.",
      body: `${modeTabs("range")}<form id="rg-form" class="form" autocomplete="off">
        <div class="range"><label class="field"><span>Do número</span><input name="start" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" required value="${esc(preset.start || "1")}"></label><span class="range-sep">até</span><label class="field"><span>Até o número</span><input name="end" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" required value="${esc(preset.end || "30")}"></label></div>
        <label class="field"><span>Modelo de todos *</span><input name="model" required maxlength="120" list="reg-models" placeholder="Ex.: Chromebook Positivo N2210" value="${esc(preset.model || "")}"></label>
        ${modelChips(models)}${modelDatalist(models)}
        <div class="grid-2"><label class="field"><span>Tipo</span><select name="school_group">${groupOptions("")}</select></label><label class="field"><span>Local (opcional)</span><input name="location_text" maxlength="160" placeholder="Ex.: Laboratório 1" value="${esc(preset.location_text || "")}"></label></div>
        <details class="more"><summary>Opções</summary><div class="grid-2"><label class="field"><span>Prefixo do número</span><input name="prefix" maxlength="30" placeholder="Ex.: CB-  →  CB-1, CB-2…"></label><label class="field"><span>Fabricante</span><input name="brand" maxlength="100" placeholder="Ex.: Positivo"></label></div>
          <p class="hint">Use um prefixo quando dois modelos tiverem a mesma numeração (ex.: Chromebooks 1–30 e Positivos 1–30).</p></details>
        <div class="preview" id="rg-preview" aria-live="polite"></div>
      </form>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary btn-lg" type="submit" form="rg-form" id="rg-go">Cadastrar</button>` });
    const form = qs("#rg-form", m), preview = qs("#rg-preview", m), go = qs("#rg-go", m);
    bindModel(form, models);
    let actionId = null, existing = new Set(), skip = false, checkSeq = 0;
    const calc = () => {
      const f = new FormData(form), start = clean(f.get("start")), end = clean(f.get("end")), prefix = clean(f.get("prefix"));
      if (!/^\d{1,8}$/.test(start) || !/^\d{1,8}$/.test(end)) return { error: "Use apenas números no intervalo." };
      const n = Number(end) - Number(start) + 1;
      if (n < 1) return { error: "O número final precisa ser maior ou igual ao inicial." };
      if (n > MAX) return { error: `Até ${MAX} por vez. Divida em mais de um lote.` };
      // "1" gera 1, 2…; "01" gera 01, 02… (mantém os zeros digitados).
      const codes = Array.from({ length: n }, (_, i) => codeFor(prefix, start, i));
      if (codes.at(-1).length > 80) return { error: "Os números ficaram longos demais." };
      return { codes, model: clean(f.get("model")), prefix };
    };
    const paint = () => {
      const r = calc();
      if (r.error) { preview.innerHTML = `<p class="callout callout-warn">${icon("warn", 16)}<span>${esc(r.error)}</span></p>`; go.disabled = true; go.textContent = "Cadastrar"; return r; }
      const dup = r.codes.filter(c => existing.has(norm(c))), todo = skip ? r.codes.filter(c => !existing.has(norm(c))) : r.codes;
      const shown = r.codes.length > 60 ? [...r.codes.slice(0, 40), "…", ...r.codes.slice(-10)] : r.codes;
      preview.innerHTML = `<div class="preview-head"><b>${todo.length} equipamento${todo.length === 1 ? "" : "s"}</b><span>${r.model ? esc(r.model) : "escolha o modelo"}</span></div>
        <div class="mini-tiles">${shown.map(c => c === "…" ? `<span class="mini more">…</span>` : `<span class="mini ${existing.has(norm(c)) ? (skip ? "skip" : "dup") : ""}" title="${existing.has(norm(c)) ? "Já cadastrado" : "Novo"}">${esc(c)}</span>`).join("")}</div>
        ${dup.length ? `<div class="callout callout-warn">${icon("warn", 16)}<span><b>${dup.length} já ${dup.length === 1 ? "existe" : "existem"}</b> (${esc(dup.slice(0, 6).join(", "))}${dup.length > 6 ? "…" : ""}). Use um prefixo em “Opções” ou pule.</span><button type="button" class="btn btn-sm" id="rg-skip">${skip ? "Não pular" : "Pular existentes"}</button></div>` : ""}`;
      qs("#rg-skip", preview)?.addEventListener("click", () => { skip = !skip; actionId = null; paint(); });
      go.disabled = !todo.length || !r.model || (dup.length && !skip);
      go.textContent = todo.length ? `Cadastrar ${todo.length}` : "Cadastrar";
      return { ...r, todo };
    };
    let t;
    const check = async () => {
      const r = calc(); if (r.error) return;
      const seq = ++checkSeq;
      const { data, error } = await supabase.rpc("equipa_existing_codes", { p_codes: r.codes });
      if (seq !== checkSeq || !m.isConnected) return;
      existing = error ? new Set() : new Set((data || []).map(norm));
      paint();
    };
    form.addEventListener("input", e => { actionId = null; if (["start", "end", "prefix"].includes(e.target.name)) { skip = false; clearTimeout(t); t = setTimeout(check, 250); } paint(); });
    paint(); check();
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const r = paint(); if (r.error || go.disabled) return form.reportValidity();
      const f = new FormData(form);
      const base = { model: r.model, brand: clean(f.get("brand")), school_group: f.get("school_group") || null, location_text: clean(f.get("location_text")) };
      const items = r.todo.map(code => itemFrom({ ...base, code }));
      actionId ||= uid();
      m.dataset.saving = "1"; setBusy(go, true, `Salvando ${items.length}…`);
      try {
        const created = await saveItems(items, actionId);
        after(); notify(`${created.length} equipamento(s) cadastrado(s).`, "success");
        success(m, created, { ...base, start: clean(f.get("start")), end: clean(f.get("end")), prefix: r.prefix }, models);
      } catch (error) { notify(registerError(error), "error"); setBusy(go, false); }
      finally { delete m.dataset.saving; }
    });
    form.elements[preset.model ? "start" : "model"].focus();
  }
  function success(m, created, base, models) {
    const codes = created.map(x => x.code).sort(numSort);
    setSheet(m, { title: "Cadastro concluído", subtitle: "",
      body: `<div class="done"><span class="done-ic">${icon("check", 30)}</span><h3>${created.length} equipamento${created.length === 1 ? "" : "s"} cadastrado${created.length === 1 ? "" : "s"}</h3><p>Nº ${esc(codes[0])}${codes.length > 1 ? ` até ${esc(codes.at(-1))}` : ""} · ${esc(base.model)}${base.location_text ? ` · ${esc(base.location_text)}` : ""}</p><small class="hint">Todos disponíveis, cada um com QR permanente. Dá para editar qualquer um depois.</small></div>
        <div class="menu"><button class="menu-item" type="button" id="ok-labels">${icon("tag", 20)}<span><b>Baixar etiquetas QR</b><small>PDF pronto para imprimir e colar</small></span></button>
        <button class="menu-item" type="button" id="ok-edit">${icon("edit", 20)}<span><b>Ver e editar</b><small>Abre o grupo no inventário</small></span></button>
        <button class="menu-item" type="button" id="ok-other">${icon("layers", 20)}<span><b>Cadastrar outro modelo</b><small>Novo intervalo</small></span></button></div>`,
      foot: `<button class="btn btn-primary" type="button" data-close>Concluir</button>` });
    qs("#ok-labels", m).addEventListener("click", () => downloadLabels(created.map(x => ({ ...x, model: base.model })), `Equipa-etiquetas-${base.model}`));
    qs("#ok-edit", m).addEventListener("click", () => { m.close(); state.devices.q = ""; state.devices.status = ""; state.devices.layout = "grid"; state.devices.collapsed.clear(); navigate("devices").then(() => { const g = qsa("[data-group]").find(x => x.dataset.group === base.model); g?.scrollIntoView({ block: "start", behavior: "smooth" }); g?.classList.add("flash"); }); });
    qs("#ok-other", m).addEventListener("click", () => rangeForm(m, models, { location_text: base.location_text }));
  }

  /* ----- Um só ----- */
  function oneForm(m, models, preset = {}) {
    setSheet(m, { title: "Adicionar equipamentos", subtitle: "Número e modelo bastam.",
      body: `${modeTabs("one")}<form id="one-form" class="form" autocomplete="off">
        <div class="grid-2"><label class="field"><span>Número *</span><input name="code" required maxlength="80" placeholder="Ex.: 12" value="${esc(preset.code || "")}"></label><label class="field"><span>Modelo *</span><input name="model" required maxlength="120" list="reg-models" placeholder="Ex.: ThinkPad L14" value="${esc(preset.model || "")}"></label></div>
        ${modelChips(models)}${modelDatalist(models)}
        <div class="grid-2"><label class="field"><span>Tipo</span><select name="school_group">${groupOptions("")}</select></label><label class="field"><span>Local (opcional)</span><input name="location_text" maxlength="160" value="${esc(preset.location_text || "")}"></label></div>
        <details class="more"><summary>Mais detalhes (opcional)</summary><div class="grid-2"><label class="field"><span>Nº de série</span><input name="serial_number" maxlength="120"></label><label class="field"><span>Patrimônio</span><input name="asset_tag" maxlength="80"></label><label class="field"><span>Fabricante</span><input name="brand" maxlength="100"></label></div></details>
      </form>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary btn-lg" type="submit" form="one-form">Cadastrar</button>` });
    const form = qs("#one-form", m); bindModel(form, models);
    let actionId = null; form.addEventListener("input", () => { actionId = null; });
    form.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = qs('.sheet-foot [type="submit"]', m), f = Object.fromEntries(new FormData(form));
      if (!clean(f.code) || !clean(f.model)) return form.reportValidity();
      actionId ||= uid(); m.dataset.saving = "1"; setBusy(b, true, "Salvando…");
      try {
        const [row] = await saveItems([itemFrom(f)], actionId);
        after(); notify(`Nº ${row.code} cadastrado.`, "success");
        const next = /^\d+$/.test(clean(f.code)) ? String(Number(f.code) + 1).padStart(clean(f.code).length, "0") : "";
        oneForm(m, models, { code: next, model: f.model, location_text: f.location_text });
        qs(".sheet-body", m).insertAdjacentHTML("afterbegin", `<div class="callout callout-ok">${icon("check", 16)}<span>Nº ${esc(row.code)} cadastrado. Próximo:</span><button type="button" class="btn btn-sm" id="one-qr">${icon("tag", 15)} Etiqueta</button></div>`);
        qs("#one-qr", m).addEventListener("click", () => downloadLabels([{ ...row, model: f.model }], `Equipa-QR-${row.code}`));
        qs('[name="code"]', m)?.focus();
      } catch (error) { notify(registerError(error), "error"); setBusy(b, false); }
      finally { delete m.dataset.saving; }
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
      return { line: i + 2, code: fieldFromRow(r, ["numero", "codigo", "code", "n", "id"]), model: fieldFromRow(r, ["modelo", "model"]), brand: fieldFromRow(r, ["marca", "brand", "fabricante"]), school_group: g || null,
        asset_tag: fieldFromRow(r, ["patrimonio", "asset_tag"]) || null, serial_number: fieldFromRow(r, ["numero_de_serie", "numero_serie", "serie", "serial", "serial_number"]) || null,
        location_text: fieldFromRow(r, ["local", "localizacao", "location", "location_text"]) || null, label: fieldFromRow(r, ["nome", "label"]) || null, notes: fieldFromRow(r, ["observacao", "observacoes", "notes"]) || null,
        processor: fieldFromRow(r, ["processador", "processor", "cpu"]) || null, operating_system: fieldFromRow(r, ["sistema_operacional", "sistema", "so"]) || null,
        ram_gb: /^\d+$/.test(ram) ? Number(ram) : null, storage_gb: /^\d+$/.test(sto) ? Number(sto) : null };
    });
  }
  function importForm(m, models) {
    setSheet(m, { title: "Adicionar equipamentos", subtitle: "Uma planilha com as colunas Número e Modelo é suficiente.",
      body: `${modeTabs("import")}<form id="im-form" class="form"><label class="drop"><input type="file" name="file" accept=".csv,.xlsx,.xls,.docx">${icon("upload", 26)}<b>Escolher arquivo</b><small>CSV, Excel ou tabela do Word · até 2.000 linhas</small></label>
        <div class="grid-2"><label class="field"><span>Modelo para linhas sem modelo</span><input name="model" maxlength="120" list="reg-models" placeholder="Opcional"></label><label class="field"><span>Local para linhas sem local</span><input name="location_text" maxlength="160" placeholder="Opcional"></label></div>${modelDatalist(models)}
        <div class="preview" id="im-preview"></div></form>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="im-form" id="im-go" disabled>Importar</button>` });
    const form = qs("#im-form", m), preview = qs("#im-preview", m), go = qs("#im-go", m);
    let raw = [], rows = [], ids = [], offset = 0, created = [], existing = new Set();
    const build = () => {
      const sm = clean(form.elements.model.value), sl = clean(form.elements.location_text.value);
      rows = raw.map(r => ({ ...r, model: r.model || sm, location_text: r.location_text || sl || null, school_group: r.school_group || guessGroup(r.model || sm) || null }));
      const seen = new Set(), bad = [];
      rows.forEach(r => { const p = []; if (!r.code) p.push("sem número"); if (!r.model) p.push("sem modelo"); if (r.code && seen.has(norm(r.code))) p.push("número repetido"); if (r.code && existing.has(norm(r.code))) p.push("já cadastrado"); seen.add(norm(r.code)); if (p.length) bad.push(`Linha ${r.line}: ${p.join(", ")}`); });
      preview.innerHTML = rows.length ? `<div class="preview-head"><b>${rows.length} equipamento(s)</b><span>${bad.length ? `${bad.length} linha(s) para corrigir` : "tudo certo"}</span></div><div class="mini-tiles">${rows.slice(0, 40).map(r => `<span class="mini">${esc(r.code || "?")}</span>`).join("")}${rows.length > 40 ? `<span class="mini more">+${rows.length - 40}</span>` : ""}</div>${bad.length ? `<div class="callout callout-warn">${icon("warn", 16)}<span>${bad.slice(0, 5).map(esc).join("<br>")}${bad.length > 5 ? "<br>…" : ""}</span></div>` : ""}` : "";
      go.disabled = !rows.length || bad.length > 0 || offset > 0; go.textContent = `Importar ${rows.length}`;
    };
    form.elements.file.addEventListener("change", async () => {
      go.disabled = true; preview.innerHTML = loadingState("Lendo arquivo…"); raw = []; ids = []; offset = 0; created = [];
      try {
        raw = await readSpreadsheet(form.elements.file.files?.[0]);
        const codes = raw.map(r => r.code).filter(Boolean); existing = new Set();
        for (let i = 0; i < codes.length; i += 500) { const { data } = await supabase.rpc("equipa_existing_codes", { p_codes: codes.slice(i, i + 500) }); (data || []).forEach(c => existing.add(norm(c))); }
        qs(".drop b", form).textContent = form.elements.file.files[0].name; build();
      } catch (error) { preview.innerHTML = `<div class="callout callout-warn">${icon("warn", 16)}<span>${esc(registerError(error))}</span></div>`; }
    });
    for (const n of ["model", "location_text"]) form.elements[n].addEventListener("input", () => { if (!offset) { ids = []; build(); } });
    form.addEventListener("submit", async ev => {
      ev.preventDefault(); if (go.disabled) return;
      m.dataset.saving = "1"; go.disabled = true;
      try {
        while (offset < rows.length) {
          const chunk = rows.slice(offset, offset + MAX), k = Math.floor(offset / MAX); ids[k] ||= uid();
          go.textContent = `Salvando ${offset + 1}–${offset + chunk.length} de ${rows.length}…`;
          created.push(...await saveItems(chunk.map(r => ({ ...itemFrom(r), processor: r.processor, operating_system: r.operating_system, ram_gb: r.ram_gb, storage_gb: r.storage_gb })), ids[k]));
          offset += chunk.length;
        }
        after(); notify(`${created.length} equipamentos importados.`, "success");
        success(m, created, { model: rows[0]?.model || "", location_text: "" }, models);
      } catch (error) {
        if (offset) after();
        notify(`${offset} de ${rows.length} salvos. ${registerError(error)}`, "error");
        go.disabled = false; go.textContent = `Continuar do item ${offset + 1}`;
      } finally { delete m.dataset.saving; }
    });
  }

  /* ----- Etiquetas QR em PDF ----- */
  async function qrDataURL(url) {
    await ensureQRCodeLib();
    const el = document.createElement("div"); el.style.cssText = "position:fixed;left:-10000px;top:0"; document.body.append(el);
    try {
      new window.QRCode(el, { text: url, width: 160, height: 160, correctLevel: window.QRCode.CorrectLevel.M });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = qs("canvas", el), img = qs("img", el);
      if (c) return c.toDataURL("image/png"); if (img?.src) return img.src;
      throw new Error("Não foi possível gerar o QR Code.");
    } finally { el.remove(); }
  }
  async function makeLabels(items) {
    await ensureJsPDF(); await ensureQRCodeLib();
    const doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const W = 63, H = 42, X = 10, Y = 12, cols = 3, per = 18;
    const sorted = [...items].sort((a, b) => numSort(a.code, b.code));
    for (let i = 0; i < sorted.length; i++) {
      if (i && i % per === 0) doc.addPage();
      const p = i % per, x = X + (p % cols) * W, y = Y + Math.floor(p / cols) * H, it = sorted[i];
      doc.setDrawColor(205, 210, 218); doc.roundedRect(x, y, W - 2, H - 2, 2, 2);
      doc.addImage(await qrDataURL(qrUrl(it.qr_token)), "PNG", x + 2.5, y + 4.5, 30, 30);
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(110); doc.text("EQUIPA", x + 35, y + 9);
      doc.setFont("helvetica", "bold"); doc.setTextColor(20);
      const code = clean(it.code).slice(0, 14); doc.setFontSize(code.length <= 4 ? 26 : code.length <= 8 ? 16 : 11); doc.text(code, x + 35, y + 21, { maxWidth: 24 });
      if (it.model) { doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(90); doc.text(clean(it.model).slice(0, 44), x + 35, y + 28, { maxWidth: 24 }); }
      if (i % 12 === 0) await sleep(0);
    }
    return doc;
  }
  async function downloadLabels(items, filename = "Equipa-etiquetas") {
    const list = (items || []).filter(x => x.qr_token);
    if (!list.length) return notify("Nenhum equipamento com QR para gerar etiquetas.", "warning");
    if (list.length > 2000) return notify("Gere até 2.000 etiquetas por PDF (filtre por local).", "warning");
    notify(`Gerando ${list.length} etiqueta(s)…`, "info");
    try { (await makeLabels(list)).save(`${safeFileName(filename)}.pdf`); notify(`${list.length} etiqueta(s) em PDF.`, "success"); }
    catch (error) { notify(registerError(error), "error"); }
  }
  async function chooseLabels() {
    if (!isAdmin()) return;
    const m = openSheet({ size: "md", title: "Etiquetas QR", subtitle: "Escolha por modelo ou local. Cada etiqueta tem o número grande e o QR.", body: loadingState() });
    let rows; try { rows = await loadDevices(); } catch (error) { setSheet(m, { body: emptyState("Não foi possível carregar.", errText(error), "warn") }); return; }
    if (!m.isConnected) return;
    const groups = groupDevices(rows);
    const locs = [...new Set(rows.map(r => r.location_text).filter(Boolean))].sort(numSort);
    setSheet(m, { body: `<div class="form"><div class="grid-2"><label class="field"><span>Modelo</span><select id="lb-model"><option value="">Todos os modelos</option>${groups.map(g => `<option>${esc(g.model)}</option>`).join("")}</select></label><label class="field"><span>Local</span><select id="lb-loc"><option value="">Todos os locais</option>${locs.map(l => `<option>${esc(l)}</option>`).join("")}</select></label></div><div class="preview" id="lb-prev"></div></div>`,
      foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="button" id="lb-go">Baixar PDF</button>` });
    const pick = () => rows.filter(r => (!qs("#lb-model", m).value || modelKey(r) === qs("#lb-model", m).value) && (!qs("#lb-loc", m).value || r.location_text === qs("#lb-loc", m).value));
    const paint = () => { const p = pick(); qs("#lb-prev", m).innerHTML = `<div class="preview-head"><b>${p.length} etiqueta(s)</b><span>${Math.ceil(p.length / 18)} folha(s) A4</span></div>`; qs("#lb-go", m).disabled = !p.length; };
    ["#lb-model", "#lb-loc"].forEach(s => qs(s, m).addEventListener("change", paint)); paint();
    qs("#lb-go", m).addEventListener("click", async () => { const b = qs("#lb-go", m); setBusy(b, true, "Gerando…"); await downloadLabels(pick(), `Equipa-etiquetas-${qs("#lb-model", m).value || qs("#lb-loc", m).value || "inventario"}`); setBusy(b, false); });
  }

  return { open, saveOne, downloadLabels, chooseLabels, readSpreadsheet };
})();
