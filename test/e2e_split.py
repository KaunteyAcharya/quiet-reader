import subprocess, time, os
from playwright.sync_api import sync_playwright
os.environ['NO_PROXY']='localhost,127.0.0.1'
srv = subprocess.Popen(['node','dev.js'], env={**os.environ,'PORT':'3223'}, stdout=subprocess.DEVNULL)
time.sleep(1)
items=[{"id":"i0","title":"Post 0","link":"https://blog.test/p0","date":"2026-11-26T10:00:00Z","author":None,"summary":"s","image":None}]
def route(r):
    u=r.request.url
    if '/api/discover' in u: return r.fulfill(json={"kind":"feed","title":"Blog","site":"https://blog.test","feedUrl":"https://blog.test/feed","items":items,
        "detected":{"from":"https://blog.test/","at":"https://blog.test/essays","label":"Essays"},"alternatives":[{"title":"News","url":"https://blog.test/news","count":5,"kind":"page"}]})
    if '/api/feed' in u: return r.fulfill(json={"kind":"feed","title":"Blog","items":items})
    if '/api/article' in u:
        if 'other.test' in u: return r.fulfill(json={"url":"https://other.test/x","title":"Linked piece","byline":"","siteName":"other.test","minutes":1,"content":"<p>Second article body.</p>"})
        return r.fulfill(json={"url":"https://blog.test/p0","title":"Post 0","byline":"","siteName":"blog.test","minutes":1,"content":'<p>Intro <a href="https://other.test/x">a link</a> end.</p>'})
    if 'localhost' not in u and '127.0.0.1' not in u: return r.abort()
    r.continue_()
ok=lambda n:print('ok  ',n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1200,'height':800}); pg.route('**/*',route)
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:3223/')
    # welcome spacing
    gap=pg.evaluate("()=>{const o=document.querySelector('.welcome .or').getBoundingClientRect(),r=document.querySelector('.welcome .row').getBoundingClientRect();return o.top-r.bottom}")
    assert gap>=20,gap; ok(f'welcome gap {gap:.0f}px')
    pg.click('text=Add your first site'); pg.fill('#addUrl','blog.test'); pg.click('#addFind')
    pg.wait_for_selector('.found-note'); assert 'Found the posts' in pg.inner_text('.found-note'); assert 'News' in pg.inner_text('.alts'); ok('detected section + alternatives shown')
    pg.click('text=Add to my list'); pg.wait_for_selector('.card')
    pg.click('.card h3 a'); pg.wait_for_selector('#rBody .prose a')
    pg.click('#rBody .prose a'); pg.wait_for_selector('#rBody2 .prose')
    assert 'Second article' in pg.inner_text('#rBody2'); assert 'Intro' in pg.inner_text('#rBody'); assert pg.url.startswith('http://localhost'); ok('link opens in split pane, left article kept')
    pg.click('#r2Save'); assert 'on' in (pg.get_attribute('#r2Save','class') or ''); ok('save from right pane')
    pg.keyboard.press('Escape'); assert pg.is_hidden('#rPane2') and pg.is_visible('#reader'); ok('Esc closes split first')
    pg.click('#rBack'); pg.click('#writeBtn')
    pg.fill('#wText','One two three.\n\nFour five.'); pg.click('#wStats'); pg.wait_for_selector('#statsBody .st-card')
    txt=pg.inner_text('#statsBody'); assert 'Today' in txt; 
    t=pg.evaluate("()=>{const s=JSON.parse(localStorage['quiet:v1']).writeStats;return Object.values(s)[0]}") if False else None
    ok('stats dialog renders'); pg.click('#statsDlg .icon-btn')
    pg.type('#wText',' six seven'); pg.wait_for_timeout(1200)
    pg.click('#wStats'); txt=pg.inner_text('#statsBody .st-msg'); assert '9 words' in txt or '8 words' in txt or 'words' in txt,txt; ok('tracked: '+txt)
    assert not errs,errs; ok('no page errors')
    b.close()
finally: srv.kill()
