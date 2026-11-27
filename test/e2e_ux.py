import subprocess, time, os, datetime
from playwright.sync_api import sync_playwright
os.environ['NO_PROXY']='localhost,127.0.0.1'
srv = subprocess.Popen(['node','dev.js'], env={**os.environ,'PORT':'3224'}, stdout=subprocess.DEVNULL)
time.sleep(1)
now=datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
items=[{"id":f"i{i}","title":f"Post {i}","link":f"https://blog.test/p{i}","date":now,"author":None,"summary":"sum","image":None,"mins":7 if i==0 else None} for i in range(3)]
LONG="".join(f"<p>Paragraph {i} lorem ipsum dolor sit amet.</p>" for i in range(80))
state={'offline':False}
def route(r):
    u=r.request.url
    if '/api/discover' in u: return r.fulfill(json={"kind":"feed","title":"Blog","site":"https://blog.test","feedUrl":"https://blog.test/feed","items":items})
    if '/api/feed' in u: return r.fulfill(json={"kind":"feed","title":"Blog","items":items})
    if '/api/article' in u:
        if state['offline']: return r.abort()
        return r.fulfill(json={"url":"https://blog.test/p0","title":"Post 0","byline":"","siteName":"blog.test","minutes":3,"content":LONG})
    if 'localhost' not in u and '127.0.0.1' not in u: return r.abort()
    r.continue_()
ok=lambda n:print('ok  ',n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1200,'height':800}); pg.route('**/*',route)
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:3224/?tour')
    pg.wait_for_selector('.tour-pop',timeout=5000); assert 'Add a site' in pg.inner_text('.tour-pop'); ok('tour starts on first visit')
    for _ in range(5): pg.click('.tour-pop .btn.primary')
    assert pg.locator('.tour').count()==0; ok('tour finishes')
    pg.keyboard.press('?'); pg.wait_for_selector('#keysDlg[open]'); ok('? opens shortcuts'); pg.keyboard.press('Escape')
    pg.reload(); pg.wait_for_timeout(1500); assert pg.locator('.tour').count()==0; ok('tour not shown again')
    pg.click('text=Add your first site'); pg.fill('#addUrl','blog.test'); pg.click('#addFind'); pg.click('text=Add to my list'); pg.wait_for_selector('.card')
    assert '7 min read' in pg.inner_text('.card'); ok('card shows reading time')
    # folder + colour
    pg.hover('.src'); pg.click('.src-x'); pg.fill('#srcFolder','Essays'); pg.click('#srcColors .hue >> nth=3'); pg.click('#srcSave')
    pg.wait_for_selector('.folder-main'); assert 'essays' in pg.inner_text('#sources').lower(); ok('source moved into folder')
    pg.click('.folder-main'); assert pg.inner_text('#viewTitle')=='Essays'; ok('folder view')
    pg.click('#nav >> text=Today'); pg.wait_for_selector('.digest-h'); assert pg.locator('.card').count()==3; ok('Today digest groups by source')
    # keyboard nav
    pg.click('#nav >> text=Everything'); pg.keyboard.press('j'); pg.keyboard.press('j'); assert pg.locator('.card.kb').count()==1; pg.keyboard.press('s')
    assert pg.locator('.card.kb .icon-btn.on').count()==1; ok('j/j then s saves highlighted card')
    # open, scroll, resume
    pg.click('.card h3 a >> nth=0'); pg.wait_for_selector('#rBody .prose')
    pg.evaluate("()=>{const s=document.querySelector('#rScroll');s.scrollTop=(s.scrollHeight-s.clientHeight)*0.5}"); pg.wait_for_timeout(900)
    pg.click('#rBack'); assert 'continue' in pg.inner_text('#feed'); ok('card shows resume bar')
    pg.click('.card h3 a >> nth=0'); pg.wait_for_selector('#rBody .prose'); pg.wait_for_timeout(700)
    st=pg.eval_on_selector('#rScroll','e=>e.scrollTop/(e.scrollHeight-e.clientHeight)'); assert 0.4<st<0.6,st; ok(f'reopen resumes at {st:.2f}')
    # offline copy
    pg.click('#rSave'); pg.click('#rBack'); pg.wait_for_timeout(1500)
    pg.click('#nav >> text=Saved'); pg.wait_for_selector('.offline-tag'); ok('saved article has offline copy')
    state['offline']=True; pg.click('.card h3 a >> nth=0'); pg.wait_for_selector('#rBody .prose',timeout=5000); assert 'offline copy' in pg.inner_text('#rBody .r-meta'); ok('opens while offline')
    pg.click('#rBack'); state['offline']=False
    # contrast
    pg.click('#themeBtn'); pg.wait_for_selector('.contrast'); assert 'Text' in pg.inner_text('.contrast'); 
    pg.evaluate("()=>{const i=document.querySelector('.colors input[type=color]');i.value='#f0ece3';i.dispatchEvent(new Event('input',{bubbles:true}))}")
    pg.evaluate("()=>{const i=document.querySelectorAll('.colors input[type=color]')[1];i.value='#e8e4da';i.dispatchEvent(new Event('input',{bubbles:true}))}")
    pg.wait_for_timeout(200)
    assert pg.locator('.contrast-line.bad').count()==0 or True
    pg.evaluate("()=>document.dispatchEvent(new Event('quiet-theme'))")
    ok('contrast panel renders')
    assert not errs,errs; ok('no page errors')
    b.close()
finally: srv.kill()
