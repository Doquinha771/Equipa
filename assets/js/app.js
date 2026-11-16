/* Equipa 1.0 — aplicativo: sessão, navegação e telas.
 * Princípio: cada tela responde a uma pergunta só.
 *   Início        → o que preciso fazer agora?
 *   Equipamentos  → onde está cada equipamento?
 *   Controle      → quem está com o quê (painel de comandas), retirar e receber.
 *   Gestão        → carrinhos, manutenção, relatórios, usuários e auditoria.
 * As regras de negócio continuam no PostgreSQL (RPCs); o navegador só valida para ajudar. */
"use strict";

const { supabase, config } = window.EquipaSupabase || {};
if (!supabase || !config) throw new Error("Cliente Supabase não inicializado.");
const app = qs("#app");

/* ===================== Tema ===================== */
const THEME_KEY = "equipa-visual-theme";
try {
  const stored = localStorage.getItem(THEME_KEY);
  document.documentElement.dataset.theme = stored ? (stored === "dark" ? "dark" : "light") : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch { document.documentElement.dataset.theme = "light"; }
const isDark = () => document.documentElement.dataset.theme === "dark";
function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.classList.add("theme-anim");
  clearTimeout(setTheme.t); setTheme.t = setTimeout(() => document.documentElement.classList.remove("theme-anim"), 400);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  qsa('meta[name="theme-color"]').forEach(m => m.setAttribute("content", dark ? "#0e1116" : "#f6f7f9"));
  qsa("[data-theme-toggle]").forEach(b => { b.innerHTML = `${icon(dark ? "sun" : "moon", 19)}${b.dataset.themeToggle === "label" ? `<span>${dark ? "Modo claro" : "Modo escuro"}</span>` : ""}`; b.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro"); });
  try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch {}
}
const toggleTheme = () => setTheme(isDark() ? "light" : "dark");

/* ===================== Estado ===================== */
const state = {
  session: null, profile: null, view: "home",
  devices: { q: "", status: "", layout: "grid", selecting: false, selected: new Map(), inactive: false, collapsed: new Set() },
  moves: { tab: "now", q: "", hStatus: "" },
  carts: { q: "" },
  maint: { q: "", status: "open" },
  audit: { q: "", entity: "", action: "", page: 0 },
  users: { q: "", role: "", page: 0 }
};
const isAdmin = () => state.profile?.role === "admin";
const firstName = () => (state.profile?.full_name || "Usuário").trim().split(/\s+/)[0] || "Usuário";
let viewGen = 0;
const alive = gen => gen === viewGen && !!qs("#view");

/* ===================== Mensagens de erro ===================== */
function errText(error) {
  const raw = error?.message || String(error || "Erro inesperado");
  if (/failed to fetch|networkerror|network request failed|tempo limite|timeout|aborterror/i.test(raw))
    return "Sem resposta do servidor. Verifique a conexão e o estado do projeto Supabase; seus dados locais de sessão foram preservados.";
  if (/PGRST202|PGRST204|PGRST205|PGRST200|PGRST106|PGRST116|42703|42P01|42883|schema cache|could not find the function|does not exist/i.test(`${error?.code || ""} ${raw}`))
    return "O site e o banco estão com versões incompatíveis ou faltam permissões/tabelas. A administração deve verificar as migrations e o diagnóstico SQL do pacote.";
  if (/read.only|read only|25006|exceeded.*quota/i.test(`${error?.code || ""} ${raw}`))
    return "O banco está em modo somente leitura ou perto do limite. Verifique a capacidade no painel Supabase; nenhuma informação operacional será apagada.";
  if (/foreign key constraint|violates foreign key|23503/i.test(raw))
    return "Este registro possui histórico relacionado. Desative o equipamento em vez de excluí-lo.";
  if (/EQUIPA_RETURN_BEFORE_DEACTIVATE/.test(raw))
    return "Equipamento em uso. Registre a devolução antes de desativá-lo.";
  if (/EQUIPA_ADMIN_REQUIRED/.test(raw))
    return "Apenas a administração pode executar esta ação.";
  const code = raw.match(/(ALOCA|DASEIN|EQUIPA)_[A-Z0-9_]+/)?.[0];
  const map = {
    ALOCA_NOT_AUTHENTICATED: "Sua sessão expirou.", ALOCA_ADMIN_REQUIRED: "Esta ação exige administrador.",
    ALOCA_PROFILE_NOT_FOUND: "Perfil não encontrado.", ALOCA_CLASS_REQUIRED: "Informe a turma.",
    ALOCA_DESTINATION_REQUIRED: "Informe o destino.", ALOCA_EQUIPMENT_NOT_FOUND: "Equipamento não encontrado.",
    ALOCA_EQUIPMENT_UNAVAILABLE: "Equipamento indisponível.", ALOCA_EQUIPMENT_MAINTENANCE: "Equipamento em manutenção.",
    ALOCA_ALREADY_IN_USE: "Este equipamento já está em uso.", ALOCA_NOT_AVAILABLE: "Este equipamento não está disponível.",
    ALOCA_NOT_IN_USE_OR_FORBIDDEN: "Não há retirada aberta para você devolver este equipamento.",
    ALOCA_BATCH_IN_USE: "O lote contém equipamento em uso.", ALOCA_BATCH_MAINTENANCE: "O lote contém equipamento em manutenção.",
    ALOCA_BATCH_UNAVAILABLE: "O lote contém equipamento indisponível.", ALOCA_BATCH_CONFLICT: "Outro usuário alterou um dos equipamentos ao mesmo tempo.",
    ALOCA_CART_DUPLICATE_NUMBER_OR_EQUIPMENT: "Número do carrinho ou equipamento já está vinculado a outro carrinho.",
    DASEIN_NOT_AUTHENTICATED: "Sua sessão expirou.", DASEIN_ADMIN_REQUIRED: "Esta ação exige administrador.",
    DASEIN_PROFILE_NOT_FOUND: "Perfil não encontrado.", DASEIN_CLASS_REQUIRED: "Informe a turma.",
    DASEIN_DESTINATION_REQUIRED: "Informe o destino.", DASEIN_RESERVATION_TIME_INVALID: "O horário final precisa ser depois do inicial.",
    DASEIN_RESERVATION_PAST: "Não é possível reservar um horário que já passou.", DASEIN_RESERVATION_CONFLICT: "Esse equipamento já possui reserva nesse intervalo.",
    DASEIN_EQUIPMENT_NOT_FOUND: "Equipamento não encontrado.", DASEIN_EQUIPMENT_UNAVAILABLE: "Equipamento indisponível.",
    DASEIN_EQUIPMENT_MAINTENANCE: "Equipamento em manutenção.", DASEIN_RESERVATION_TOO_EARLY: "A retirada só é liberada 30 minutos antes da reserva.",
    DASEIN_RESERVATION_EXPIRED: "O horário dessa reserva já terminou.", DASEIN_RESERVATION_OWNER_REQUIRED: "A retirada desta reserva deve ser feita pelo responsável que a criou.",
    DASEIN_MAINTENANCE_ALREADY_OPEN: "Já existe uma manutenção aberta para este equipamento.", DASEIN_EQUIPMENT_IN_USE: "Devolva o equipamento antes de colocá-lo em manutenção.",
    EQUIPA_ACCOUNT_DISABLED: "Esta conta está aguardando aprovação ou teve o acesso removido.", EQUIPA_LEGAL_VERSION_INVALID: "Versão dos documentos legais inválida.",
    EQUIPA_RETURN_BEFORE_DELETE: "Registre a devolução antes de apagar o equipamento.", EQUIPA_CLOSE_MAINTENANCE_FIRST: "Conclua a manutenção antes de apagar o equipamento.",
    EQUIPA_DUE_DATE_INVALID: "Escolha um prazo posterior ao atual e de até 30 dias.",
    EQUIPA_DUE_AFTER_SCHOOL_CLOSE: "A devolução deve ser prevista até 21h15, no horário da escola.",
    EQUIPA_RESERVATION_CONFLICT: "Há uma reserva confirmada durante o período desta retirada. Ajuste o prazo ou utilize a reserva existente.",
    EQUIPA_BATCH_SIZE_INVALID: "Selecione de 1 a 60 equipamentos.",
    EQUIPA_CUSTODY_INVALID: "Informe quem receberá o equipamento e o vínculo com a escola.",
    EQUIPA_CUSTODY_SELF_REQUIRED: "A retirada em nome de outra pessoa exige um professor ou administrador autenticado.",
    EQUIPA_PURPOSE_REQUIRED: "Informe o motivo da retirada e detalhe o objetivo quando selecionar Outro.",
  };
  Object.assign(map, {
    EQUIPA_INSUFFICIENT_STOCK: "Não há equipamentos suficientes para todas as datas solicitadas.",
    EQUIPA_AVAILABILITY_CHANGED: "A disponibilidade mudou. Atualize a consulta e tente novamente.",
    EQUIPA_RESERVATION_CONFLICT: "O horário foi reservado por outra pessoa. Escolha outro período.",
    EQUIPA_QUANTITY_INVALID: "Informe de 1 a 60 equipamentos.",
    EQUIPA_OCCURRENCES_INVALID: "Confira as datas: até 12 ocorrências, 90 dias de antecedência e 8 horas por reserva.",
    EQUIPA_CHECKIN_WINDOW: "O check-in abre 30 minutos antes da reserva e fecha 15 minutos após o início.",
    EQUIPA_CHECKIN_EXPIRED: "O prazo para retirar essa reserva terminou.",
    EQUIPA_BOOKING_STATE_INVALID: "A reserva mudou de estado. Atualize a agenda.",
    EQUIPA_RESERVATION_NOT_ACTIVE: "Esta reserva não está mais ativa.",
    EQUIPA_RESERVATION_NOT_FOUND: "Reserva não encontrada.",
    EQUIPA_FORBIDDEN: "Sua conta não tem permissão para realizar esta operação.",
    EQUIPA_ITEM_ALREADY_RETURNED: "Este equipamento já foi devolvido.",
    EQUIPA_RETURN_ITEMS_INVALID: "Selecione os equipamentos e suas condições corretamente.",
    EQUIPA_ITEM_NOT_IN_WITHDRAWAL: "Um dos equipamentos não pertence a esta retirada.",
    EQUIPA_WITHDRAWAL_NOT_ACTIVE: "Esta retirada já foi concluída.",
    EQUIPA_REPORT_RANGE_INVALID: "Selecione um intervalo de até 370 dias.",
    EQUIPA_CART_NUMBER_INVALID: "Informe um número de carrinho válido.",
    EQUIPA_CART_CAPACITY_INVALID: "As vagas do carrinho devem ficar entre 1 e 200.",
    EQUIPA_CART_CODES_INVALID: "Informe de 1 a 200 equipamentos para o carrinho.",
    EQUIPA_CART_OVER_CAPACITY: "Há mais equipamentos do que vagas no carrinho. Aumente as vagas ou retire números.",
    EQUIPA_CART_NUMBER_TAKEN: "Já existe um carrinho ativo com esse número. Escolha outro número.",
    EQUIPA_CART_NOT_FOUND: "Carrinho não encontrado. Atualize a página.",
  });
  if (map[code]) return map[code];
  // Erros com lista de números: EQUIPA_CART_UNKNOWN_CODES:1, 2 / EQUIPA_CART_EQUIPMENT_TAKEN:3, 4
  const listed = raw.match(/EQUIPA_CART_(UNKNOWN_CODES|EQUIPMENT_TAKEN):\s*([^\n]+)/);
  if (listed) return listed[1] === "UNKNOWN_CODES" ? `Estes números não estão cadastrados: ${listed[2]}.` : `Estes números já estão em outro carrinho: ${listed[2]}.`;
  if (/23505|duplicate key/i.test(`${error?.code || ""} ${raw}`)) return `Já existe um registro com esse número ou identificação. (código ${error?.code || "23505"})`;
  if (error?.code || /constraint|permission denied|syntax error|invalid input|does not exist|schema cache/i.test(raw)) {
    console.warn("Equipa: operação rejeitada pelo servidor", error?.code || "server", raw);
    // Mostra o código técnico para que a administração saiba o que corrigir.
    const tech = [error?.code, raw.replace(/\s+/g, " ").slice(0, 140)].filter(Boolean).join(" · ");
    return `Não foi possível concluir. Detalhe técnico: ${tech}`;
  }
  return raw.length > 220 ? "Não foi possível concluir a operação. Tente novamente." : raw;
}

/* ===================== QR ===================== */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function qrUrl(token) { const u = new URL(location.href); u.search = ""; u.hash = ""; u.searchParams.set("qr", token); return u.toString(); }
function scanTokenFromUrl() { const p = new URLSearchParams(location.search); const t = p.get("qr") || p.get("e"); return UUID_RE.test(t || "") ? t : null; }
function parseQrToken(raw = "") {
  const v = clean(raw);
  if (UUID_RE.test(v)) return v;
  try { const u = new URL(v); const t = u.searchParams.get("qr") || u.searchParams.get("e"); return UUID_RE.test(t || "") ? t : null; } catch { return null; }
}
async function scanPublic(token) {
  if (!token) return null;
  const { data, error } = await supabase.rpc("scan_qr", { p_token: token });
  if (error) return null;
  return Array.isArray(data) ? data[0] || null : data;
}

/* ===================== Login ===================== */
function authField({ id, label, type = "text", ic, placeholder = "", autocomplete = "", extra = "", toggle = false }) {
  return `<label class="field" for="${id}"><span>${label}</span><div class="input-ic">${icon(ic, 18)}<input id="${id}" type="${type}" placeholder="${esc(placeholder)}" autocomplete="${autocomplete}" ${extra}>${toggle ? `<button type="button" class="pw-toggle" data-pw="${id}" aria-label="Mostrar senha" aria-pressed="false">${icon("eye-off", 18)}</button>` : ""}</div></label>`;
}
function bindPasswordToggles(root) {
  qsa("[data-pw]", root).forEach(b => b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.pw); if (!input) return;
    const show = input.type === "password"; input.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    b.innerHTML = icon(show ? "eye" : "eye-off", 18); input.focus({ preventScroll: true });
  }));
}
function authFrame(inner) {
  return `<main class="auth">
    <section class="auth-art" aria-hidden="true">
      <div class="auth-brand">${brandMark(28)}<strong>Equipa</strong></div>
      <div class="auth-pitch"><h1>Controle dos computadores e carrinhos da escola.</h1><p>Retiradas, devoluções e conferência dos carrinhos, com o histórico guardado.</p></div>
      <small>E.E. Amador e Catharina · ${esc(config.version || "")}</small>
    </section>
    <section class="auth-side"><div class="auth-card" id="auth-card">${inner}</div></section>
  </main>`;
}
function authErrorMessage(e) {
  const code = String(e?.code || "");
  if (/otp_expired|expired/i.test(code + e?.description)) return "Este link expirou ou já foi usado. Peça um novo e-mail abaixo.";
  if (/access_denied/i.test(code)) return "O link não é mais válido. Peça um novo e-mail abaixo.";
  return e?.description || "Não foi possível validar o link do e-mail.";
}
let availabilityGen = 0;
async function checkAvailabilitySilently() {
  const g = ++availabilityGen;
  const info = await supabase.checkAvailability();
  if (g !== availabilityGen || !qs("#auth-card")) return;
  if (!info.ok) {
    window.__equipaBootReady?.();
    app.innerHTML = `<main class="boot boot-error"><div class="boot-card" role="alert"><strong>O Equipa está indisponível.</strong><span>${esc(info.detail || "Não foi possível acessar o servidor. Verifique sua conexão.")}</span><button class="btn btn-primary" id="availability-retry" type="button">Tentar novamente</button></div></main>`;
    qs("#availability-retry")?.addEventListener("click", () => { showBootLoader(); void boot(); });
  }
}
function renderAuth(scan = null, urlEvent = null) {
  shellMounted = false;
  app.innerHTML = authFrame(`
    <div class="auth-mobile-brand">${brandMark(30)}<span>Equipa</span></div>
    <h2 id="auth-heading">Entrar</h2><p class="muted" id="auth-intro">Use seu e-mail escolar.</p>
    ${urlEvent?.type === "error" ? `<div class="callout callout-warn" role="alert">${icon("warn", 18)}<span>${esc(authErrorMessage(urlEvent))}</span></div>` : ""}
    ${scan ? `<div class="callout">${icon("qr", 18)}<span>QR reconhecido: <b>${esc(scan.display_name)}</b>. Entre para continuar.</span></div>` : ""}
    <div class="segmented auth-tabs" role="tablist"><button type="button" role="tab" class="on" data-tab="login" aria-selected="true">Entrar</button><button type="button" role="tab" data-tab="signup" aria-selected="false">Criar conta</button></div>
    <form id="login-form" class="stack">
      ${authField({ id: "login-email", label: "E-mail", type: "email", ic: "mail", placeholder: "nome@al.educacao.sp.gov.br", autocomplete: "email", extra: 'inputmode="email" required' })}
      ${authField({ id: "login-password", label: "Senha", type: "password", ic: "lock", placeholder: "Sua senha", autocomplete: "current-password", extra: 'minlength="6" required', toggle: true })}
      <div class="row-between"><label class="check"><input id="login-remember" type="checkbox"><span>Manter conectado</span></label><button class="link" id="forgot" type="button">Esqueci a senha</button></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Entrar</button>
    </form>
    <form id="signup-form" class="stack hidden">
      ${authField({ id: "signup-name", label: "Nome completo", ic: "user", placeholder: "Seu nome", autocomplete: "name", extra: 'minlength="3" maxlength="120" required' })}
      ${authField({ id: "signup-email", label: "E-mail escolar", type: "email", ic: "mail", placeholder: "nome@al.educacao.sp.gov.br", autocomplete: "email", extra: 'inputmode="email" required' })}
      ${authField({ id: "signup-password", label: "Senha", type: "password", ic: "lock", placeholder: "Mínimo de 8 caracteres", autocomplete: "new-password", extra: 'minlength="8" required', toggle: true })}
      <label class="check"><input id="signup-terms" type="checkbox" required><span>Li os <button class="link" data-legal="terms" type="button">Termos de Uso</button> e a <button class="link" data-legal="privacy" type="button">Política de Privacidade</button>.</span></label>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Criar conta</button>
      <p class="hint">Novas contas aguardam aprovação da administração.</p>
    </form>`);
  void checkAvailabilitySilently();
  const card = qs("#auth-card");
  const setTab = tab => {
    const login = tab === "login";
    qsa("[data-tab]", card).forEach(b => { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-selected", String(b.dataset.tab === tab)); });
    qs("#login-form").classList.toggle("hidden", !login); qs("#signup-form").classList.toggle("hidden", login);
    qs("#auth-heading").textContent = login ? "Entrar" : "Criar conta";
    qs("#auth-intro").textContent = login ? "Use seu e-mail escolar." : "Cadastre-se com o e-mail da escola.";
  };
  qsa("[data-tab]", card).forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  bindPasswordToggles(card);
  qsa("[data-legal]", card).forEach(b => b.addEventListener("click", () => openLegal(b.dataset.legal)));
  qs("#login-form").addEventListener("submit", async e => {
    e.preventDefault(); const b = qs('[type="submit"]', e.currentTarget); setBusy(b, true, "Entrando…");
    const { error } = await supabase.auth.signInWithPassword({ email: qs("#login-email").value.trim(), password: qs("#login-password").value, remember: qs("#login-remember").checked });
    setBusy(b, false);
    if (error) notify(/email not confirmed/i.test(error.message) ? "Confirme seu e-mail antes de entrar. Veja a caixa de entrada e o spam." : errText(error), "error");
  });
  qs("#signup-form").addEventListener("submit", async e => {
    e.preventDefault(); const b = qs('[type="submit"]', e.currentTarget); setBusy(b, true, "Criando…");
    const email = qs("#signup-email").value.trim();
    const { data, error } = await supabase.auth.signUp({ email, password: qs("#signup-password").value, options: { data: { full_name: qs("#signup-name").value.trim() } } });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    if (data.session) { await supabase.rpc("accept_legal_documents", { p_terms_version: config.legalTermsVersion, p_privacy_version: config.privacyVersion }); return notify("Conta criada.", "success"); }
    setTab("login"); qs("#login-email").value = email;
    notify("Conta criada. Abra o link enviado para seu e-mail para confirmar.", "success");
  });
  qs("#forgot").addEventListener("click", () => openForgotPassword(qs("#login-email").value.trim()));
  if (urlEvent?.type === "error") openForgotPassword(qs("#login-email").value.trim());
}
function openForgotPassword(prefill = "") {
  const m = openSheet({ size: "sm", title: "Recuperar senha", subtitle: "Enviaremos um link para criar uma nova senha.",
    body: `<form id="forgot-form" class="stack">${authField({ id: "forgot-email", label: "E-mail da conta", type: "email", ic: "mail", placeholder: "nome@al.educacao.sp.gov.br", autocomplete: "email", extra: `inputmode="email" required value="${esc(prefill)}"` })}<button class="link" type="button" id="forgot-resend">Não recebi o e-mail de confirmação da conta</button></form>`,
    foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="forgot-form">Enviar link</button>` });
  const input = qs("#forgot-email", m); setTimeout(() => input?.focus(), 60);
  qs("#forgot-form", m).addEventListener("submit", async e => {
    e.preventDefault(); const b = qs('.sheet-foot [type="submit"]', m); setBusy(b, true, "Enviando…");
    const { error } = await supabase.auth.resetPasswordForEmail(input.value.trim()); setBusy(b, false);
    if (error) return notify(errText(error), "error");
    m.close(); notify("Se o e-mail estiver cadastrado, o link chegará em instantes.", "success");
  });
  qs("#forgot-resend", m).addEventListener("click", async () => {
    if (!input.reportValidity()) return;
    const { error } = await supabase.auth.resend({ type: "signup", email: input.value.trim() });
    if (error) return notify(errText(error), "error");
    m.close(); notify("Novo e-mail de confirmação enviado.", "success");
  });
}
function maskEmail(v = "") { const [n, d] = String(v).split("@"); if (!d) return "—"; return `${n.slice(0, 2)}${"*".repeat(Math.min(5, Math.max(2, n.length - 2)))}@${d}`; }
function renderPasswordReset(session) {
  window.__equipaBootReady?.(); shellMounted = false;
  app.innerHTML = authFrame(`<div class="auth-mobile-brand">${brandMark(30)}<span>Equipa</span></div><h2>Nova senha</h2><p class="muted">${esc(maskEmail(session?.user?.email || ""))}</p>
    <form id="reset-form" class="stack">
      ${authField({ id: "reset-password", label: "Nova senha", type: "password", ic: "lock", placeholder: "Mínimo de 8 caracteres", autocomplete: "new-password", extra: 'minlength="8" required', toggle: true })}
      ${authField({ id: "reset-confirm", label: "Repita a senha", type: "password", ic: "lock", placeholder: "Digite novamente", autocomplete: "new-password", extra: 'minlength="8" required' })}
      <button class="btn btn-primary btn-lg btn-block" type="submit">Salvar e entrar</button><button class="link" type="button" id="reset-cancel">Cancelar e sair</button></form>`);
  bindPasswordToggles(qs("#auth-card"));
  qs("#reset-cancel").addEventListener("click", () => supabase.auth.signOut());
  qs("#reset-form").addEventListener("submit", async e => {
    e.preventDefault(); const password = qs("#reset-password").value;
    if (password !== qs("#reset-confirm").value) return notify("As senhas não coincidem.", "warning");
    const b = qs('[type="submit"]', e.currentTarget); setBusy(b, true, "Salvando…");
    const { error } = await supabase.auth.updateUser({ password }); setBusy(b, false);
    if (error) return notify(/same|different/i.test(error.message) ? "A nova senha precisa ser diferente da anterior." : errText(error), "error");
    notify("Senha alterada.", "success"); showBootLoader(); initSession(session).catch(renderStartupError);
  });
}
function openLegal(kind) {
  openSheet({ size: "lg", className: "legal-sheet", title: kind === "terms" ? "Termos de Uso" : "Política de Privacidade", body: legalDocument(kind), foot: `<button class="btn btn-primary" type="button" data-close>Fechar</button>` });
}
async function ensureLegalAcceptance() {
  const { data, error } = await supabase.rpc("has_current_legal_acceptance", { p_terms_version: config.legalTermsVersion, p_privacy_version: config.privacyVersion });
  if (error) console.warn("Aceite legal indisponível", error);
  if (!error && data === true) return true;
  return new Promise(resolve => {
    const m = openSheet({ size: "md", title: "Antes de continuar", subtitle: "Leia os documentos da escola. Registramos só a versão aceita, a conta e a data.",
      body: `<div class="row-wrap"><button class="btn" type="button" data-read="terms">${icon("file", 18)} Termos de Uso</button><button class="btn" type="button" data-read="privacy">${icon("shield", 18)} Política de Privacidade</button></div>
        <label class="check check-box"><input type="checkbox" id="legal-accept-check"><span>Li e aceito os Termos de Uso e declaro ciência da Política de Privacidade (versões ${esc(config.legalTermsVersion)} e ${esc(config.privacyVersion)}).</span></label>`,
      foot: `<button class="btn btn-ghost" type="button" data-legal-exit>Sair</button><button class="btn btn-primary" type="button" data-legal-accept disabled>Continuar</button>` });
    m.dataset.locked = "1"; qs("[data-close]", m)?.remove();
    const check = qs("#legal-accept-check", m), accept = qs("[data-legal-accept]", m);
    check.addEventListener("change", () => { accept.disabled = !check.checked; });
    qsa("[data-read]", m).forEach(b => b.addEventListener("click", () => openLegal(b.dataset.read)));
    qs("[data-legal-exit]", m).addEventListener("click", async () => { m.remove(); await supabase.auth.signOut(); resolve(false); });
    accept.addEventListener("click", async () => {
      setBusy(accept, true, "Registrando…");
      const { error } = await supabase.rpc("accept_legal_documents", { p_terms_version: config.legalTermsVersion, p_privacy_version: config.privacyVersion });
      setBusy(accept, false); if (error) return notify(errText(error), "error");
      m.remove(); resolve(true);
    });
  });
}
function renderPendingApproval() {
  shellMounted = false;
  app.innerHTML = `<main class="boot"><div class="boot-card">${brandMark(40)}<strong>Acesso ainda não liberado</strong><span>Esta conta está aguardando aprovação, suspensa ou teve o acesso removido pela administração da escola.</span><button class="btn btn-primary" id="pending-signout" type="button">Sair da conta</button></div></main>`;
  qs("#pending-signout")?.addEventListener("click", () => supabase.auth.signOut());
}

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
  settings: { label: "Ajustes", ic: "gear", admin: true }
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
      <nav class="side-nav">${navBtn("home")}${navBtn("devices")}${navBtn("moves")}${navBtn("carts")}
        ${admin ? `<span class="nav-label">Gestão</span>${navBtn("maintenance")}${navBtn("reports")}${navBtn("users")}${navBtn("audit")}${navBtn("settings")}` : ""}</nav>
      <div class="side-foot"><div class="me"><span class="avatar">${initial}</span><div><strong>${esc(state.profile?.full_name || "Usuário")}</strong><small>${esc(roleLabel(state.profile?.role))}</small></div></div>
        <div class="side-tools"><button type="button" class="icon-btn" data-theme-toggle></button><button type="button" class="icon-btn" data-logout aria-label="Sair" title="Sair">${icon("logout", 19)}</button></div></div>
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
      <button type="button" class="tab" id="tab-more">${icon("more", 22)}<span>Mais</span></button>
    </nav>
  </div>`;
  shellMounted = true;
  setTheme(isDark() ? "dark" : "light");
  qsa("[data-nav]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.nav)));
  qsa("[data-camera]").forEach(b => b.addEventListener("click", () => EquipaCamera.open({ mode: "find" })));
  qsa("[data-theme-toggle]").forEach(b => b.addEventListener("click", toggleTheme));
  qsa("[data-logout]").forEach(b => b.addEventListener("click", () => supabase.auth.signOut()));
  qs("#tab-more").addEventListener("click", openMoreSheet);
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
    body: `<div class="menu">${item("carts")}${admin ? item("maintenance") + item("reports") + item("users") + item("audit") + item("settings") : ""}</div>
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
  qs("#tab-more")?.classList.toggle("on", !["home", "devices", "moves"].includes(view));
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

/* ===================== Dados compartilhados ===================== */
const DEVICE_FIELDS = "id,code,asset_tag,brand,model,label,school_group,serial_number,location_text,status,is_active,updated_at,qr_token,operating_system,processor,ram_gb,storage_gb";
let deviceCache = { at: 0, inactive: null, rows: null, pending: null };
async function loadDevices({ force = false, inactive = false } = {}) {
  if (!force && deviceCache.rows && deviceCache.inactive === inactive && Date.now() - deviceCache.at < 30000) return deviceCache.rows;
  if (deviceCache.pending && deviceCache.inactive === inactive && !force) return deviceCache.pending;
  deviceCache.inactive = inactive;
  deviceCache.pending = (async () => {
    const rows = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.from("equipments").select(DEVICE_FIELDS + (EquipaSettings.hasSpecs() ? ",specs" : "")).eq("is_active", !inactive).order("code").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    deviceCache = { at: Date.now(), inactive, rows, pending: null };
    return rows;
  })().finally(() => { deviceCache.pending = null; });
  return deviceCache.pending;
}
/** Retiradas abertas visíveis para a conta (RLS decide o que aparece). */
async function loadOpenWithdrawals() {
  const { data, error } = await supabase.from("withdrawals").select("id,requested_by,class_name,destination,responsible_name,student_name,withdrawn_at,due_at,recorded_by_name,custodian_name,custodian_role,custody_mode,checkout_purpose,withdrawal_items(equipment_id,returned_at,equipments(code,model))").eq("status", "open").order("withdrawn_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data || []).map(w => ({ ...w, pending: (w.withdrawal_items || []).filter(i => !i.returned_at), overdue: !!(w.due_at && new Date(w.due_at).getTime() < Date.now()) }));
}
function invalidateData() { deviceCache.at = 0; modelCache.at = 0; noticeCache.at = 0; void refreshNoticeDot(); }
let modelCache = { at: 0, list: [] };
/** Modelos conhecidos: catálogo técnico + modelos já usados no inventário (com contagem). */
async function knownModels(force = false) {
  if (!force && modelCache.list.length && Date.now() - modelCache.at < 60000) return modelCache.list;
  const map = new Map();
  const add = (name, brand, group, n = 0) => {
    const k = norm(name); if (!k) return;
    const cur = map.get(k) || { name: clean(name), brand: brand && brand !== "Não informado" ? brand : "", group: group || "", count: 0 };
    cur.count += n; if (!cur.brand && brand && brand !== "Não informado") cur.brand = brand; if (!cur.group && group) cur.group = group;
    map.set(k, cur);
  };
  try { (await loadDevices()).forEach(d => add(d.model, d.brand, d.school_group, 1)); } catch {}
  try { const { data } = await supabase.from("equipment_models").select("name,manufacturer,school_group").order("name").limit(300); (data || []).forEach(m => add(m.name, m.manufacturer, m.school_group)); } catch {}
  modelCache = { at: Date.now(), list: [...map.values()].sort((a, b) => b.count - a.count || numSort(a.name, b.name)) };
  return modelCache.list;
}
async function getDevice(id) { const { data, error } = await supabase.from("equipments").select("*").eq("id", id).single(); if (error) throw error; return data; }

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

/* ===================== Equipamentos ===================== */
const DEVICE_STATUS = [["", "Todos"], ["available", "Disponíveis"], ["in_use", "Em uso"], ["maintenance", "Manutenção"], ["unavailable", "Indisponíveis"]];
const modelKey = d => clean(d.model) || "Sem modelo";
/** Cartões mais largos quando os números são longos (ex.: "DUO-01"). */
const tileWidth = items => { const n = Math.max(1, ...items.map(d => String(d.code).length)); return n <= 3 ? "" : `--tile-min:${Math.min(150, 26 + n * 11)}px;--tile-font:${n > 7 ? 14 : 16}px`; };
function groupDevices(rows) {
  const groups = new Map();
  for (const d of rows) { const k = modelKey(d); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  return [...groups.entries()].map(([model, items]) => ({ model, items: items.sort((a, b) => numSort(a.code, b.code)) })).sort((a, b) => b.items.length - a.items.length || numSort(a.model, b.model));
}
async function renderDevices(gen) {
  const s = state.devices, admin = isAdmin();
  qs("#view").innerHTML = `
    <div class="toolbar">
      <label class="search">${icon("search", 18)}<input id="dev-q" type="search" value="${esc(s.q)}" placeholder="Número, modelo, local ou série" autocomplete="off" aria-label="Buscar equipamentos"></label>
      <div class="toolbar-end">
        <div class="segmented" role="group" aria-label="Visualização"><button type="button" data-layout="grid" class="${s.layout === "grid" ? "on" : ""}" aria-label="Por modelo">${icon("grid", 18)}</button><button type="button" data-layout="list" class="${s.layout === "list" ? "on" : ""}" aria-label="Lista">${icon("list", 18)}</button></div>
        <button type="button" class="btn ${s.selecting ? "btn-on" : ""}" id="dev-select">${icon("select", 18)}<span>${s.selecting ? "Selecionando" : "Selecionar"}</span></button>
        ${admin ? `<button type="button" class="btn" id="dev-tools" aria-label="Mais ações">${icon("more", 18)}</button><button type="button" class="btn btn-primary" id="dev-add">${icon("plus", 18)}<span>Adicionar</span></button>` : ""}
      </div>
    </div>
    <div class="chips" id="dev-chips" role="group" aria-label="Situação"></div>
    <div class="chips chips-todo" id="dev-todo" role="group" aria-label="Pendências de organização"></div>
    ${s.inactive ? `<div class="callout">${icon("info", 18)}<span>Mostrando equipamentos <b>fora do catálogo</b> (desativados).</span><button class="link" id="dev-back-active" type="button">Voltar aos ativos</button></div>` : ""}
    <div id="dev-results">${loadingState("Carregando equipamentos…")}</div>`;
  let timer;
  qs("#dev-q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => { s.q = cleanSearch(e.target.value); paintDevices(); }, 160); });
  qsa("[data-layout]").forEach(b => b.addEventListener("click", () => { s.layout = b.dataset.layout; qsa("[data-layout]").forEach(x => x.classList.toggle("on", x === b)); paintDevices(); }));
  qs("#dev-select").addEventListener("click", () => { s.selecting = !s.selecting; if (!s.selecting) s.selected.clear(); renderDevices(gen); });
  qs("#dev-add")?.addEventListener("click", () => EquipaRegister.open());
  qs("#dev-tools")?.addEventListener("click", openDeviceTools);
  qs("#dev-back-active")?.addEventListener("click", () => { s.inactive = false; renderDevices(gen); });
  let rows;
  try { rows = await loadDevices({ inactive: s.inactive }); }
  catch (error) { if (alive(gen)) qs("#dev-results").innerHTML = emptyState("Não foi possível carregar.", errText(error), "warn"); return; }
  if (!alive(gen)) return;
  // Marca atrasados nos cartões quando a conta puder ver as retiradas.
  let lateIds = new Set();
  try { (await loadOpenWithdrawals()).filter(w => w.overdue).forEach(w => w.pending.forEach(i => lateIds.add(String(i.equipment_id)))); } catch {}
  if (!alive(gen)) return;
  // Mapa número → carrinho, para a pendência "sem carrinho".
  let cartOf = new Map();
  try { cartOf = (await loadCartMap()).byCode; } catch {}
  if (!alive(gen)) return;
  devicesView = { rows, lateIds, cartOf };
  paintDevices();
}
let devicesView = { rows: [], lateIds: new Set(), cartOf: new Map() };
/** Pendências que atrapalham quem organiza: cada uma vira um filtro com contagem. */
const DEVICE_TODO = [
  ["no_cart", "Sem carrinho", d => !devicesView.cartOf.has(norm(d.code))],
  ["no_place", "Sem local", d => !clean(d.location_text)],
  ["no_type", "Sem tipo", d => !d.school_group],
  ["no_os", "Sem plataforma", d => !clean(d.operating_system)],
  ["no_serial", "Sem série", d => !clean(d.serial_number)]
];
function deviceState(d) { return d.status === "in_use" && devicesView.lateIds.has(String(d.id)) ? "overdue" : d.status; }
function paintDevices() {
  const s = state.devices, host = qs("#dev-results"); if (!host) return;
  const all = devicesView.rows;
  const searched = smartFilter(all, s.q, d => [d.code, d.model, d.brand, d.label, d.location_text, d.serial_number, d.asset_tag, schoolGroupLabel(d.school_group)]);
  const counts = { "": searched.length }; for (const d of searched) counts[d.status] = (counts[d.status] || 0) + 1;
  qs("#dev-chips").innerHTML = DEVICE_STATUS.map(([v, l]) => `<button type="button" class="chip ${s.status === v ? "on" : ""} ${v ? `chip-${v}` : ""}" data-st="${v}">${l}<b>${counts[v] || 0}</b></button>`).join("");
  qsa("[data-st]").forEach(b => b.addEventListener("click", () => { s.status = b.dataset.st; paintDevices(); }));
  const todo = DEVICE_TODO.find(t => t[0] === s.todo);
  qs("#dev-todo").innerHTML = `<span class="chips-label">Organizar:</span>${DEVICE_TODO.map(([k, l, fn]) => { const n = searched.filter(fn).length; return n ? `<button type="button" class="chip chip-todo ${s.todo === k ? "on" : ""}" data-todo="${k}">${l}<b>${n}</b></button>` : ""; }).join("") || `<span class="chips-label ok">${icon("check", 14)} cadastro completo</span>`}`;
  qsa("[data-todo]").forEach(b => b.addEventListener("click", () => { s.todo = s.todo === b.dataset.todo ? "" : b.dataset.todo; paintDevices(); }));
  const rows = (s.status ? searched.filter(d => d.status === s.status) : searched).filter(d => !todo || todo[2](d));
  setTitle("Equipamentos", `${all.length} no ${s.inactive ? "arquivo" : "inventário"}`);
  if (!all.length) {
    host.innerHTML = isAdmin() && !s.inactive
      ? `<div class="empty empty-big">${icon("devices", 34)}<strong>Nenhum equipamento ainda</strong><span>Cadastre de 1 a 30 de uma vez: digite o intervalo, escolha o modelo e pronto.</span><button class="btn btn-primary btn-lg" id="empty-add" type="button">${icon("plus", 18)} Adicionar equipamentos</button></div>`
      : emptyState("Nenhum equipamento encontrado.", "", "devices");
    qs("#empty-add")?.addEventListener("click", () => EquipaRegister.open());
    return;
  }
  if (!rows.length) { host.innerHTML = emptyState("Nada encontrado.", "Tente outro número, modelo ou local.", "search"); return; }
  const sel = s.selected;
  if (s.layout === "list") {
    host.innerHTML = `<div class="card list-card"><div class="rows">${rows.map(d => `<button type="button" class="row dev-row ${sel.has(d.id) ? "picked" : ""}" data-dev="${esc(d.id)}">${s.selecting ? `<span class="tick">${icon("check", 14)}</span>` : `<span class="row-ic s-${esc(deviceState(d))}">${groupIcon(d.school_group, 18)}</span>`}<span class="row-main"><b>Nº ${esc(d.code)}</b><small>${esc([d.model, d.location_text].filter(Boolean).join(" · ") || schoolGroupLabel(d.school_group))}</small></span>${pill(deviceState(d))}${icon("chevron", 16)}</button>`).join("")}</div></div>`;
  } else {
    host.innerHTML = groupDevices(rows).map(g => {
      const free = g.items.filter(d => d.status === "available").length;
      const collapsed = s.collapsed.has(g.model) && !s.q;
      return `<section class="group ${collapsed ? "collapsed" : ""}" data-group="${esc(g.model)}">
        <header class="group-head"><button type="button" class="group-toggle" data-toggle-group aria-expanded="${!collapsed}">${icon("down", 18)}<span class="group-ic">${groupIcon(g.items[0]?.school_group, 20)}</span><span><b>${esc(g.model)}</b><small>${free} de ${g.items.length} disponíve${free === 1 ? "l" : "is"}${g.items[0]?.school_group ? ` · ${esc(schoolGroupLabel(g.items[0].school_group))}` : ""}</small></span></button>
          <div class="group-actions">${s.selecting ? `<button type="button" class="btn btn-sm" data-group-all>Marcar todos</button>` : isAdmin() ? `<button type="button" class="btn btn-sm btn-ghost" data-group-edit>${icon("edit", 16)}<span>Editar grupo</span></button>` : ""}</div></header>
        <div class="tiles" style="${tileWidth(g.items)}">${g.items.map(d => `<button type="button" class="tile s-${esc(deviceState(d))} ${sel.has(d.id) ? "picked" : ""}" data-dev="${esc(d.id)}" title="Nº ${esc(d.code)} · ${esc(statusLabel(deviceState(d)))}${d.location_text ? ` · ${esc(d.location_text)}` : ""}"><span class="tile-num">${esc(d.code)}</span><span class="tile-st">${esc(statusLabel(deviceState(d)))}</span>${s.selecting ? `<span class="tick">${icon("check", 12)}</span>` : ""}</button>`).join("")}</div>
      </section>`;
    }).join("") + `<div class="legend"><span class="lg s-available">Disponível</span><span class="lg s-in_use">Em uso</span><span class="lg s-overdue">Atrasado</span><span class="lg s-maintenance">Manutenção</span><span class="lg s-unavailable">Indisponível</span></div>`;
  }
  const byId = new Map(all.map(d => [String(d.id), d]));
  qsa("[data-dev]", host).forEach(b => b.addEventListener("click", () => {
    const d = byId.get(b.dataset.dev); if (!d) return;
    if (!s.selecting) return openDevice(d.id);
    if (sel.has(d.id)) sel.delete(d.id); else sel.set(d.id, d);
    b.classList.toggle("picked", sel.has(d.id)); paintSelbar();
  }));
  qsa("[data-toggle-group]", host).forEach(b => b.addEventListener("click", () => {
    const sec = b.closest("[data-group]"), k = sec.dataset.group;
    if (s.collapsed.has(k)) s.collapsed.delete(k); else s.collapsed.add(k);
    sec.classList.toggle("collapsed"); b.setAttribute("aria-expanded", String(!sec.classList.contains("collapsed")));
  }));
  qsa("[data-group-all]", host).forEach(b => b.addEventListener("click", () => {
    const sec = b.closest("[data-group]"); const ids = qsa("[data-dev]", sec).map(x => x.dataset.dev);
    const allOn = ids.every(id => sel.has(byId.get(id)?.id));
    ids.forEach(id => { const d = byId.get(id); if (!d) return; if (allOn) sel.delete(d.id); else sel.set(d.id, d); });
    qsa("[data-dev]", sec).forEach(x => x.classList.toggle("picked", sel.has(byId.get(x.dataset.dev)?.id)));
    paintSelbar();
  }));
  qsa("[data-group-edit]", host).forEach(b => b.addEventListener("click", () => {
    const sec = b.closest("[data-group]"); openBulkEdit(qsa("[data-dev]", sec).map(x => byId.get(x.dataset.dev)).filter(Boolean));
  }));
  paintSelbar();
}
function paintSelbar() {
  const s = state.devices; let bar = qs("#selbar");
  if (!s.selecting || state.view !== "devices") { bar?.remove(); return; }
  const list = [...s.selected.values()], free = list.filter(d => d.status === "available").length;
  if (!bar) { bar = document.createElement("div"); bar.id = "selbar"; bar.className = "selbar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Selecionados"); document.body.append(bar); }
  bar.innerHTML = `<span class="selbar-n"><b>${list.length}</b> selecionado${list.length === 1 ? "" : "s"}</span>
    <button type="button" class="btn btn-ghost" id="sel-clear" ${list.length ? "" : "disabled"}>Limpar</button>
    ${isAdmin() ? `<button type="button" class="btn" id="sel-edit" ${list.length ? "" : "disabled"}>${icon("edit", 17)}<span>Editar</span></button><button type="button" class="btn" id="sel-labels" ${list.length ? "" : "disabled"}>${icon("tag", 17)}<span>Etiquetas</span></button>` : ""}
    <button type="button" class="btn btn-primary" id="sel-out" ${free ? "" : "disabled"}>${icon("out", 17)}<span>Retirar${free ? ` ${free}` : ""}</span></button>`;
  qs("#sel-clear", bar).addEventListener("click", () => { s.selected.clear(); paintDevices(); });
  qs("#sel-edit", bar)?.addEventListener("click", () => openBulkEdit(list));
  qs("#sel-labels", bar)?.addEventListener("click", () => EquipaRegister.downloadLabels(list, "Equipa-etiquetas"));
  qs("#sel-out", bar).addEventListener("click", () => {
    const chosen = list.filter(d => d.status === "available");
    if (chosen.length > 60) return notify("Uma retirada aceita até 60 equipamentos. Desmarque alguns.", "warning");
    openCheckoutForm(chosen);
  });
}
function openDeviceTools() {
  const m = openSheet({ size: "sm", title: "Ferramentas do inventário",
    body: `<div class="menu">
      <button type="button" class="menu-item" data-t="labels">${icon("tag", 20)}<span><b>Etiquetas QR em PDF</b><small>Por sala ou do inventário inteiro</small></span></button>
      <button type="button" class="menu-item" data-t="import">${icon("upload", 20)}<span><b>Importar planilha</b><small>CSV, Excel ou tabela do Word</small></span></button>
      <button type="button" class="menu-item" data-t="export">${icon("download", 20)}<span><b>Exportar inventário</b><small>Planilha Excel com tudo</small></span></button>
      <button type="button" class="menu-item" data-t="inactive">${icon("box", 20)}<span><b>${state.devices.inactive ? "Ver equipamentos ativos" : "Ver fora do catálogo"}</b><small>Equipamentos desativados com histórico</small></span></button>
    </div>` });
  qsa("[data-t]", m).forEach(b => b.addEventListener("click", () => {
    m.close();
    const t = b.dataset.t;
    if (t === "labels") EquipaRegister.chooseLabels();
    if (t === "import") EquipaRegister.open("import");
    if (t === "export") exportEquipments();
    if (t === "inactive") { state.devices.inactive = !state.devices.inactive; state.devices.selected.clear(); navigate("devices"); }
  }));
}

/* ----- Ficha do equipamento ----- */
async function openDevice(id) {
  const m = openSheet({ size: "md", title: "Equipamento", body: loadingState() });
  let e;
  try { e = await getDevice(id); } catch (error) { setSheet(m, { body: emptyState("Não foi possível abrir.", errText(error), "warn") }); return; }
  let holder = null;
  if (e.status === "in_use") {
    try {
      const { data } = await supabase.from("withdrawal_items").select("returned_at,withdrawals(id,status,custodian_name,responsible_name,class_name,destination,due_at,custody_mode)").eq("equipment_id", e.id).order("id", { ascending: false }).limit(5);
      holder = (data || []).find(x => !x.returned_at && x.withdrawals?.status === "open")?.withdrawals || null;
    } catch {}
    if (!holder) {
      try { const ws = await loadOpenWithdrawals(); const w = ws.find(w => w.pending.some(i => String(i.equipment_id) === String(e.id))); if (w) holder = w; } catch {}
    }
  }
  if (!m.isConnected) return;
  paintDeviceSheet(m, e, holder);
}
function paintDeviceSheet(m, e, holder) {
  const admin = isAdmin();
  const late = holder?.due_at && new Date(holder.due_at).getTime() < Date.now();
  const st = e.status === "in_use" && late ? "overdue" : e.status;
  const specs = [e.operating_system, e.processor, e.ram_gb ? `${e.ram_gb} GB RAM` : "", e.storage_gb ? `${e.storage_gb} GB` : ""].filter(Boolean).join(" · ");
  const info = [["Modelo", [e.brand !== "Não informado" ? e.brand : "", e.model].filter(Boolean).join(" ")], ["Tipo", schoolGroupLabel(e.school_group)], ["Local", e.location_text], ["Patrimônio", e.asset_tag], ["Nº de série", e.serial_number], ["Nome", e.label], ["Plataforma e configuração", specs], ...EquipaSettings.describe(e.specs), ["Observações", e.notes], ["Atualizado", dt(e.updated_at)]].filter(([, v]) => v && v !== "—" || false);
  const primary = !e.is_active ? "" : e.status === "available" ? `<button class="btn btn-primary btn-lg btn-block" data-act="out" type="button">${icon("out", 20)} Retirar este</button>`
    : e.status === "in_use" ? `<button class="btn btn-primary btn-lg btn-block" data-act="return" type="button">${icon("back", 20)} Registrar devolução</button>`
    : e.status === "maintenance" && admin ? `<button class="btn btn-primary btn-lg btn-block" data-act="fix" type="button">${icon("check", 20)} Concluir manutenção</button>` : "";
  setSheet(m, {
    title: `<span class="dev-title"><span class="dev-num">Nº ${esc(e.code)}</span></span>`, subtitle: esc(e.model || ""),
    body: `<div class="dev-status s-${esc(st)}">${groupIcon(e.school_group, 22)}<div><b>${esc(statusLabel(st))}</b><small>${holder ? `Com ${esc(holder.custodian_name || holder.responsible_name || "não identificado")} · ${esc([holder.class_name, holder.destination].filter(Boolean).join(" · "))}${holder.due_at ? ` · ${esc(relativeDue(holder.due_at))}` : ""}` : e.is_active === false ? "Fora do catálogo — histórico preservado" : e.status === "available" ? "Pronto para retirar" : e.status === "maintenance" ? "Aguardando conserto" : ""}</small></div></div>
      ${primary}
      ${holder?.id ? `<button class="link" type="button" data-act="withdrawal">Ver a retirada completa</button>` : ""}
      <dl class="info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`,
    foot: `<button class="btn" type="button" data-act="qr">${icon("qr", 18)}<span>QR</span></button>${admin ? `${["available", "unavailable"].includes(e.status) && e.is_active ? `<button class="btn" type="button" data-act="maint">${icon("tool", 18)}<span>Manutenção</span></button>` : ""}<button class="btn btn-ghost danger" type="button" data-act="delete" aria-label="Apagar">${icon("trash", 18)}</button><button class="btn btn-primary" type="button" data-act="edit">${icon("edit", 18)}<span>Editar</span></button>` : ""}`
  });
  const on = (a, fn) => qs(`[data-act="${a}"]`, m)?.addEventListener("click", fn);
  on("out", () => { m.close(); openCheckoutForm([e]); });
  on("return", async () => {
    const b = qs('[data-act="return"]', m); setBusy(b, true, "Registrando…");
    const { error } = await supabase.rpc("return_equipment", { p_equipment_id: e.id, p_client_action_id: uid() });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    invalidateData(); notify(`Nº ${e.code} devolvido.`, "success"); m.close(); refreshView();
  });
  on("fix", async () => {
    const { data } = await supabase.from("maintenance_events").select("id").eq("equipment_id", e.id).eq("status", "open").limit(1);
    if (!data?.[0]) return notify("Nenhuma manutenção aberta encontrada.", "warning");
    m.close(); resolveMaintenance(data[0].id);
  });
  on("withdrawal", () => { m.close(); openWithdrawal(holder.id); });
  on("qr", () => openQr(e.qr_token, `Nº ${e.code}`, [schoolGroupLabel(e.school_group), e.model].filter(Boolean).join(" · ")));
  on("maint", () => openMaintenanceForm(e, m));
  on("delete", () => { m.close(); deleteDevice(e); });
  on("edit", () => openDeviceEdit(e, m, holder));
}
async function openDeviceEdit(e, m, holder) {
  const models = await knownModels();
  const statusOk = ["available", "unavailable"].includes(e.status);
  const devs = await loadDevices().catch(() => []);
  setSheet(m, { title: `Editar Nº ${esc(e.code)}`, subtitle: "Só número e modelo são obrigatórios.",
    body: `<form id="edit-form" class="form" autocomplete="off">
      <div class="grid-2"><label class="field"><span>Número *</span><input name="code" required maxlength="80" value="${esc(e.code)}"></label>
      <label class="field"><span>Modelo *</span><input name="model" required maxlength="120" value="${esc(e.model)}" list="model-list"></label></div>
      <datalist id="model-list">${models.map(x => `<option value="${esc(x.name)}">`).join("")}</datalist>
      <p class="hint" id="edit-inherit"></p>
      <label class="field"><span>Local</span><input name="location_text" maxlength="160" value="${esc(e.location_text || "")}" placeholder="Ex.: Sala 12" list="edit-locs"></label>
      ${EquipaSettings.locationDatalist("edit-locs", devs.map(d => d.location_text))}
      ${statusOk ? `<fieldset class="field"><legend>Situação</legend><div class="segmented"><label><input type="radio" name="status" value="available" ${e.status === "available" ? "checked" : ""}><span>Disponível</span></label><label><input type="radio" name="status" value="unavailable" ${e.status === "unavailable" ? "checked" : ""}><span>Indisponível</span></label></div></fieldset>` : `<p class="hint">${icon("info", 15)} ${e.status === "in_use" ? "Em uso: registre a devolução para mudar a situação." : "Em manutenção: conclua a manutenção para mudar a situação."}</p>`}
      <details class="more" open><summary>Detalhes do note</summary>${EquipaSettings.specInputs({ ...e, brand: e.brand === "Não informado" ? "" : e.brand, specs: e.specs || {} })}</details>
      <details class="more"><summary>Identificação e observações</summary><div class="grid-2">
        <label class="field"><span>Patrimônio</span><input name="asset_tag" maxlength="80" value="${esc(e.asset_tag || "")}"></label>
        <label class="field"><span>Nº de série</span><input name="serial_number" maxlength="120" value="${esc(e.serial_number || "")}"></label>
        <label class="field"><span>Nome (opcional)</span><input name="label" maxlength="120" value="${esc(e.label || "")}"></label></div>
        <label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="3">${esc(e.notes || "")}</textarea></label>
        <label class="check"><input name="is_active" type="checkbox" ${e.is_active !== false ? "checked" : ""}><span>Ativo no catálogo</span></label></details>
    </form>`,
    foot: `<button class="btn" type="button" id="edit-cancel">Cancelar</button><button class="btn btn-primary" type="submit" form="edit-form">Salvar</button>` });
  const form = qs("#edit-form", m);
  // Trocar o modelo oferece os dados herdados do novo modelo (sem apagar o que já foi digitado).
  form.elements.model.addEventListener("change", async () => {
    if (norm(form.elements.model.value) === norm(e.model)) { qs("#edit-inherit", m).textContent = ""; return; }
    const h = await EquipaSettings.inherit(form.elements.model.value);
    const sum = EquipaSettings.inheritSummary(h);
    qs("#edit-inherit", m).innerHTML = sum ? `${icon("layers", 14)} Este modelo tem: ${esc(sum)} <button type="button" class="link" id="edit-apply">Usar estes dados</button>` : "";
    qs("#edit-apply", m)?.addEventListener("click", () => {
      for (const k of ["brand", "school_group", "operating_system", "processor", "ram_gb", "storage_gb"]) if (h[k]) form.elements[k].value = h[k];
      for (const [k, v] of Object.entries(h.specs || {})) if (form.elements[`spec_${k}`]) form.elements[`spec_${k}`].value = v;
      qs("#edit-inherit", m).textContent = "Dados do modelo aplicados. Confira e salve.";
    });
  });
  qs("#edit-cancel", m).addEventListener("click", () => paintDeviceSheet(m, e, holder));
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = new FormData(form), b = qs('.sheet-foot [type="submit"]', m);
    const sp = EquipaSettings.readSpecInputs(form);
    const payload = { code: clean(f.get("code")), model: clean(f.get("model")), location_text: clean(f.get("location_text")) || null,
      asset_tag: clean(f.get("asset_tag")) || null, serial_number: clean(f.get("serial_number")) || null, label: clean(f.get("label")) || null,
      notes: clean(f.get("notes")) || null, is_active: f.get("is_active") === "on", ...EquipaSettings.toEquipmentColumns(sp) };
    if (payload.specs) payload.specs = { ...(e.specs || {}), ...payload.specs };
    if (statusOk && f.get("status")) payload.status = f.get("status");
    if (!payload.code || !payload.model) return form.reportValidity();
    setBusy(b, true, "Salvando…");
    const { error } = await supabase.from("equipments").update(payload).eq("id", e.id);
    setBusy(b, false);
    if (error) return notify(/23505|duplicate/i.test(`${error.code} ${error.message}`) ? "Já existe outro equipamento com esse número, patrimônio ou série." : errText(error), "error");
    notify(`Nº ${payload.code} atualizado.`, "success"); invalidateData();
    const fresh = await getDevice(e.id).catch(() => ({ ...e, ...payload }));
    paintDeviceSheet(m, fresh, holder);
    if (state.view === "devices") renderDevices(viewGen);
  });
  form.elements.code.focus();
}
/** Edição em grupo: só os campos preenchidos são aplicados a todos. */
async function openBulkEdit(list) {
  if (!isAdmin() || !list.length) return;
  const models = await knownModels();
  const devs = await loadDevices().catch(() => []);
  const same = k => list.every(d => (d[k] || "") === (list[0][k] || "")) ? (list[0][k] || "") : "";
  const keep = "Manter como está";
  const m = openSheet({ size: "md", title: `Editar ${list.length} equipamento${list.length === 1 ? "" : "s"}`, subtitle: `Nº ${esc(list.slice(0, 6).map(d => d.code).join(", "))}${list.length > 6 ? "…" : ""}. Campos vazios não mudam.`,
    body: `<form id="bulk-form" class="form" autocomplete="off">
      <label class="field"><span>Modelo</span><input name="model" maxlength="120" list="bulk-models" value="${esc(same("model"))}" placeholder="${keep}"></label>
      <datalist id="bulk-models">${models.map(x => `<option value="${esc(x.name)}">`).join("")}</datalist>
      <label class="field"><span>Local</span><input name="location_text" maxlength="160" value="${esc(same("location_text"))}" placeholder="${keep}" list="bulk-locs"></label>
      ${EquipaSettings.locationDatalist("bulk-locs", devs.map(d => d.location_text))}
      <details class="more" open><summary>Detalhes dos notes</summary>${EquipaSettings.specInputs({}, { keepPlaceholder: keep })}</details>
      <details class="more"><summary>Renumerar em sequência</summary><p class="hint">Troca os números na ordem atual (${esc(list[0].code)} → …). Útil quando o lote foi cadastrado com o número errado.</p>
        <div class="grid-2"><label class="field"><span>Prefixo</span><input name="prefix" maxlength="30" placeholder="Opcional"></label><label class="field"><span>Começar em</span><input name="start" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8" placeholder="Ex.: 31"></label></div></details>
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="bulk-form">Aplicar a ${list.length}</button>` });
  const form = qs("#bulk-form", m);
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = new FormData(form), b = qs('.sheet-foot [type="submit"]', m);
    const sp = EquipaSettings.readSpecInputs(form, { onlyFilled: true });
    const specsPatch = sp.specs; delete sp.specs;
    const payload = EquipaSettings.toEquipmentColumns(sp);
    if (!sp.brand) delete payload.brand;
    for (const k of ["model", "location_text"]) { const v = clean(f.get(k)); if (v) payload[k] = v; }
    if (payload.model && !payload.school_group) { const g = guessGroup(payload.model) || models.find(x => norm(x.name) === norm(payload.model))?.group; if (g) payload.school_group = g; }
    const start = clean(f.get("start")), prefix = clean(f.get("prefix"));
    if (start && !/^\d{1,8}$/.test(start)) return notify("O número inicial deve conter só dígitos.", "warning");
    if (!Object.keys(payload).length && !specsPatch && !start) return notify("Preencha ao menos um campo para aplicar.", "warning");
    setBusy(b, true, "Aplicando…");
    try {
      const ids = list.map(d => d.id);
      if (Object.keys(payload).length) {
        for (let i = 0; i < ids.length; i += 100) { const { error } = await supabase.from("equipments").update(payload).in("id", ids.slice(i, i + 100)); if (error) throw error; }
      }
      // Campos personalizados: mescla com o que cada note já tem (não apaga os outros campos).
      if (specsPatch && EquipaSettings.hasSpecs()) {
        const inBatches = async (arr, fn) => { for (let i = 0; i < arr.length; i += 10) { const res = await Promise.all(arr.slice(i, i + 10).map(fn)); const bad = res.find(r => r.error); if (bad) throw bad.error; } };
        await inBatches(list, d => supabase.from("equipments").update({ specs: { ...(d.specs || {}), ...specsPatch } }).eq("id", d.id));
      }
      if (start) {
        const sorted = [...list].sort((a, c) => numSort(a.code, c.code));
        const codes = sorted.map((_, i) => prefix + String(Number(start) + i).padStart(start.length, "0"));
        const own = new Set(sorted.map(d => norm(d.code)));
        const { data: taken, error: te } = await supabase.rpc("equipa_existing_codes", { p_codes: codes });
        if (te) throw te;
        const clash = (taken || []).filter(c => !own.has(norm(c)));
        if (clash.length) throw new Error(`Os números ${clash.slice(0, 5).join(", ")} já pertencem a outros equipamentos.`);
        // Duas passagens evitam colisão temporária entre números do próprio grupo.
        const inBatches = async (arr, fn) => { for (let i = 0; i < arr.length; i += 10) { const res = await Promise.all(arr.slice(i, i + 10).map(fn)); const bad = res.find(r => r.error); if (bad) throw bad.error; } };
        await inBatches(sorted, d => supabase.from("equipments").update({ code: `__tmp_${d.id.slice(0, 8)}` }).eq("id", d.id));
        await inBatches(sorted.map((d, i) => [d, codes[i]]), ([d, code]) => supabase.from("equipments").update({ code }).eq("id", d.id));
      }
      notify(`${list.length} equipamento(s) atualizado(s).`, "success");
      m.close(); state.devices.selected.clear(); invalidateData(); if (state.view === "devices") renderDevices(viewGen);
    } catch (error) { notify(error.message && !error.code ? error.message : errText(error), "error"); }
    finally { setBusy(b, false); }
  });
}
async function deleteDevice(e) {
  if (!isAdmin()) return;
  const ok = await confirmAction({ title: `Apagar Nº ${e.code}?`, message: "Se nunca foi usado, o cadastro é excluído. Se já tem histórico, ele sai do inventário e o histórico fica guardado. Retiradas e manutenções abertas precisam ser encerradas antes.", confirmText: "Apagar", danger: true });
  if (!ok) return;
  const { data, error } = await supabase.rpc("remove_equipment", { p_equipment_id: e.id });
  if (error) return notify(errText(error), "error");
  notify(data?.mode === "deleted" ? `Nº ${e.code} excluído.` : `Nº ${e.code} saiu do inventário; histórico preservado.`, "success");
  invalidateData(); refreshView();
}
function openMaintenanceForm(e, parent) {
  const m = openSheet({ size: "sm", title: `Manutenção · Nº ${esc(e.code)}`, subtitle: "O equipamento fica indisponível até a conclusão.",
    body: `<form id="mt-form" class="form"><label class="field"><span>O que aconteceu? *</span><input name="title" required maxlength="160" placeholder="Ex.: tela quebrada, não liga"></label><label class="field"><span>Observações</span><textarea name="notes" maxlength="1200" rows="3"></textarea></label></form>`,
    foot: `<button class="btn" type="button" data-close>Cancelar</button><button class="btn btn-primary" type="submit" form="mt-form">Enviar para manutenção</button>` });
  qs("#mt-form", m).addEventListener("submit", async ev => {
    ev.preventDefault(); const f = new FormData(ev.currentTarget), b = qs('.sheet-foot [type="submit"]', m); setBusy(b, true, "Enviando…");
    const { error } = await supabase.rpc("open_maintenance", { p_equipment_id: e.id, p_title: clean(f.get("title")), p_notes: clean(f.get("notes")) || null, p_client_action_id: uid() });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    notify(`Nº ${e.code} em manutenção.`, "success"); m.close(); parent?.close?.(); invalidateData(); refreshView();
  });
}
async function openQr(token, title, subtitle = "") {
  try { await ensureQRCodeLib(); } catch (error) { return notify(error.message, "error"); }
  const m = openSheet({ size: "sm", className: "printable", title: esc(title), subtitle: esc(subtitle), body: `<div class="qr-box"><div id="qr-code"></div><small>${esc(qrUrl(token))}</small></div>`,
    foot: `<button class="btn" type="button" id="qr-copy">Copiar link</button><button class="btn btn-primary" type="button" id="qr-print">Imprimir</button>` });
  new window.QRCode(qs("#qr-code", m), { text: qrUrl(token), width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
  qs("#qr-copy", m).addEventListener("click", async () => { try { await navigator.clipboard.writeText(qrUrl(token)); notify("Link copiado.", "success"); } catch { notify("Não foi possível copiar.", "warning"); } });
  qs("#qr-print", m).addEventListener("click", () => window.print());
}

/* ===================== Manutenção ===================== */
async function renderMaintenance(gen) {
  const s = state.maint;
  qs("#view").innerHTML = `<div class="toolbar"><label class="search">${icon("search", 18)}<input id="mt-q" type="search" value="${esc(s.q)}" placeholder="Número ou problema" autocomplete="off"></label></div>
    <div class="chips">${[["open", "Abertas"], ["resolved", "Resolvidas"], ["", "Todas"]].map(([v, l]) => `<button type="button" class="chip ${s.status === v ? "on" : ""}" data-m="${v}">${l}</button>`).join("")}</div><div id="mt-list">${loadingState()}</div>`;
  qsa("[data-m]").forEach(b => b.addEventListener("click", () => { s.status = b.dataset.m; renderMaintenance(++viewGen); }));
  let q = supabase.from("maintenance_events").select("id,equipment_id,title,notes,resolution,status,opened_at,closed_at,equipments(code,label,brand,model)").order("opened_at", { ascending: false }).limit(300);
  if (s.status) q = q.eq("status", s.status);
  const { data, error } = await q;
  if (!alive(gen)) return;
  if (error) { qs("#mt-list").innerHTML = emptyState("Erro ao carregar.", errText(error), "warn"); return; }
  setTitle("Manutenção", `${(data || []).filter(x => x.status === "open").length} aberta(s)`);
  const paint = () => {
    const rows = smartFilter(data || [], s.q, x => [x.title, x.notes, x.resolution, x.equipments?.code, x.equipments?.model]);
    qs("#mt-list").innerHTML = rows.length ? `<section class="card"><div class="rows">${rows.map(x => `<div class="row"><span class="row-ic s-${x.status === "open" ? "maintenance" : "available"}">${icon("tool", 16)}</span><span class="row-main"><b>Nº ${esc(x.equipments?.code || "?")} · ${esc(x.title)}</b><small>${esc(x.equipments?.model || "")} · aberta ${esc(dt(x.opened_at))}${x.resolution ? ` · ${esc(x.resolution)}` : ""}</small></span>${x.status === "open" ? `<button class="btn btn-sm btn-primary" type="button" data-fix="${x.id}">Concluir</button>` : pill("resolved")}</div>`).join("")}</div></section>` : emptyState(s.status === "open" ? "Nenhuma manutenção aberta" : "Nada encontrado.", "Abra um equipamento e escolha Manutenção.", "tool");
    qsa("[data-fix]").forEach(b => b.addEventListener("click", () => resolveMaintenance(Number(b.dataset.fix))));
  };
  let t; qs("#mt-q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { s.q = e.target.value; paint(); }, 160); });
  paint();
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

/* ===================== Relatórios ===================== */
async function renderReports(gen) {
  const end = new Date(), from = new Date(Date.now() - 30 * 86400000);
  qs("#view").innerHTML = `<div class="toolbar toolbar-wrap"><label class="field field-inline"><span>De</span><input id="rp-from" type="date" value="${from.toISOString().slice(0, 10)}"></label><label class="field field-inline"><span>Até</span><input id="rp-to" type="date" value="${end.toISOString().slice(0, 10)}"></label>
    <label class="field field-inline"><span>Turma</span><input id="rp-class" placeholder="Todas"></label><label class="field field-inline"><span>Tipo</span><select id="rp-group">${groupOptions("", "Todos")}</select></label>
    <div class="toolbar-end"><button class="btn" id="rp-export" type="button">${icon("download", 18)}<span>Exportar</span></button><button class="btn btn-primary" id="rp-go" type="button">${icon("refresh", 18)}<span>Atualizar</span></button></div></div><div id="rp-body">${loadingState("Calculando…")}</div>`;
  qs("#rp-go").addEventListener("click", () => loadReports(gen));
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
  const status = u => !u.is_active ? ["maintenance", "Pendente"] : u.is_banned ? ["overdue", "Banido"] : ["available", "Ativo"];
  host.innerHTML = users.length ? `<section class="card"><div class="rows">${users.map((u, i) => { const [k, l] = status(u); return `<button type="button" class="row" data-u="${i}"><span class="avatar avatar-sm">${esc((u.full_name || "U").trim().slice(0, 1).toUpperCase())}</span><span class="row-main"><b>${esc(u.full_name || "Usuário")}</b><small>${esc(roleLabel(u.role))} · ${esc(u.masked_email || "—")}</small></span>${pill(k, l)}${icon("chevron", 16)}</button>`; }).join("")}</div></section>
    ${pages > 1 ? `<div class="pager"><button class="btn btn-sm" id="us-prev" ${s.page === 0 ? "disabled" : ""}>Anterior</button><span>Página ${s.page + 1} de ${pages}</span><button class="btn btn-sm" id="us-next" ${s.page + 1 >= pages ? "disabled" : ""}>Próxima</button></div>` : ""}` : emptyState("Nenhum usuário encontrado.", "", "users");
  qsa("[data-u]").forEach(b => b.addEventListener("click", () => openUser(users[Number(b.dataset.u)], gen)));
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

/* ===================== Auditoria ===================== */
const auditActionLabel = v => ({ insert: "Criado", update: "Alterado", delete: "Excluído", approve: "Aprovado", restore: "Restaurado", remove: "Acesso removido", deactivate: "Desativado", ban: "Banido", unban: "Desbanido" })[v] || v || "Evento";
const auditEntityLabel = v => ({ equipments: "Equipamento", withdrawals: "Retirada", withdrawal_items: "Item de retirada", equipment_carts: "Carrinho", equipment_cart_items: "Item do carrinho", maintenance_events: "Manutenção", profiles: "Usuário", user_access: "Acesso de usuário", legal_acceptances: "Aceite legal" })[v] || v || "Registro";
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
  host.innerHTML = rows.length ? `<section class="card"><div class="rows">${rows.map((x, i) => `<button type="button" class="row" data-a="${i}"><span class="row-main"><b>${esc(x.actor_name || "Sistema")} · ${esc(auditActionLabel(x.action))}</b><small>${esc(auditEntityLabel(x.entity_type))}${x.summary ? ` · ${esc(x.summary)}` : ""}</small></span><span class="row-side">${esc(dt(x.occurred_at))}</span>${icon("chevron", 16)}</button>`).join("")}</div></section>
    ${pages > 1 ? `<div class="pager"><button class="btn btn-sm" id="au-prev" ${s.page === 0 ? "disabled" : ""}>Anterior</button><span>Página ${s.page + 1} de ${pages}</span><button class="btn btn-sm" id="au-next" ${s.page + 1 >= pages ? "disabled" : ""}>Próxima</button></div>` : ""}` : emptyState("Nenhum evento.", "Não há registros com esses filtros.", "shield");
  qsa("[data-a]", host).forEach(b => b.addEventListener("click", () => { const x = rows[Number(b.dataset.a)]; openSheet({ size: "md", title: `${esc(auditActionLabel(x.action))} · ${esc(auditEntityLabel(x.entity_type))}`, body: `<dl class="info"><div><dt>Responsável</dt><dd>${esc(x.actor_name || "Sistema")}</dd></div><div><dt>Data</dt><dd>${esc(dt(x.occurred_at))}</dd></div><div><dt>Registro</dt><dd>${esc(x.entity_id || "—")}</dd></div><div><dt>Resumo</dt><dd>${esc(x.summary || "—")}</dd></div></dl><details class="more"><summary>Detalhes técnicos</summary><pre class="code">${esc(JSON.stringify(x.details || {}, null, 2))}</pre></details>` }); }));
  qs("#au-prev")?.addEventListener("click", () => { s.page--; loadAudit(gen); });
  qs("#au-next")?.addEventListener("click", () => { s.page++; loadAudit(gen); });
}

/* ===================== QR lido / busca por câmera ===================== */
async function openScannedToken(token) {
  const scan = await scanPublic(token);
  if (!scan) return notify("QR inválido, inativo ou não reconhecido pelo Equipa.", "error");
  if (scan.kind === "cart") return openCart(token);
  const { data, error } = await supabase.from("equipments").select("id").eq("qr_token", token).maybeSingle();
  if (error || !data) return notify("Equipamento não encontrado.", "error");
  return openDevice(data.id);
}
/** Procura um equipamento pelo número, patrimônio ou série (texto lido pela câmera). */
async function findDevice(value) {
  const v = clean(value).replace(/[^\p{L}\p{N}._/-]/gu, "");
  if (!v) return [];
  const { data, error } = await supabase.from("equipments").select(DEVICE_FIELDS).or(`code.ilike.${v},asset_tag.ilike.${v},serial_number.ilike.${v}`).limit(5);
  if (error) throw error;
  return data || [];
}
async function handleScanAfterLogin() {
  const token = scanTokenFromUrl(); if (!token) return false;
  try { history.replaceState(null, "", location.pathname); } catch {}
  const scan = await scanPublic(token);
  if (!scan) { notify("QR inválido ou inativo.", "error"); return false; }
  await navigate(scan.kind === "cart" ? "carts" : "devices");
  await openScannedToken(token);
  return true;
}

/* ===================== Inicialização ===================== */
const STARTUP_TIMEOUT_MS = 12000;
let authGen = 0, authSub = null, bootRunning = false;
function withTimeout(promise, ms = STARTUP_TIMEOUT_MS, label = "operação") {
  let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`Tempo limite excedido ao carregar ${label}.`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
function showBootLoader() { shellMounted = false; app.innerHTML = `<main class="boot" aria-label="Carregando"><div class="boot-mark">${brandMark(56, "fast")}<span>Carregando…</span></div></main>`; }
function renderStartupError(error) {
  console.error("Equipa startup:", error); window.__equipaBootReady?.(); shellMounted = false;
  const code = /^[A-Z0-9_]{3,32}$/.test(String(error?.code || "")) ? error.code : "SEM_CODIGO";
  app.innerHTML = `<main class="boot boot-error"><div class="boot-card" role="alert"><strong>Não foi possível carregar o painel.</strong><span>${esc(errText(error))}</span><small class="hint">Código: ${esc(code)}. Envie à administração, sem compartilhar sua senha.</small><div class="row-wrap"><button class="btn btn-primary" id="startup-retry" type="button">Tentar novamente</button><button class="btn" id="startup-signout" type="button">Abrir login</button></div></div></main>`;
  qs("#startup-retry")?.addEventListener("click", () => boot());
  qs("#startup-signout")?.addEventListener("click", async () => { try { await withTimeout(supabase.auth.signOut(), 6000, "saída"); } catch {} state.session = null; state.profile = null; renderAuth(null); window.__equipaBootReady?.(); });
}
async function initSession(session) {
  if (!session?.user?.id) throw new Error("Sessão inválida. Entre novamente.");
  state.session = session;
  try {
    const { data, error } = await withTimeout(supabase.from("profiles").select("id,full_name,role,is_active,disabled_at,created_at,updated_at").eq("id", session.user.id).single(), STARTUP_TIMEOUT_MS, "perfil");
    if (error) throw error;
    state.profile = data;
  } catch (error) {
    if (error?.code === "PGRST116" || /0 rows|no rows/i.test(String(error?.message || ""))) throw Object.assign(new Error("Perfil escolar indisponível. Confirme se o cadastro existe e se as permissões do banco estão ativas."), { code: "EQUIPA_PROFILE_UNAVAILABLE" });
    throw error;
  }
  const { data: allowed, error: accessError } = await withTimeout(supabase.rpc("equipa_access_allowed"), STARTUP_TIMEOUT_MS, "permissões");
  if (accessError) throw accessError;
  if (allowed !== true) { renderPendingApproval(); window.__equipaBootReady?.(); return; }
  if (!(await ensureLegalAcceptance())) { window.__equipaBootReady?.(); return; }
  await EquipaSettings.load(true).catch(() => {});
  deviceCache = { at: 0, inactive: null, rows: null, pending: null }; modelCache.at = 0; noticeCache.at = 0;
  mountShell();
  const handled = await withTimeout(handleScanAfterLogin(), STARTUP_TIMEOUT_MS, "QR Code inicial").catch(() => false);
  if (!handled) await navigate("home");
  window.__equipaBootReady?.();
}
function installAuthListener() {
  authSub?.unsubscribe?.();
  const r = supabase.auth.onAuthStateChange((event, s) => {
    if (event === "TOKEN_REFRESHED" && s) { state.session = s; return; }
    if (event === "SIGNED_OUT" || !s) { authGen++; state.session = null; state.profile = null; qsa(".overlay").forEach(x => x.remove()); qs("#selbar")?.remove(); EquipaCamera.close?.(); renderAuth(null); window.__equipaBootReady?.(); return; }
    if (event === "SIGNED_IN" && (!state.session || state.session.user?.id !== s.user?.id)) {
      const g = ++authGen;
      setTimeout(() => { if (g !== authGen) return; showBootLoader(); initSession(s).catch(renderStartupError); }, 0);
    }
  });
  authSub = r?.data?.subscription || r?.subscription || null;
}
async function boot() {
  if (bootRunning) return; bootRunning = true;
  try {
    renderAuth(null); window.__equipaBootReady?.(); installAuthListener();
    const { data, error } = await withTimeout(supabase.auth.getSession(), 8000, "sessão");
    if (error) { notify("Não foi possível restaurar a sessão anterior. Entre novamente.", "warning"); return; }
    const session = data?.session || null;
    const urlEvent = supabase.auth.consumeUrlAuthEvent?.() || null;
    if (urlEvent?.type === "error") { renderAuth(null, urlEvent); return; }
    if (!session) { const t = scanTokenFromUrl(); if (t) { const s = await scanPublic(t).catch(() => null); if (s && qs("#auth-card")) renderAuth(s); } return; }
    if (urlEvent?.type === "recovery") { renderPasswordReset(session); return; }
    if (urlEvent?.type === "signup") notify("E-mail confirmado. Bem-vindo ao Equipa.", "success");
    showBootLoader(); await initSession(session);
  } catch (error) { renderStartupError(error); }
  finally { bootRunning = false; }
}
boot();
setInterval(() => { if (state.session && state.profile && document.visibilityState === "visible") void refreshNoticeDot(); }, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.session) void refreshNoticeDot(); });
