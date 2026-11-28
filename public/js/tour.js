import { $, el } from './ui.js';

export const SHORTCUTS = [
  ['Move through the list', 'j / k'],
  ['Open the highlighted article', 'Enter'],
  ['Save · mark read', 's · m'],
  ['Next / previous article (reader)', 'j / k'],
  ['Close split view, then the reader', 'Esc'],
  ['Command palette', 'Ctrl/⌘ K  or  /'],
  ['Add a site', 'a'],
  ['Write something', 'w'],
  ['Change how it looks', 't'],
  ['Today’s digest · Books', 'd · b'],
  ['In a PDF: zoom · contents · search · page', '+ − · C · / · G'],
  ['This help', '?'],
];

export function showKeys() {
  const d = $('#keysDlg');
  $('#keysList').replaceChildren(...SHORTCUTS.map(([a, k]) => el('div', { class: 'key-row' }, el('span', { text: a }), el('kbd', { text: k }))));
  if (!d.open) d.showModal();
}

// A small spotlight tour. steps: [{ sel, title, text }]
export function startTour(steps, onEnd) {
  let i = 0;
  const hole = el('div', { class: 'tour-hole' });
  const pop = el('div', { class: 'tour-pop', role: 'dialog', 'aria-live': 'polite' });
  const root = el('div', { class: 'tour' }, hole, pop);
  document.body.append(root);

  const end = () => { root.remove(); removeEventListener('resize', place); document.removeEventListener('keydown', onKey, true); onEnd?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
  };
  const next = () => (++i >= steps.length ? end() : place());

  function place() {
    const s = steps[i];
    const t = s.sel && document.querySelector(s.sel);
    const r = t?.getBoundingClientRect();
    const shown = r && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
    pop.replaceChildren(
      el('strong', { text: s.title }),
      el('p', { text: s.text }),
      el('div', { class: 'tour-foot' },
        el('span', { class: 'muted', text: `${i + 1} / ${steps.length}` }),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn ghost small', onclick: end }, 'Skip'),
        el('button', { class: 'btn primary small', onclick: next }, i === steps.length - 1 ? 'Done' : 'Next')));
    if (shown) {
      hole.style.cssText = `display:block;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
      const w = 300;
      const left = Math.min(Math.max(12, r.right + 16 > innerWidth - w ? r.left : r.right + 16), innerWidth - w - 12);
      const below = r.right + 16 > innerWidth - w;
      pop.style.cssText = `left:${left}px;top:${Math.min(Math.max(12, below ? r.bottom + 14 : r.top), innerHeight - 190)}px`;
    } else {
      hole.style.cssText = 'display:none';
      pop.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%)';
    }
    pop.querySelector('.btn.primary').focus();
  }
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  place();
  return end;
}
