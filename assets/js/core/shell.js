/* Equipa — estrutura do painel: menu lateral, barra inferior, navegação entre telas e avisos.
 * mountShell() desenha a moldura uma vez por sessão; navigate() troca só o conteúdo. */
"use strict";

/* ===================== Estrutura (montada uma vez por sessão) ===================== */
const VIEWS = {
  home: { label: "Início", ic: "home" },
  devices: { label: "Equipamentos", ic: "devices" },
  moves: { label: "Controle", ic: "board" },
  carts: { label: "Carrinhos", ic: "cart" },
  maintenance: { label: "Manutenção", ic: "tool", admin: true },
  reports: { label: "Relatórios", ic: "chart", admin: true },
  users: { label: "Usuários", ic: "users", admin: true },
  audit: { label: "Auditoria", ic: "shield", admin: true },
  settings: { label: "Configurações", ic: "gear", admin: true }
};
let shellMounted = false;
function mountShell() {
  const admin = isAdmin();
  const initial = esc(firstName().slice(0, 1).toUpperCase());
  const navBtn = v => `<button type="button" class="nav-item" data-nav="${v}">${icon(VIEWS[v].ic, 20)}<span>${VIEWS[v].label}</span></button>`;
  app.innerHTML = `<div class="shell">
    <aside class="side" aria-label="Menu">
      <div class="side-brand">${brandMark(26)}<div><strong>Equipa</strong><small>E.E. Amador e Catharina</small></div></div>
      <button type="button" class="btn btn-primary side-cam" data-camera>${icon("camera", 19)}<span>Câmera</span></button>
      <nav class="side-nav" aria-label="Áreas"><span class="nav-label">Operação</span>${navBtn("home")}${navBtn("devices")}${navBtn("moves")}${navBtn("carts")}
        ${admin ? `<span class="nav-label">Gestão</span>${navBtn("maintenance")}${navBtn("reports")}${navBtn("users")}${navBtn("audit")}${navBtn("settings")}` : ""}</nav>
      <div class="side-foot"><div class="me"><span class="avatar">${initial}</span><div><strong>${esc(state.profile?.full_name || "Usuário")}</strong><small>${esc(roleLabel(state.profile?.role))}</small></div></div>
        <div class="side-tools"><button type="button" class="icon-btn" data-theme-toggle aria-label="Alternar tema"></button><button type="button" class="icon-btn" data-logout aria-label="Sair" title="Sair">${icon("logout", 19)}</button></div></div>
    </aside>
    <div class="main">
      <header class="top">
        <div class="top-title"><h1 id="view-title">Início</h1><p id="view-sub"></p></div>
        <form class="top-search" id="top-search" role="search">${icon("search", 18)}<input id="top-search-input" type="search" autocomplete="off" placeholder="Buscar pelo número, modelo ou local" aria-label="Buscar equipamento"><kbd>Ctrl K</kbd></form>
        <div class="top-actions">
          <button type="button" class="icon-btn mobile-only" data-camera aria-label="Abrir câmera">${icon("camera", 21)}</button>
          <button type="button" class="icon-btn" id="bell" aria-label="Avisos">${icon("bell", 20)}<i class="dot" hidden></i></button>
          <button type="button" class="avatar mobile-only" id="me-btn" aria-label="Conta e mais opções">${initial}</button>
        </div>
      </header>
      <main id="view" class="view" tabindex="-1"></main>
    </div>
    <nav class="tabbar" aria-label="Navegação">
      <button type="button" class="tab" data-nav="home">${icon("home", 22)}<span>Início</span></button>
      <button type="button" class="tab" data-nav="devices">${icon("devices", 22)}<span>Equip.</span></button>
      <button type="button" class="tab tab-cam" data-camera aria-label="Câmera"><span>${icon("camera", 26)}</span></button>
      <button type="button" class="tab" data-nav="moves">${icon("board", 22)}<span>Controle</span></button>
      <button type="button" class="tab" data-nav="carts">${icon("cart", 22)}<span>Carrinhos</span></button>
    </nav>
  </div>`;
  shellMounted = true;
  setTheme(isDark() ? "dark" : "light");
  qsa("[data-nav]").forEach(b => b.addEventListener("click", () => { if (b.dataset.nav === "carts") state.carts.open = null; navigate(b.dataset.nav); }));
  qsa("[data-camera]").forEach(b => b.addEventListener("click", () => EquipaCamera.open({ mode: "find" })));
  qsa("[data-theme-toggle]").forEach(b => b.addEventListener("click", toggleTheme));
  qsa("[data-logout]").forEach(b => b.addEventListener("click", () => supabase.auth.signOut()));
  qs("#me-btn").addEventListener("click", openMoreSheet);
  qs("#bell").addEventListener("click", openNotices);
  qs("#top-search").addEventListener("submit", e => {
    e.preventDefault();
    state.devices.q = cleanSearch(qs("#top-search-input").value); state.devices.status = "";
    qs("#top-search-input").blur();
    navigate("devices");
  });
  if (!document.documentElement.dataset.hotkeys) {
    document.documentElement.dataset.hotkeys = "1";
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && qs("#top-search-input")) { e.preventDefault(); qs("#top-search-input").focus(); }
    });
  }
  void refreshNoticeDot();
}
function openMoreSheet() {
  const admin = isAdmin();
  const item = v => `<button type="button" class="menu-item" data-go="${v}">${icon(VIEWS[v].ic, 20)}<span>${VIEWS[v].label}</span>${icon("chevron", 16)}</button>`;
  const m = openSheet({ size: "sm", title: esc(state.profile?.full_name || "Usuário"), subtitle: esc(roleLabel(state.profile?.role)),
    body: `${admin ? `<p class="menu-title">Gestão</p><div class="menu">${item("maintenance")}${item("reports")}${item("users")}${item("audit")}${item("settings")}</div>` : ""}
      <div class="menu"><button type="button" class="menu-item" data-theme-toggle="label"></button><button type="button" class="menu-item danger" data-logout>${icon("logout", 20)}<span>Sair da conta</span></button></div>
      <p class="hint center">Equipa ${esc(config.version || "")} · coordenação e 3º A</p>` });
  setTheme(isDark() ? "dark" : "light");
  qsa("[data-go]", m).forEach(b => b.addEventListener("click", () => { m.close(); navigate(b.dataset.go); }));
  qs("[data-theme-toggle]", m).addEventListener("click", toggleTheme);
  qs("[data-logout]", m).addEventListener("click", () => { m.remove(); supabase.auth.signOut(); });
}
async function navigate(view) {
  if (view === "equipment") view = "devices";
  if (view === "withdrawals" || view === "history") view = "moves";
  if (view === "admin") view = "users";
  if (!VIEWS[view] || (VIEWS[view].admin && !isAdmin())) view = "home";
  if (!shellMounted) mountShell();
  state.view = view;
  const gen = ++viewGen;
  qsa("[data-nav]").forEach(b => { const on = b.dataset.nav === view; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  setTitle(VIEWS[view].label);
  qs("#view").className = `view view-${view}`;
  qs("#view").innerHTML = loadingState();
  qs("#selbar")?.remove();
  window.scrollTo({ top: 0, behavior: "instant" });
  const render = { home: renderHome, devices: renderDevices, moves: renderMoves, carts: renderCarts, maintenance: renderMaintenance, reports: renderReports, users: renderUsers, audit: renderAudit, settings: EquipaSettings.render }[view];
  try { await render(gen); }
  catch (error) { if (alive(gen)) qs("#view").innerHTML = emptyState("Não foi possível carregar esta tela.", errText(error), "warn"); }
}
function setTitle(title, sub = "") { const t = qs("#view-title"), s = qs("#view-sub"); if (t) t.textContent = title; if (s) s.textContent = sub; document.title = title === "Início" ? "Equipa" : `${title} · Equipa`; }
const refreshView = () => navigate(state.view);

/* ===================== Avisos ===================== */
let noticeCache = { at: 0, items: [] };
async function getNotices(force = false) {
  if (!force && Date.now() - noticeCache.at < 30000) return noticeCache.items;
  const now = new Date().toISOString();
  const tasks = [
    supabase.from("withdrawals").select("id,class_name,destination,custodian_name,responsible_name,due_at").eq("status", "open").lt("due_at", now).order("due_at").limit(10).then(r => (r.data || []).map(w => ({ kind: "overdue", title: `Atrasada · ${w.custodian_name || w.responsible_name || "Sem responsável"}`, text: `${[w.class_name, w.destination].filter(Boolean).join(" · ")} · prazo ${dt(w.due_at)}`, go: () => openWithdrawal(w.id) }))).catch(() => [])
  ];
  if (isAdmin()) tasks.push(supabase.from("maintenance_events").select("id,title,opened_at,equipments(code)").eq("status", "open").order("opened_at", { ascending: false }).limit(10).then(r => (r.data || []).map(x => ({ kind: "maintenance", title: `Manutenção · Nº ${x.equipments?.code || "?"}`, text: `${x.title || ""} · desde ${dateOnly(x.opened_at)}`, go: () => navigate("maintenance") }))).catch(() => []));
  const items = (await Promise.all(tasks)).flat();
  noticeCache = { at: Date.now(), items };
  return items;
}
async function refreshNoticeDot() { if (!state.session) return; try { const items = await getNotices(); const d = qs("#bell .dot"); if (d) d.hidden = !items.length; } catch {} }
async function openNotices() {
  const m = openSheet({ size: "sm", title: "Avisos", subtitle: "O que precisa de atenção agora", body: loadingState("Consultando…") });
  const items = await getNotices(true);
  if (!m.isConnected) return;
  setSheet(m, { body: items.length ? `<div class="menu">${items.map((x, i) => `<button type="button" class="menu-item notice notice-${x.kind}" data-i="${i}">${icon(x.kind === "overdue" ? "clock" : "tool", 20)}<span><b>${esc(x.title)}</b><small>${esc(x.text)}</small></span>${icon("chevron", 16)}</button>`).join("")}</div>` : emptyState("Tudo em dia", "Nenhuma devolução atrasada ou manutenção aberta.", "check") });
  qsa("[data-i]", m).forEach(b => b.addEventListener("click", () => { m.close(); items[Number(b.dataset.i)]?.go(); }));
  const d = qs("#bell .dot"); if (d) d.hidden = !items.length;
}
