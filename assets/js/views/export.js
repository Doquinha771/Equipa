/* Equipa — planilha de localização.
 * Cada equipamento com número, modelo, carrinho, onde está agora, com quem e prazo. */
"use strict";

/* ---------- Planilha: cada PC, número, carrinho e onde está ---------- */
async function exportEquipments() {
  notify("Montando a planilha…", "info");
  try {
    await ensureXLSXLib();
    const all = [];
    for (let from = 0; from < 10000; from += 1000) { const { data, error } = await supabase.from("equipments").select("id,code,asset_tag,brand,model,school_group,serial_number,location_text,status,is_active,updated_at,operating_system,processor,ram_gb,storage_gb" + (EquipaSettings.hasSpecs() ? ",specs" : "")).order("code").range(from, from + 999); if (error) throw error; all.push(...(data || [])); if ((data || []).length < 1000) break; }
    const [map, ws, occ] = await Promise.all([loadCartMap(true).catch(() => ({ byCode: new Map() })), loadOpenWithdrawals().catch(() => []), isAdmin() ? [] : loadOccupancy().catch(() => [])]);
    const holder = new Map();
    ws.forEach(w => w.pending.forEach(i => holder.set(String(i.equipment_id), { name: w.custodian_name || w.responsible_name || "", turma: w.class_name || "", destino: w.destination || "", due: w.due_at, late: w.overdue, id: w.id })));
    occ.forEach(o => { if (!holder.has(String(o.equipment_id))) holder.set(String(o.equipment_id), { name: o.holder_name || "" }); });
    const rows = all.sort((a, b) => numSort(a.code, b.code)).map(e => {
      const c = map.byCode.get(norm(e.code)), h = e.status === "in_use" ? holder.get(String(e.id)) : null;
      const where = !e.is_active ? "Fora do catálogo" : h ? `Com ${h.name || "não identificado"}${h.destino ? ` — ${h.destino}` : ""}` : e.status === "maintenance" ? "Manutenção" : c ? `${cartName(c)}${c.location_text ? ` (${c.location_text})` : ""}` : e.location_text || "Não informado";
      return { "Número": e.code, "Modelo": e.model, "Tipo": schoolGroupLabel(e.school_group), "Carrinho": cartName(c), "Onde está agora": where, "Situação": !e.is_active ? "Desativado" : h?.late ? "Atrasado" : statusLabel(e.status), "Com quem": h?.name || "", "Turma/setor": h?.turma || "", "Destino": h?.destino || "", "Devolver até": h?.due ? dt(h.due) : "", "Comanda": h?.id ? `#${h.id}` : "", "Local cadastrado": e.location_text || "", "Nº de série": e.serial_number || "", "Patrimônio": e.asset_tag || "", "Marca": e.brand && e.brand !== "Não informado" ? e.brand : "", "Plataforma": e.operating_system || "", "Processador": e.processor || "", "RAM (GB)": e.ram_gb || "", "Armazenamento (GB)": e.storage_gb || "", ...Object.fromEntries(EquipaSettings.fields().map(f => [f.label, e.specs?.[f.key] || ""])), "Atualizado": dt(e.updated_at) };
    });
    const sheet = window.XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0] || {});
    sheet["!cols"] = headers.map(h => ({ wch: Math.min(34, Math.max(9, h.length + 2, ...rows.slice(0, 200).map(r => String(r[h] ?? "").length + 1))) }));
    if (headers.length) sheet["!autofilter"] = { ref: `A1:${window.XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` };
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, sheet, "Equipamentos");
    // Uma aba por carrinho, para impressão rápida na conferência.
    (map.carts || []).forEach(c => { const set = new Set((c.equipment_codes || []).map(norm)); const part = rows.filter(r => set.has(norm(r["Número"]))).map(r => ({ "Número": r["Número"], "Modelo": r["Modelo"], "Situação": r["Situação"], "Com quem": r["Com quem"], "Conferido": "" })); if (part.length) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(part), safeFileName(cartName(c)).slice(0, 31)); });
    window.XLSX.writeFile(wb, `Equipa-onde-esta-cada-PC-${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify(`Planilha com ${rows.length} equipamentos baixada.`, "success");
  } catch (error) { notify(errText(error), "error"); }
}
