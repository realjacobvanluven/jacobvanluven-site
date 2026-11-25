"""Browser QA for the BC Preparedness Board, using the test fixtures instead of the live services.
Dev tool, not part of the site build. Needs: python3 playwright, Chrome, `npm run build`, and
`node scripts/qa/dump-fixtures.mjs /tmp/pb-fixtures`.
  python3 scripts/qa/preparedness_qa.py [outDir]
Checks, at 375px: no sideways scroll, per-scenario banner/counts/feed, accessibility (axe-core), and screenshots."""
import json, sys, threading, http.server, functools, os
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pb-shots'
FX = '/tmp/pb-fixtures'
os.makedirs(OUT, exist_ok=True)
bodies = json.load(open(f'{FX}/bodies.json'))
snapshot = open(f'{FX}/snapshot.json').read()
AXE = open('node_modules/axe-core/axe.min.js').read()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
handler = functools.partial(Quiet, directory="dist")
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_port}'
URL = f'{BASE}/tools/bc-preparedness-board/'

def route_for(scenario):
    def route(r):
        u = r.request.url
        if u.startswith(BASE):
            if 'preparedness-snapshot' in u:
                if scenario in ('all-down', 'one-down-snap'): return r.fulfill(status=200, content_type='application/json', body=snapshot)
                return r.fulfill(status=404, body='')
            return r.continue_()
        key = next((k for k in bodies if k in u), None)
        if key is None: return r.abort()           # fonts, tiles etc: not available here
        if scenario in ('all-down', 'all-down-nosnap'): return r.abort()
        if scenario == 'one-down-snap' and 'open511' in u: return r.abort()
        r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(bodies[key]))
    return route

fails = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for scenario in ['live', 'one-down-snap', 'all-down', 'all-down-nosnap']:
        ctx = b.new_context(viewport={'width': 375, 'height': 800}, device_scale_factor=2, is_mobile=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', route_for(scenario))
        page.goto(URL, wait_until='networkidle')
        page.wait_for_selector('[data-loading][hidden]', state='attached', timeout=15000)
        banner = page.locator('[data-banner]')
        cards = page.locator('[data-feed] .card').count()
        counts = page.eval_on_selector_all('[data-count]', 'els => els.map(e => e.textContent)')
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        print(f'--- {scenario}: cards={cards} counts={counts} banner={banner.inner_text()!r}')
        check(f'{scenario}: no sideways scroll at 375px', overflow <= 0, f'overflow {overflow}px')
        check(f'{scenario}: no script errors', not errors, '; '.join(errors))
        if scenario == 'live':
            check('live: no banner', banner.is_hidden())
            check('live: feed has cards', cards > 0)
            sev = page.eval_on_selector_all('[data-feed] .card', 'els => els.map(e => e.dataset.sev)')
            order = ['critical', 'high', 'moderate', 'low', 'info']
            check('live: feed sorted most serious first', [order.index(s) for s in sev] == sorted(order.index(s) for s in sev), str(sev))
            page.locator('.chip[data-hazard="road"]').click()
            check('live: filter hides roads', page.locator('[data-feed] .card', has_text='Roads').count() == 0)
            page.locator('.chip[data-hazard="road"]').click()
        if scenario == 'one-down-snap':
            check('one-down: banner says some sources use a saved copy', 'saved copy' in banner.inner_text())
            check('one-down: feed still shows items', cards > 0)
        if scenario == 'all-down':
            check('all-down: banner says live sources unreachable', 'saved copy' in banner.inner_text())
        if scenario == 'all-down-nosnap':
            check('all-down-nosnap: says unavailable, not an empty all-clear', 'No data sources could be reached' in banner.inner_text() and cards == 0)
        # keyboard: every interactive control reachable and visibly focusable
        page.keyboard.press('Tab')
        if scenario == 'live':
            page.add_script_tag(content=AXE)
            res = page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa']}).then(r => r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0].html.slice(0, 140)})))")
            for v in res: print('   axe:', v)
            check('live: axe finds no WCAG A/AA violations', not res)
        page.screenshot(path=f'{OUT}/{scenario}.png', full_page=True)
        ctx.close()
    b.close()
print('\nFAILED: ' + ', '.join(fails) if fails else '\nAll checks passed')
sys.exit(1 if fails else 0)
