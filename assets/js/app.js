/* Equipa — inicialização.
 * QR inicial, sessão e boot. Último script carregado. */
"use strict";

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
