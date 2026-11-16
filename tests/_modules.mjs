// Lista oficial dos módulos do navegador, na ordem em que o index.html os carrega.
// Os testes leem o código por aqui para não depender de caminhos espalhados.
import { readFileSync } from 'node:fs';

export const ORDER = [
  'config', 'boot-guard', 'supabase',
  'core/ui', 'core/legal', 'core/core', 'core/data', 'core/auth', 'core/shell',
  'views/settings', 'tools/register', 'tools/labels', 'tools/camera',
  'views/home', 'views/devices', 'views/control', 'views/counter', 'views/returns', 'views/carts', 'views/export',
  'views/maintenance', 'views/reports', 'views/users', 'views/audit',
  'app'
];
export const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
export const js = name => read(`assets/js/${name}.js`);
export const readAll = names => names.map(js).join('\n');
/** Núcleo + telas gerais (o antigo app.js). */
export const APP = ['core/core', 'core/data', 'core/auth', 'core/shell', 'views/home', 'views/devices', 'views/maintenance', 'views/reports', 'views/users', 'views/audit', 'app'];
/** Operação: controle, balcão, devolução, carrinhos, planilha (o antigo control.js). */
export const CONTROL = ['views/control', 'views/counter', 'views/returns', 'views/carts', 'views/export'];
