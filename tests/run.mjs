// Executa todos os testes atuais: node tests/run.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = new URL('.', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'run.mjs').sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [new URL(f, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FALHOU'} ${f}${ok ? '' : `\n${(r.stderr || r.stdout).split('\n').slice(0, 8).join('\n')}`}`);
}
console.log(failed ? `\n${failed} de ${files.length} falharam.` : `\nTodos os ${files.length} testes passaram.`);
process.exit(failed ? 1 : 0);
