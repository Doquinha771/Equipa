/* Equipa — acesso: login, cadastro, recuperação de senha, aceite legal e conta pendente.
 * Telas fora do painel; usam só supabase.auth e as RPCs de aceite. */
"use strict";

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
