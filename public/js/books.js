// The Books library: PDFs you add from your device (kept in this browser) or open from a link.
import { el } from './ui.js';
import { putFile, getFile, putCover, getCover, delBook, storageInfo, keepForever } from './bookdb.js';
import { loadLib, docFromBlob, makeCover, isPdfUrl } from './pdflib.js';
import { openBook, initPdf } from './pdfview.js';

export { isPdfUrl };
let ctx; // { state, save, toast, uid, onChange, openNote, deleteHighlight }
let urls = [];

export function initBooks(c) {
  ctx = c;
  c.state.books ||= [];
  initPdf(c);
}
const books = () => ctx.state.books;
export const byId = (id) => books().find((b) => b.id === id);
const mb = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB');
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function openById(id, opts) {
  const b = byId(id);
  if (b) openBook(b, opts);
}
export function openPdfUrl(url, title) {
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url); } catch { return ctx.toast('That doesn’t look like a web address'); }
  const id = 'u' + hash(u.href);
  let b = byId(id);
  if (!b) {
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname).replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
    b = { id, kind: 'link', url: u.href, title: title && title.length > 2 ? title : name || u.hostname, pages: 0, size: 0, added: Date.now(), pos: { p: 0, f: 0 } };
    books().push(b);
    ctx.save();
  }
  openBook(b);
}

export async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) { ctx.toast('Those aren’t PDF files'); return 0; }
  keepForever();
  let added = 0;
  for (const [n, f] of files.entries()) {
    if (books().some((b) => b.kind === 'file' && b.size === f.size && b.fname === f.name)) { ctx.toast(`“${f.name}” is already in Books`); continue; }
    if (files.length > 1) ctx.toast(`Adding ${n + 1} of ${files.length}…`);
    const id = ctx.uid();
    try {
      await putFile(id, f);
      const doc = await docFromBlob(f);
      let title = f.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
      try { const m = await doc.getMetadata(); const t = (m.info?.Title || '').trim(); if (t.length > 3 && !/^(untitled|microsoft word)/i.test(t)) title = t; } catch {}
      const cover = await makeCover(doc).catch(() => null);
      if (cover) await putCover(id, cover);
      books().push({ id, kind: 'file', fname: f.name, title, pages: doc.numPages, size: f.size, added: Date.now(), pos: { p: 0, f: 0 } });
      doc.destroy();
      ctx.save();
      added++;
    } catch (e) {
      await delBook(id);
      ctx.toast(e?.name === 'QuotaExceededError' ? 'Not enough storage space on this device for that file' : `Couldn’t read “${f.name}” — is it a valid PDF?`);
    }
  }
  ctx.onChange?.();
  return added;
}

async function removeBook(b) {
  const marks = ctx.state.highlights.filter((h) => h.pdf === b.id).length;
  if (!confirm(`Remove “${b.title}” from Books?${marks ? `\nIts ${marks} highlight${marks === 1 ? '' : 's'} will be removed too.` : ''}${b.kind === 'file' ? '\nThe file is deleted from this browser (your original copy is untouched).' : ''}`)) return;
  ctx.state.books = books().filter((x) => x.id !== b.id);
  ctx.state.highlights = ctx.state.highlights.filter((h) => h.pdf !== b.id);
  await delBook(b.id);
  ctx.save();
  ctx.onChange?.();
}

export function renderBooks(feed, sub) {
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  const list = books().slice().sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, onchange: async (e) => { await addFiles(e.target.files); e.target.value = ''; } });
  const linkIn = el('input', { type: 'url', placeholder: 'Or paste a link to a PDF…', 'aria-label': 'Link to a PDF', autocomplete: 'off' });
  const form = el('form', { class: 'books-link', onsubmit: (e) => { e.preventDefault(); if (linkIn.value.trim()) openPdfUrl(linkIn.value.trim()); } }, linkIn, el('button', { class: 'btn', type: 'submit' }, 'Open'));
  const foot = el('p', { class: 'muted books-foot' });
  storageInfo().then((s) => { if (s && s.quota) foot.textContent = `Books you add stay on this device (${mb(s.used)} used of about ${mb(s.quota)} available). Nothing is uploaded.`; });
  if (sub) sub.textContent = list.length ? `${list.length} book${list.length === 1 ? '' : 's'}` : 'Your PDFs and papers';
  const grid = el('div', { class: 'books-grid' }, ...list.map((b) => {
    const img = el('img', { alt: '', class: 'cover-img' });
    const cov = el('div', { class: 'cover' }, el('span', { class: 'cover-ph', text: (b.title || '?').slice(0, 2).toUpperCase() }), img);
    if (b.kind === 'file') getCover(b.id).then((blob) => { if (blob) { const u = URL.createObjectURL(blob); urls.push(u); img.src = u; cov.classList.add('has'); } }).catch(() => {});
    const pct = b.pages ? Math.round((((b.pos?.p || 0) + (b.pos?.f || 0)) / b.pages) * 100) : 0;
    return el('article', { class: 'book' },
      el('button', { class: 'book-open', onclick: () => openBook(b), 'aria-label': 'Open ' + b.title }, cov,
        el('strong', { class: 'book-title', text: b.title }),
        el('span', { class: 'muted book-meta', text: [b.kind === 'link' ? new URL(b.url).hostname : null, b.pages ? b.pages + ' pages' : null, b.size ? mb(b.size) : null].filter(Boolean).join(' · ') }),
        b.pages && (b.pos?.p || 0) > 0 ? el('span', { class: 'book-prog', title: `Page ${(b.pos.p || 0) + 1} of ${b.pages}` }, el('i', { style: `width:${pct}%` })) : null,
        b.pages && (b.pos?.p || 0) > 0 ? el('span', { class: 'muted book-meta', text: `Continue at page ${b.pos.p + 1}` }) : null),
      el('button', { class: 'icon-btn tiny book-x', title: 'Remove', 'aria-label': 'Remove ' + b.title, onclick: () => removeBook(b) }, '×'));
  }));
  feed.replaceChildren(
    el('div', { class: 'books-head' },
      el('button', { class: 'btn primary', onclick: () => fileInput.click() }, 'Add PDFs from this device'), form, fileInput),
    list.length ? grid : el('div', { class: 'empty' }, el('p', { text: 'Add a book, paper or report and read it here like everything else — with your theme, highlights, notes and where you stopped.' }), el('p', { class: 'muted', text: 'You can also drop PDF files anywhere on the page, or press O in the command palette.' })),
    foot);
}
