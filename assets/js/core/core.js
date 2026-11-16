/* Equipa — núcleo: cliente Supabase, tema, estado, mensagens de erro e QR.
 * Carregado antes de todas as telas; não desenha nada sozinho. */
"use strict";
/* Princípio do Equipa: cada tela responde a uma pergunta só.
 *   Início        → o que preciso fazer agora?
 *   Equipamentos  → onde está cada equipamento?
 *   Controle      → quem está com o quê; retirar e receber.
 *   Carrinhos     → o que está guardado em cada carrinho.
 *   Gestão        → manutenção, relatórios, usuários, auditoria e configurações.
 * As regras de negócio ficam no PostgreSQL (RPCs e RLS); o navegador só valida para ajudar. */

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
