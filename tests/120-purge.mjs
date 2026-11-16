// Exclusão de vez (migration 1.4): só pela RPC, travas do banco preservadas fora dela.
import assert from 'node:assert/strict';
import { read } from './_modules.mjs';
const dev = read('assets/js/views/devices.js');
const sql = read('supabase/migrations/20261116030000_equipa_1_4_purge_equipment.sql');

assert.match(dev, /rpc\("equipa_purge_equipment"/, 'Excluir deve usar equipa_purge_equipment');
assert.match(dev, /PGRST202|42883/, 'Sem a migration, cair no arquivamento antigo');
assert(!/from\("equipment(s|_units)"\)\.delete/.test(dev), 'Nada de DELETE direto pelo navegador');

assert.match(sql, /EQUIPA_ADMIN_REQUIRED/, 'Só administração');
assert.match(sql, /cardinality\(p_ids\) > 500/, 'Limite por chamada');
assert.match(sql, /'emprestado'/); assert.match(sql, /'manutenção aberta'/);
assert.match(sql, /set_config\('equipa\.allow_purge', 'on', true\)/, 'Liberação local da transação');
assert.match(sql, /raise exception 'EQUIPA_EQUIPMENT_DELETE_FORBIDDEN'/, 'Trava continua fora da função');
assert.match(sql, /insert into public\.audit_events/, 'Exclusão auditada');
assert.match(sql, /revoke all on function public\.equipa_purge_equipment\(uuid\[\]\) from public, anon/);
console.log('Exclusão de vez: RPC, travas e auditoria — aprovada.');
