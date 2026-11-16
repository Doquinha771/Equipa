/* Equipa — dados compartilhados entre telas (com cache curto).
 * Equipamentos, retiradas abertas e modelos conhecidos; invalidateData() limpa tudo após gravar. */
"use strict";

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
/* Cache de 15 s: Início, Equipamentos, Controle e Carrinhos pedem as mesmas retiradas em sequência. */
let openWithdrawalsCache = { at: 0, rows: null, pending: null };
async function loadOpenWithdrawals({ force = false } = {}) {
  if (!force && openWithdrawalsCache.rows && Date.now() - openWithdrawalsCache.at < 15000) return openWithdrawalsCache.rows;
  if (!force && openWithdrawalsCache.pending) return openWithdrawalsCache.pending;
  openWithdrawalsCache.pending = fetchOpenWithdrawals().then(rows => { openWithdrawalsCache = { at: Date.now(), rows, pending: null }; return rows; }).finally(() => { openWithdrawalsCache.pending = null; });
  return openWithdrawalsCache.pending;
}
async function fetchOpenWithdrawals() {
  const { data, error } = await supabase.from("withdrawals").select("id,requested_by,class_name,destination,responsible_name,student_name,withdrawn_at,due_at,recorded_by_name,custodian_name,custodian_role,custody_mode,checkout_purpose,withdrawal_items(equipment_id,returned_at,equipments(code,model))").eq("status", "open").order("withdrawn_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data || []).map(w => ({ ...w, pending: (w.withdrawal_items || []).filter(i => !i.returned_at), overdue: !!(w.due_at && new Date(w.due_at).getTime() < Date.now()) }));
}
function invalidateData() { deviceCache.at = 0; openWithdrawalsCache.at = 0; modelCache.at = 0; noticeCache.at = 0; void refreshNoticeDot(); }
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
