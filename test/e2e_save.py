import subprocess, time, os
from playwright.sync_api import sync_playwright
os.environ['NO_PROXY']='localhost,127.0.0.1'
srv=subprocess.Popen(['node','dev.js'],env={**os.environ,'PORT':'3224'},stdout=subprocess.DEVNULL);time.sleep(1)
items=[{"id":f"i{i}","title":f"Essay number {i}","link":f"https://dario.test/e{i}","date":None,"author":None,"summary":"","image":None} for i in range(4)]
def route(r):
    u=r.request.url
    if '/api/discover' in u: return r.fulfill(json={"kind":"page","title":"Dario","site":"https://dario.test/","feedUrl":"https://dario.test/","items":items})
    if '/api/feed' in u: return r.fulfill(json={"kind":"page","title":"Dario","items":items})
    if 'localhost' not in u: return r.abort()
    r.continue_()
ok=lambda n:print('ok  ',n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    ctx=b.new_context(); ctx.route('**/*',route)
    errs=[]
    a=ctx.new_page(); a.on('pageerror',lambda e:errs.append(str(e)))
    a.goto('http://localhost:3224/'); a.click('text=Saved'); a.wait_for_selector('text=Nothing saved yet')
    # popup in another window: save
    s=ctx.new_page(); s.goto('http://localhost:3224/save.html?u='+'https%3A%2F%2Fdario.test%2F'+'&t=Dario%20Amodei')
    s.wait_for_selector('text=Follow Dario'); s.click('text=Save this link for later'); s.wait_for_selector('text=Saved for later')
    a.wait_for_selector('.card h3 a >> text=Dario Amodei', timeout=5000); ok('open tab picks up a link saved from another window (no reload)')
    cnt=a.inner_text('nav >> text=Saved'); ok('saved counter: '+cnt.replace('\n',' '))
    # stale tab must not clobber on close
    a.reload(); a.click('text=Saved'); a.wait_for_selector('.card'); ok('saved link persists after reload')
    # follow flow
    s2=ctx.new_page(); s2.goto('http://localhost:3224/save.html?u=https%3A%2F%2Fdario.test%2Fessay&t=x')
    s2.wait_for_selector('button:has-text("Follow Dario")'); s2.click('button:has-text("Follow Dario")'); s2.wait_for_selector('text=Following')
    a.wait_for_selector('#sources >> text=Dario', timeout=5000); ok('followed site appears as a source in the open tab')
    a.click('#sources >> text=Dario'); a.wait_for_selector('text=Essay number 0'); ok('its posts are listed')
    a.close(); s.close(); s2.close()
    p2=ctx.new_page(); p2.goto('http://localhost:3224/'); p2.click('text=Saved'); p2.wait_for_selector('.card'); ok('nothing lost after closing stale windows')
    assert not errs, errs; ok('no page errors')
    b.close()
finally: srv.kill()
