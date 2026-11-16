// Keepalive do Supabase (GitHub Actions): só usa a chave pública e nunca segredos.
import assert from 'node:assert/strict';
import { read } from './_modules.mjs';
const w = read('.github/workflows/equipa-supabase-keepalive.yml');
assert.match(w, /cron: '23 10 \*\/5 \* \*'/, 'Agenda do keepalive mudou');
assert.match(w, /equipa_keepalive/, 'Keepalive deve chamar a RPC equipa_keepalive');
assert.match(w, /supabasePublishableKey/, 'Keepalive deve ler a chave pública do config.js');
assert(!/sb_secret_|service_role/i.test(w), 'Keepalive não pode usar segredo administrativo');
console.log('Keepalive: aprovado.');
