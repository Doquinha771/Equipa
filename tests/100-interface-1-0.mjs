// Equipa 1.0 — verificação estática da nova interface (sem rede, sem banco).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('index.html'), app = read('assets/js/app.js'), ui = read('assets/js/ui.js');
const reg = read('assets/js/register.js'), cam = read('assets/js/camera.js'), ctl = read('assets/js/control.js'), css = read('assets/css/equipa.css');

// Ordem de carregamento: base → módulos → app (que inicia o boot).
const order = ['config', 'boot-guard', 'supabase', 'ui', 'legal', 'register', 'camera', 'control', 'app'].map(n => html.indexOf(`assets/js/${n}.js`));
assert(order.every(i => i > 0) && order.every((v, i) => !i || v > order[i - 1]), 'Scripts fora de ordem no index.html');
assert(!existsSync(new URL('../assets/js/inventory-021.js', import.meta.url)), 'Módulo antigo de cadastro ainda presente');

// CSP: OCR roda no navegador (worker em blob + WebAssembly), só a partir do jsDelivr.
assert.match(html, /script-src 'self' 'wasm-unsafe-eval' https:\/\/cdn\.jsdelivr\.net/);
assert.match(html, /worker-src 'self' blob: https:\/\/cdn\.jsdelivr\.net/);
assert(!html.replace("'wasm-unsafe-eval'", '').includes("'unsafe-eval'"), 'Não liberar unsafe-eval');
for (const url of cam.match(/https:\/\/[^"]+/g)) assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@?[^@]+@\d+\.\d+\.\d+/, `Versão fixa exigida: ${url}`);

// Cadastro: lote transacional, verificação de duplicados, sem gravação direta em equipments.
assert.match(reg, /equipa_register_equipment_batch/);
assert.match(reg, /equipa_existing_codes/);
assert.match(reg, /const MAX = 200/);
assert(!/from\("equipments"\)\.insert/.test(reg + app + ctl), 'Cadastro deve passar pela RPC transacional');

// Edição (individual e em grupo) e renumeração sem colisão.
assert.match(app, /openDeviceEdit/); assert.match(app, /openBulkEdit/); assert.match(app, /__tmp_/);

// Câmera: modos de trabalho, QR, código de barras, OCR local e busca por número/série/patrimônio.
for (const m of ['find', 'checkout', 'return', 'audit', 'register']) assert(cam.includes(`${m}: { label`), `Modo de câmera ausente: ${m}`);
for (const f of ['BarcodeDetector', 'jsQR', 'Tesseract', 'parseText', 'saveOne', 'findDevice', 'inDb']) assert.match(cam + app, new RegExp(f));
assert(!/fetch\(|supabase\.storage/.test(cam), 'A câmera não envia imagens ao servidor');

// Controle: comandas por urgência, visão Minhas/Todas, balcão, conferência e planilha.
for (const rpc of ['equipa_checkout_with_context', 'equipa_return_items', 'return_equipment', 'equipa_school_activity', 'cart_scan_catalog_v2', 'save_equipment_cart_v2']) assert.match(ctl, new RegExp(rpc));
for (const f of ['col("late"', 'col("soon"', 'data-scope', 'openCounter', 'openCartAudit', 'Onde está agora', 'exportEquipments']) assert(ctl.includes(f), `Controle sem ${f}`);

// RPCs administrativas continuam paginadas/agregadas no servidor.
for (const rpc of ['equipa_admin_user_page', 'equipa_admin_audit_page', 'equipa_admin_report_dashboard', 'remove_equipment']) assert.match(app, new RegExp(rpc));

// Tema claro/escuro, celular e componentes do painel.
assert.match(css, /:root\[data-theme="dark"\]/); assert.match(css, /@media \(max-width: 860px\)/);
for (const c of ['.tabbar', '.board', '.ticket', '.slot', '.cart-panel', '.counter-grid', '.cam-modes']) assert(css.includes(c), `CSS sem ${c}`);
assert.match(ui, /function openSheet/);
console.log('Interface 1.0: verificação estática aprovada.');
