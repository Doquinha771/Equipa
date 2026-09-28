from pathlib import Path
root=Path(__file__).resolve().parents[1]
w=(root/'.github/workflows/equipa-supabase-keepalive.yml').read_text(encoding='utf-8')
c=(root/'assets/js/config.js').read_text(encoding='utf-8')
assert "cron: '23 10 */5 * *'" in w
assert 'equipa_keepalive' in w
assert 'supabasePublishableKey' in w
assert 'sb_secret_' not in w
assert 'service_role' not in w.lower()
assert 'version: "0.3.4 Alpha"' in c
print('keepalive static checks: ok')
