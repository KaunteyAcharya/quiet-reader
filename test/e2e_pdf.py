import subprocess, time, os, re
from playwright.sync_api import sync_playwright
os.environ['NO_PROXY']='localhost,127.0.0.1'
srv = subprocess.Popen(['node','dev.js'], env={**os.environ,'PORT':'3231'}, stdout=subprocess.DEVNULL)
time.sleep(1)
SMALL=open('/tmp/small.pdf','rb').read()
items=[{"id":"i0","title":"Post 0","link":"https://blog.test/p0","date":"2026-11-26T10:00:00Z","author":None,"summary":"s","image":None}]
ART='<p>Read the <a href="https://files.test/paper.pdf">attached paper</a> too.</p>'+"<p>filler</p>"*5
hits={'proxy':0,'direct':0}
def rng(r,data,cors):
    h=r.request.headers.get('range'); base={'accept-ranges':'bytes','content-type':'application/pdf'}
    if cors: base.update({'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range, Accept-Ranges, Content-Length','access-control-allow-headers':'Range'})
    if r.request.method=='OPTIONS': return r.fulfill(status=204,headers=base)
    m=re.match(r'bytes=(\d+)-(\d*)',h or '')
    if m:
        a=int(m.group(1)); b=min(int(m.group(2) or len(data)-1),len(data)-1)
        return r.fulfill(status=206,headers={**base,'content-range':f'bytes {a}-{b}/{len(data)}'},body=data[a:b+1])
    return r.fulfill(status=200,headers=base,body=data)
def route(r):
    u=r.request.url
    if '/api/discover' in u or '/api/feed' in u: return r.fulfill(json={"kind":"feed","title":"Blog","site":"https://blog.test","feedUrl":"https://blog.test/feed","items":items})
    if '/api/article' in u: return r.fulfill(json={"url":"https://blog.test/p0","title":"Post 0","byline":"","siteName":"blog.test","minutes":3,"content":ART})
    if '/api/pdf' in u: hits['proxy']+=1; return rng(r,SMALL,False)
    if 'files.test' in u: hits['direct']+=1; return rng(r,SMALL,True)
    if 'nocors.test' in u: return r.abort()   # the browser blocks it (no CORS) -> Quiet falls back to its server
    if 'localhost' not in u: return r.abort()
    r.continue_()
ok=lambda n:print('ok  ',n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':1200,'height':800}); ctx.route('**/*',route)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:(errs.append(str(e)),print('PAGEERR',e))); pg.on('console',lambda m: print('CONSOLE',m.text) if m.type=='error' and 'CORS' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:3231/'); pg.click('#nav >> text=Books'); pg.wait_for_selector('.books-head')
    pg.set_input_files('input[type=file]','/tmp/book300.pdf'); pg.wait_for_selector('.book .book-title'); 
    assert 'A Long Book' in pg.inner_text('.book'); assert '300 pages' in pg.inner_text('.book'); ok('adds a 300-page PDF to Books')
    pg.wait_for_selector('.cover.has img',timeout=5000); ok('cover thumbnail made from page 1')
    pg.click('.book-open'); pg.wait_for_selector('#pdfr:not([hidden]) .pdf-page canvas',timeout=15000)
    assert pg.input_value('#pPage')=='1' and '300' in pg.inner_text('#pTotal'); ok('opens in the viewer')
    pg.wait_for_selector('.textLayer span',timeout=8000); ok('text layer present')
    n=pg.locator('.pdf-page canvas').count(); assert 0<n<=8,n; ok(f'only {n} of 300 pages are drawn')
    pg.fill('#pPage','120'); pg.press('#pPage','Enter'); pg.wait_for_timeout(900)
    assert pg.input_value('#pPage')=='120'; n=pg.locator('.pdf-page canvas').count(); assert n<=8,n
    assert pg.locator('.pdf-page[data-i="119"] canvas').count()==1; ok('jump to page 120 renders it; memory stays small')
    pg.click('#pZoomIn'); assert pg.inner_text('#pZoomLbl')!='100%'; pg.click('#pFit'); ok('zoom in / fit')
    # search
    pg.keyboard.press('/'); pg.wait_for_selector('.pdf-side input[type=search]'); pg.fill('.pdf-side input[type=search]','needle'); pg.press('.pdf-side input[type=search]','Enter')
    pg.wait_for_selector('.find-hit',timeout=20000); assert 'p. 42' in pg.inner_text('.find-hit'); pg.click('.find-hit'); pg.wait_for_timeout(700); assert pg.input_value('#pPage')=='42'; ok('search finds text on page 42 and jumps there')
    # contents
    pg.click('.pdf-tabs >> text=Contents'); pg.wait_for_selector('.toc-item'); pg.click('.toc-item >> text=Chapter 5'); pg.wait_for_timeout(700); assert pg.input_value('#pPage')=='41'; ok('contents jump to chapter')
    # highlight
    pg.wait_for_selector('.pdf-page[data-i="40"] .textLayer span')
    pg.evaluate("""()=>{const sp=[...document.querySelectorAll('.pdf-page[data-i="40"] .textLayer span')].find(s=>s.textContent.includes('Line 3'));const r=document.createRange();r.selectNodeContents(sp);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'))}""")
    pg.wait_for_selector('.pdf-hlbar:not([hidden])'); pg.click('.pdf-hlbar >> text=Highlight'); pg.wait_for_selector('.pdf-hl'); ok('select text -> highlight drawn')
    pg.click('.pdf-tabs >> text=Highlights'); assert 'Line 3' in pg.inner_text('.mark-item'); ok('listed in the side panel')
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); assert pg.is_hidden('#pdfr'); ok('Esc closes the viewer')
    pg.click('#nav >> text=Highlights'); pg.wait_for_selector('.hl-group'); assert 'Line 3' in pg.inner_text('#feed') and 'A Long Book' in pg.inner_text('#feed'); ok('PDF highlight appears under Highlights')
    pg.click('.hl-group h3 a'); pg.wait_for_selector('#pdfr:not([hidden])'); pg.wait_for_timeout(900); assert pg.input_value('#pPage') in ('41','42'),pg.input_value('#pPage'); ok('opening it from Highlights jumps to the page')
    pg.keyboard.press('Escape')
    # resume
    pg.click('#nav >> text=Books'); assert 'Continue at page' in pg.inner_text('.book'); pg.click('.book-open'); pg.wait_for_selector('.pdf-page canvas'); pg.wait_for_timeout(800)
    assert pg.input_value('#pPage') in ('41','42','40'),pg.input_value('#pPage'); ok('reopening resumes where you stopped')
    pg.keyboard.press('Escape')
    # link PDF, direct
    pg.fill('.books-link input','https://files.test/paper.pdf'); pg.click('.books-link button'); pg.wait_for_selector('#pdfr:not([hidden]) .pdf-page canvas',timeout=15000)
    assert '5' in pg.inner_text('#pTotal') and hits['direct']>0 and hits['proxy']==0; ok('opens a PDF link directly when the site allows it')
    assert pg.is_visible('#pKeep'); pg.click('#pKeep'); pg.wait_for_function("()=>document.querySelector('#pKeep').hidden",timeout=8000); ok('"Keep a copy" saves it on this device')
    pg.keyboard.press('Escape')
    # link PDF, blocked by CORS -> proxy
    pg.fill('.books-link input','https://nocors.test/p.pdf'); pg.click('.books-link button'); pg.wait_for_selector('#pdfr:not([hidden]) .pdf-page canvas',timeout=15000)
    assert hits['proxy']>0; ok('falls back to Quiet\'s server when the site blocks direct access')
    pg.keyboard.press('Escape')
    # article link to a PDF opens the viewer, not the split view
    pg.click('#nav >> text=Everything'); pg.click('text=Add your first site'); pg.fill('#addUrl','blog.test'); pg.click('#addFind'); pg.click('text=Add to my list'); pg.wait_for_selector('.card'); pg.click('.card h3 a'); pg.wait_for_selector('#rBody .prose a'); pg.click('#rBody .prose a'); pg.wait_for_selector('#pdfr:not([hidden]) .pdf-page canvas',timeout=15000)
    assert pg.is_hidden('#rPane2'); ok('a PDF link inside an article opens in the PDF viewer')
    pg.keyboard.press('Escape'); pg.click('#rBack')
    # writing counter
    pg.click('#writeBtn'); pg.wait_for_selector('#wText'); pg.type('#wText','i am kauntey'); pg.click('#wStats'); 
    assert pg.inner_text('#statsBody .st-card strong >> nth=0')=='3',pg.inner_text('#statsBody .st-card strong >> nth=0'); pg.click('#statsDlg .icon-btn')
    pg.click('#wText'); pg.keyboard.press('Control+a'); pg.keyboard.press('Backspace'); pg.click('#wStats'); assert pg.inner_text('#statsBody .st-card strong >> nth=0')=='0'; ok('erasing text lowers the written-today count')
    pg.click('#statsDlg .icon-btn')
    assert not errs,errs; ok('no page errors')
    b.close()
finally: srv.kill()
