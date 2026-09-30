from pathlib import Path
import re, ast
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text()
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
html=re.sub(r'<link rel="stylesheet" href="\./([^?]+)[^"]*">',lambda m:'<style>'+(root/m[1]).read_text()+'</style>',html)
for name in ('config','boot-guard','supabase','app','inventory-021'):
 html=re.sub(r'<script defer src="\./assets/js/'+name+r'\.js[^"]*"></script>',lambda m:'<script>'+(root/'assets/js'/f'{name}.js').read_text().replace('</script>','<\\/script>')+'</script>',html)
source=(root/'tests/compact-unified-smoke.py').read_text()
setup=ast.literal_eval("'''"+source.split("setup='''",1)[1].split("'''",1)[0]+"'''")
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,args=['--no-sandbox'])
 for width in (320,390,768,1280):
  p=b.new_page(viewport={'width':width,'height':844},timezone_id='America/Sao_Paulo');errors=[]
  p.on('pageerror',lambda e:errors.append(str(e)));p.route('**/*.supabase.co/**',lambda r:r.abort())
  p.set_content(html,wait_until='domcontentloaded');p.locator('#login-form').wait_for()
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('login overflow',width)
  if width==390:p.screenshot(path=str(root/'tests/mobile-login.png'),full_page=True)
  p.evaluate(setup)
  p.locator('.ops-stat').first.wait_for()
  for view in ('dashboard','equipment','withdrawals','history','carts','maintenance','reports','admin','audit'):
   p.evaluate('(v)=>navigate(v)',view);p.wait_for_timeout(80)
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('overflow',width,view)
   if width<=820:
    assert p.locator('.mobile-app-heading').is_visible()
    assert p.locator('.mobile-tabbar').is_visible()
   if width==390 and view in ('dashboard','equipment','withdrawals'):
    p.screenshot(path=str(root/f'tests/mobile-{view}.png'),full_page=True)
  if width<=820:
   p.locator('#mobile-more').click();p.locator('#mobile-sheet-theme').click()
   assert p.evaluate('document.documentElement.dataset.theme')=='dark'
   p.locator('#mobile-more-close').click()
   p.evaluate('navigate("dashboard")')
   assert p.locator('.mobile-home-hero').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(25, 36, 48)'
  p.evaluate('makeModal(`<h2>Teste</h2><input aria-label="Teste"><button>Salvar</button>`)')
  p.wait_for_timeout(80)
  assert p.evaluate('document.activeElement.classList.contains("modal")')
  assert p.evaluate('document.body.classList.contains("dialog-open")')
  p.keyboard.press('Tab');p.keyboard.press('Shift+Tab')
  assert p.evaluate('document.activeElement.closest(".modal")!==null')
  p.keyboard.press('Escape');p.wait_for_timeout(50)
  assert p.locator('.modal-backdrop').count()==0
  assert not p.evaluate('document.body.classList.contains("dialog-open")')
  assert not errors,errors
  print('PASS',width,'9 views, login, theme, overflow, modal keyboard lifecycle')
  p.close()
 b.close()
