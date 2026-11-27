import subprocess, time, os, math
from playwright.sync_api import sync_playwright
os.environ['NO_PROXY']='localhost,127.0.0.1'
srv = subprocess.Popen(['node','dev.js'], env={**os.environ,'PORT':'3227'}, stdout=subprocess.DEVNULL)
time.sleep(1)
items=[{"id":"i0","title":"Post 0","link":"https://blog.test/p0","date":"2026-11-26T10:00:00Z","author":None,"summary":"s","image":None}]
ART="".join(f"<p>Paragraph {i}: the quick brown fox jumps over the lazy dog and keeps running through the quiet meadow until night.</p>" for i in range(12))
def route(r):
    u=r.request.url
    if '/api/discover' in u: return r.fulfill(json={"kind":"feed","title":"Blog","site":"https://blog.test","feedUrl":"https://blog.test/feed","items":items})
    if '/api/feed' in u: return r.fulfill(json={"kind":"feed","title":"Blog","items":items})
    if '/api/article' in u: return r.fulfill(json={"url":"https://blog.test/p0","title":"Post 0","byline":"","siteName":"blog.test","minutes":3,"content":ART})
    if 'localhost' not in u: return r.abort()
    r.continue_()
ok=lambda n:print('ok  ',n)
def stroke(pg,pts):
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for p in pts[1:]: pg.mouse.move(*p)
    pg.mouse.up()
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':1200,'height':800}); ctx.route('**/*',route)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:(errs.append(str(e)),print('PAGEERR',e)))
    pg.goto('http://localhost:3227/')
    pg.click('text=Add your first site'); pg.fill('#addUrl','blog.test'); pg.click('#addFind'); pg.click('text=Add to my list'); pg.wait_for_selector('.card')
    pg.click('.card h3 a'); pg.wait_for_selector('#rBody .prose p')
    pg.click('#rInk'); pg.wait_for_selector('.ink-bar:not([hidden])'); ok('ink toolbar opens')
    r=pg.eval_on_selector('#rBody .prose p:nth-child(2)','e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]}')
    cx,cy=r[0]+r[2]/2,r[1]+r[3]/2; rx,ry=r[2]/2+10,r[3]/2+8
    loop=[(cx+rx*math.cos(a/20*2*math.pi*1.05-1.6)+ (3 if a%2 else -3), cy+ry*math.sin(a/20*2*math.pi*1.05-1.6)) for a in range(0,21)]
    # wobbly loop
    stroke(pg,loop)
    pg.wait_for_selector('.ink-svg ellipse'); pg.wait_for_selector('.ink-note textarea:focus'); ok('loop snaps to an ellipse and opens a comment')
    pg.keyboard.type('why does the fox run?'); pg.keyboard.press('Escape')
    assert pg.eval_on_selector('.ink-note textarea','e=>e.value')=='why does the fox run?'; ok('comment typed')
    assert pg.is_visible('.ink-bar'); ok('Esc in a comment only leaves the box')
    # freehand pen (open line)
    pg.keyboard.press('p'); y=r[1]+r[3]+60
    stroke(pg,[(r[0]+10+i*8,y+(10 if i%2 else 0)) for i in range(25)])
    assert pg.locator('.ink-svg path[stroke-linecap="round"]:not([stroke-dasharray])').count()==1; ok('freehand pen stroke')
    # highlighter snaps straight
    pg.keyboard.press('h'); y2=y+50
    stroke(pg,[(r[0]+10+i*9,y2+(3 if i%2 else -3)) for i in range(25)])
    d=pg.eval_on_selector('.ink-svg path[opacity=".4"]','e=>e.getAttribute("d")'); assert d.count('L')==1 and 'Q' not in d,d; ok('highlighter snaps to a straight line')
    # undo / redo
    n=pg.locator('.ink-svg path:not([stroke-dasharray])').count(); pg.keyboard.press('Control+z'); assert pg.locator('.ink-svg path:not([stroke-dasharray])').count()==n-1; pg.keyboard.press('Control+Shift+z'); assert pg.locator('.ink-svg path:not([stroke-dasharray])').count()==n; ok('undo / redo')
    # eraser
    pg.keyboard.press('e'); stroke(pg,[(r[0]+10+i*8,y+5) for i in range(26)]); 
    assert pg.locator('.ink-svg path[stroke-linecap="round"]:not([stroke-dasharray])').count()==0; ok('eraser removes the stroke')
    # note tool
    pg.keyboard.press('n'); pg.mouse.click(r[0]+r[2]-60,y2+80); pg.wait_for_selector('.ink-note textarea:focus'); pg.keyboard.type('loose note'); pg.keyboard.press('Escape'); assert pg.locator('.ink-note').count()==2; ok('click-to-comment tool')
    pg.keyboard.press('Escape'); assert pg.is_hidden('.ink-bar'); ok('Esc leaves ink mode, reader stays'); assert pg.is_visible('#reader')
    # text still scrolls/selects in read mode and persistence
    pg.wait_for_timeout(300); pg.click('#rBack'); pg.reload(); pg.wait_for_timeout(600)
    pg.click('.card h3 a'); pg.wait_for_selector('.ink-svg ellipse'); assert pg.locator('.ink-note').count()==2; assert 'why does the fox run?' in pg.eval_on_selector_all('.ink-note textarea','e=>e.map(x=>x.value).join()'); ok('drawings and comments persist after reload')
    # re-flows with width change
    before=pg.eval_on_selector('.ink-svg ellipse','e=>+e.getAttribute("cx")')
    pg.set_viewport_size({'width':900,'height':800}); pg.wait_for_timeout(400)
    after=pg.eval_on_selector('.ink-svg ellipse','e=>+e.getAttribute("cx")'); assert abs(before-after)>5,(before,after); ok('marks follow the text when the window resizes')
    # highlights view lists comments
    pg.click('#rBack'); pg.click('#nav >> text=Highlights'); pg.wait_for_selector('.hl-group'); assert 'why does the fox run?' in pg.inner_text('#feed'); ok('comments listed under Highlights')
    # stylus: pen pointer auto-enters ink
    pg.set_viewport_size({'width':1100,'height':800}); pg.click('#nav >> text=Everything'); pg.click('.card h3 a'); pg.wait_for_selector('#rBody .prose p')
    cdp=ctx.new_cdp_session(pg); r=pg.eval_on_selector('#rBody .prose p:nth-child(5)','e=>{const r=e.getBoundingClientRect();return [r.left,r.top]}')
    cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':r[0]+5,'y':r[1]+60,'button':'left','buttons':1,'clickCount':1,'pointerType':'pen'})
    for i in range(1,12): cdp.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':r[0]+5+i*12,'y':r[1]+60+(i%3)*4,'button':'left','buttons':1,'pointerType':'pen'})
    cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':r[0]+140,'y':r[1]+60,'button':'left','pointerType':'pen','clickCount':1})
    pg.wait_for_timeout(300); assert pg.is_visible('.ink-bar') and pg.locator('.ink-svg path').count()>=1; ok('touching the page with a pen starts drawing')
    # tablet viewport
    t=b.new_context(viewport={'width':820,'height':1180},has_touch=True,is_mobile=True); t.route('**/*',route); tp=t.new_page(); tp.goto('http://localhost:3227/'); tp.wait_for_timeout(500)
    assert tp.evaluate("()=>document.body.classList.contains('touch')"); ok('touch device gets tablet mode')
    assert not errs,errs; ok('no page errors')
    b.close()
finally: srv.kill()
