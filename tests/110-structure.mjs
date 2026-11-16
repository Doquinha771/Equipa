// Estrutura dos módulos: nada duplicado, toda tela tem desenho, todo ícone existe, temas completos.
import assert from 'node:assert/strict';
import { ORDER, js, read } from './_modules.mjs';
const sources = Object.fromEntries(ORDER.map(n => [n, js(n)]));
const all = Object.values(sources).join('\n');

// 1) Nenhuma função ou constante global definida em dois módulos (scripts clássicos dividem o escopo global).
const defs = {};
for (const [n, s] of Object.entries(sources)) for (const m of s.matchAll(/^(?:async )?function (\w+)|^(?:const|let) (\w+)\s*=/gm)) (defs[m[1] || m[2]] ||= []).push(n);
const dup = Object.entries(defs).filter(([, v]) => v.length > 1);
assert(!dup.length, `Definido em mais de um módulo: ${dup.map(([k, v]) => `${k} (${v.join(', ')})`).join('; ')}`);

// 2) Toda tela do menu tem função de desenho registrada em navigate().
const views = [...sources['core/shell'].matchAll(/^\s+(\w+): \{ label:/gm)].map(m => m[1]);
const map = sources['core/shell'].match(/const render = \{([^}]+)\}/)[1];
for (const v of views) assert(new RegExp(`\\b${v}: [\\w.]+`).test(map), `Tela sem desenho em navigate(): ${v}`);
assert(views.includes('settings') && /settings: \{ label: "Configurações"/.test(sources['core/shell']), 'Configurações deve estar no menu de gestão');
assert(!/reservations: \{ label/.test(sources['core/shell']), 'Reservas não voltam ao menu');

// 3) Todo ícone usado existe.
const iconsBlock = sources['core/ui'].match(/const ICONS = \{([\s\S]*?)\n\};/)[1];
const have = new Set([...iconsBlock.matchAll(/^\s+"?([\w-]+)"?:/gm)].map(m => m[1]));
const used = new Set([...all.matchAll(/icon\("([\w-]+)"/g)].map(m => m[1]));
const missing = [...used].filter(i => !have.has(i));
assert(!missing.length, `Ícones usados e não definidos: ${missing.join(', ')}`);

// 4) Tema escuro define todas as cores do claro (nada fica claro por engano).
const css = read('assets/css/equipa.css');
const vars = block => new Set([...block.matchAll(/--([\w-]+):/g)].map(m => m[1]));
const light = vars(css.match(/:root \{([\s\S]*?)\n\}/)[1]), dark = vars(css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1]);
const layout = new Set(['r-sm', 'r', 'r-lg', 'ease', 'side', 'tabbar', 'font', 'mono', 'nb-glow']);
const gaps = [...light].filter(v => !dark.has(v) && !layout.has(v));
assert(!gaps.length, `Tema escuro sem: ${gaps.join(', ')}`);

// 5) Sem diálogos nativos do navegador (mensagens ficam na interface).
assert(!/\b(alert|prompt)\(|window\.confirm\(/.test(all), 'Use confirmAction/notify em vez de alert/confirm/prompt');
console.log(`Estrutura: ${ORDER.length} módulos, ${views.length} telas, ${used.size} ícones — aprovada.`);
