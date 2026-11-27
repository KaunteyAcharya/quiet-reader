import json, subprocess, time, os, sys
from playwright.sync_api import sync_playwright
os.environ['NO_PROXY']='localhost,127.0.0.1'
srv = subprocess.Popen(['node','dev.js'], env={**os.environ,'PORT':'3222'}, stdout=subprocess.DEVNULL)
time.sleep(1)
items=[{"id":f"i{i}","title":f"Post {i}","link":f"https://blog.test/p{i}","date":"2026-11-26T10:00:00Z","author":None,"summary":"sum","image":None} for i in range(3)]
ART="<p>Reading should feel like a quiet room. Pick the colours.</p><p>Second paragraph says Pick the colours again here.</p>"
def route(r):
    u=r.request.url
    if '/api/discover' in u: return r.fulfill(json={"kind":"feed","title":"Blog","site":"https://blog.test","feedUrl":"https://blog.test/feed","items":items})
    if '/api/feed' in u: return r.fulfill(json={"kind":"feed","title":"Blog","items":items})
    if '/api/article' in u: return r.fulfill(json={"url":"https://blog.test/p0","title":"Post 0","byline":"","siteName":"blog.test","minutes":1,"content":ART})
    if 'localhost' not in u and '127.0.0.1' not in u: return r.abort()
    r.continue_()
ok=lambda n:print('ok  ',n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1200,'height':800}); pg.route('**/*',route)
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:3222/')
    pg.click('text=Add your first site'); pg.fill('#addUrl','blog.test'); pg.click('#addFind'); pg.click('text=Add to my list')
    pg.wait_for_selector('.card'); ok('add source')
    pg.click('.card h3 a'); pg.wait_for_selector('#rBody .prose p'); ok('open article')
    # select first paragraph text via JS range then fire selectionchange
    pg.evaluate("""()=>{const p=document.querySelector('#rBody .prose p:nth-child(2)');const t=p.firstChild;const r=document.createRange();const i=t.nodeValue.indexOf('Pick the colours again');r.setStart(t,i);r.setEnd(t,i+'Pick the colours again'.length);const s=getSelection();s.removeAllRanges();s.addRange(r);}""")
    pg.wait_for_selector('#selBar:not([hidden])'); pg.click('#selBar [data-a=hl]')
    marks=pg.eval_on_selector_all('mark.hl','e=>e.map(x=>x.textContent)'); assert marks==['Pick the colours again'],marks; ok('highlight lands on the selected occurrence (not the first duplicate)')
    pg.click('#rBack'); pg.reload(); pg.wait_for_timeout(800); pg.click('.card h3 a'); pg.wait_for_selector('mark.hl')
    assert pg.eval_on_selector('mark.hl','e=>e.textContent')=='Pick the colours again'; ok('highlight persists and re-applies')
    pg.click('mark.hl'); pg.fill('#noteText','my note'); pg.click('#noteSave')
    assert pg.eval_on_selector('mark.hl','e=>e.classList.contains("has-note")'); ok('note saved')
    pg.click('#rBack'); pg.click('text=Highlights'); pg.wait_for_selector('.hl-note'); assert 'my note' in pg.inner_text('.hl-note'); ok('highlights view')
    # reading time
    pg.context.add_init_script("(()=>{const raw=localStorage.getItem('quiet:v1');if(raw&&!sessionStorage.seeded){const s=JSON.parse(raw);const d=new Date();d.setDate(d.getDate()-1);s.readTime[d.toLocaleDateString('en-CA')]=4440;localStorage.setItem('quiet:v1',JSON.stringify(s));sessionStorage.seeded='1'}})()")
    pg.reload(); pg.click('nav >> text=Everything'); pg.wait_for_selector('.stat'); t=pg.inner_text('.stat strong'); assert t=='Yesterday you read for 1 hr 14 mins.',t; ok('reading time: '+t)
    # writer
    pg.click('#writeBtn'); pg.fill('#wText','First sentence here. Second one is mine. Third follows.')
    pg.click('#wSF'); pg.evaluate("()=>{const t=document.querySelector('#wText');t.focus();t.setSelectionRange(30,30);document.dispatchEvent(new Event('selectionchange'))}")
    m=pg.inner_text('#wMirror mark'); assert m=='Second one is mine.',repr(m); ok('sentence focus -> '+m)
    pg.click('#wTW'); pg.fill('#wText','\n'.join(f'line {i}' for i in range(120))); pg.keyboard.press('Control+End'); pg.keyboard.type('x')
    st=pg.eval_on_selector('#wEditPane','e=>e.scrollTop'); assert st>500,st; ok(f'typewriter scrolls caret into view (scrollTop={st})')
    h1=pg.eval_on_selector('#wText','e=>e.getBoundingClientRect().height'); assert h1>1000; ok('textarea auto-sizes')
    assert not errs,errs; ok('no page errors')
    b.close()
finally:
    srv.kill()
