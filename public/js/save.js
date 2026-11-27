import { state, saveLink, unsave, addSource } from './store.js';
import { applyTheme } from './themes.js';
import { el } from './ui.js';

applyTheme(state.theme);
const q = new URLSearchParams(location.search);
let u = q.get('u') || '';
if (!/^https?:\/\//i.test(u)) u = (/https?:\/\/[^\s]+/i.exec(q.get('x') || q.get('u') || '') || [''])[0]; // Android shares put the link in "text"
const out = document.getElementById('out');
const done = (...kids) => out.replaceChildren(...kids);
const closeSoon = (ms = 1600) => setTimeout(() => { try { window.close(); } catch {} }, ms);
const actions = () => el('div', { class: 'row' }, el('a', { class: 'btn small primary', href: '/' }, 'Open Quiet'), el('button', { class: 'btn small ghost', onclick: () => window.close() }, 'Close'));

let host = '';
let link = '';
try {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) throw 0;
  host = x.hostname.replace(/^www\./, '');
  link = x.href;
} catch {
  done(el('h1', { text: "Couldn't save that" }), el('p', { class: 'muted', text: 'Quiet can only save web links (http or https).' }), actions());
  throw new Error('bad url');
}
const title = (q.get('t') || '').trim();

let found = null; // discovered feed/page for "Follow site"
let followBtn;
const saveBtn = el('button', { class: 'btn primary wide', autofocus: true, onclick: doSave }, 'Save this link for later');
followBtn = el('button', { class: 'btn wide', disabled: true, onclick: doFollow }, 'Checking for new-post updates…');
const note = el('p', { class: 'muted small-t', text: '' });

done(
  el('h1', { text: 'Save to Quiet' }),
  el('p', { class: 'muted ellipsis', title: link, text: title || host }),
  saveBtn,
  followBtn,
  note,
  actions());

fetch('/api/discover?url=' + encodeURIComponent(link))
  .then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error)))))
  .then((j) => {
    found = j;
    const dupe = state.sources.some((s) => s.url === j.feedUrl);
    followBtn.disabled = dupe;
    followBtn.textContent = dupe ? `Already following ${j.title || host}` : j.kind === 'feed' ? `Follow ${j.title || host} (${j.items.length} posts)` : `Follow ${host} — watch its page for new links`;
    if (!dupe) note.textContent = j.kind === 'feed' ? 'New posts from this site will appear in your feed.' : 'This site has no feed, so Quiet will watch its page.';
  })
  .catch(() => { followBtn.textContent = 'No feed found for this site'; });

function doSave() {
  try {
    const { key, existed } = saveLink(link, title);
    done(
      el('div', { class: 'save-tick', text: '✓' }),
      el('h1', { text: existed ? 'Already in your Saved' : 'Saved for later' }),
      el('p', { class: 'muted ellipsis', text: state.saved[key].title }),
      el('div', { class: 'row' }, existed ? null : el('button', { class: 'btn small', onclick: () => { unsave(key); done(el('h1', { text: 'Removed' }), actions()); } }, 'Undo'), actions()));
    closeSoon(2200);
  } catch {
    done(el('h1', { text: "Couldn't save that" }), actions());
  }
}

function doFollow() {
  if (!found) return;
  const { existed } = addSource(found);
  done(
    el('div', { class: 'save-tick', text: '✓' }),
    el('h1', { text: existed ? 'Already following' : 'Following' }),
    el('p', { class: 'muted', text: `${found.title || host} · ${found.items.length} posts added to your feed` }),
    actions());
  closeSoon(2200);
}
