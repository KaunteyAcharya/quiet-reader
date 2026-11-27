import { state, saveLink, unsave } from './store.js';
import { applyTheme } from './themes.js';
import { el } from './ui.js';

applyTheme(state.theme);
const q = new URLSearchParams(location.search);
let u = q.get('u') || '';
if (!/^https?:\/\//i.test(u)) u = (/https?:\/\/[^\s]+/i.exec(q.get('x') || q.get('u') || '') || [''])[0]; // Android shares put the link in "text"
const out = document.getElementById('out');

function done(...kids) {
  out.replaceChildren(...kids);
}

try {
  const { key, existed } = saveLink(u, q.get('t') || '');
  const item = state.saved[key];
  const undo = el('button', { class: 'btn small', onclick: () => { unsave(key); done(el('h1', { text: 'Removed' }), actions()); } }, 'Undo');
  const actions = () => el('div', { class: 'row' }, el('a', { class: 'btn small primary', href: '/' }, 'Open Quiet'), el('button', { class: 'btn small ghost', onclick: () => window.close() }, 'Close'));
  done(
    el('div', { class: 'save-tick', text: existed ? '•' : '✓' }),
    el('h1', { text: existed ? 'Already in your Saved' : 'Saved for later' }),
    el('p', { class: 'muted ellipsis', text: item.title }),
    el('div', { class: 'row' }, existed ? null : undo, actions()));
  if (!existed) setTimeout(() => { try { window.close(); } catch {} }, 2200);
} catch {
  done(el('h1', { text: "Couldn't save that" }), el('p', { class: 'muted', text: 'Quiet can only save web links (http or https).' }), el('a', { class: 'btn small primary', href: '/' }, 'Open Quiet'));
}
