// Loads pdf.js on demand (about 1.7 MB, only when someone opens a PDF) and opens documents
// without ever holding a whole big book in memory: pages are read from the file in slices.
let libP;
export function loadLib() {
  return (libP ||= (async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/pdfjs/pdf_viewer.css';
    document.head.append(css);
    const m = await import('/vendor/pdfjs/pdf.min.mjs');
    m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    return m;
  })().catch((e) => { libP = null; throw e; }));
}
const BASE = {
  wasmUrl: '/vendor/pdfjs/wasm/',
  standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
  disableAutoFetch: true,
  disableStream: true,
  rangeChunkSize: 1 << 20,
  isEvalSupported: false,
  enableXfa: false,
};
function withPassword(task) {
  task.onPassword = (cb, reason) => {
    const p = prompt(reason === 2 ? 'That password was wrong. Try again:' : 'This PDF is password protected. Enter the password:');
    if (p) cb(p); else task.destroy();
  };
  return task;
}
export async function docFromBlob(blob) {
  const pdfjs = await loadLib();
  if (blob.size < 40 * 1024 * 1024) {
    return withPassword(pdfjs.getDocument({ ...BASE, data: new Uint8Array(await blob.arrayBuffer()) })).promise;
  }
  const initial = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  class BlobRange extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      blob.slice(begin, end).arrayBuffer().then((buf) => this.onDataRange(begin, new Uint8Array(buf)));
    }
  }
  return withPassword(pdfjs.getDocument({ ...BASE, range: new BlobRange(blob.size, initial), length: blob.size })).promise;
}
export async function docFromUrl(url, viaProxy) {
  const pdfjs = await loadLib();
  const task = withPassword(pdfjs.getDocument({ ...BASE, url: viaProxy ? '/api/pdf?url=' + encodeURIComponent(url) : url, withCredentials: false }));
  const timeout = new Promise((_, rej) => setTimeout(() => { task.destroy(); rej(new Error('timeout')); }, 20000));
  return Promise.race([task.promise, timeout]);
}
export async function makeCover(doc, width = 220) {
  const page = await doc.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / v1.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, background: '#ffffff' }).promise;
  return new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.72));
}
export function isPdfUrl(href) {
  try {
    const u = new URL(href);
    return /\.pdf$/i.test(u.pathname) || (/(^|\.)arxiv\.org$/i.test(u.hostname) && u.pathname.startsWith('/pdf/'));
  } catch {
    return false;
  }
}
