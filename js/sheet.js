// Sheet viewer: turns PDFs / photos into page images and handles auto-scroll.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs';
const LONG_EDGE = 2000; // px: sharp on iPad, and the size we send to Claude
export const MAX_PAGES = 20;

let pdfjsPromise = null;
function loadPdfJs() {
  pdfjsPromise ??= import(PDFJS).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  });
  return pdfjsPromise;
}

const toJpeg = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));

async function pdfToPages(file, onProgress) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  const n = Math.min(doc.numPages, MAX_PAGES);
  for (let i = 1; i <= n; i++) {
    onProgress?.(`Rendering page ${i} of ${n}…`);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = LONG_EDGE / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: c2d, viewport: vp, canvas }).promise;
    pages.push(await toJpeg(canvas));
    canvas.width = canvas.height = 0; // free memory on iPad
  }
  return { pages, truncated: doc.numPages > MAX_PAGES };
}

async function imageToPage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toJpeg(canvas);
    canvas.width = canvas.height = 0;
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Accepts one PDF, or one or more images (pages in the order picked).
export async function filesToPages(files, onProgress) {
  const list = [...files];
  const pdf = list.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdf) return pdfToPages(pdf, onProgress);
  const pages = [];
  for (const [i, f] of list.slice(0, MAX_PAGES).entries()) {
    onProgress?.(`Loading image ${i + 1} of ${list.length}…`);
    pages.push(await imageToPage(f));
  }
  return { pages, truncated: list.length > MAX_PAGES };
}

export class SheetView {
  constructor(scrollEl, pagesEl) {
    this.scrollEl = scrollEl;
    this.pagesEl = pagesEl;
    this.urls = [];
    this.imgs = [];
    this.pos = 0;
    this.touching = false;
    this.holdUntil = 0;
    scrollEl.addEventListener('pointerdown', () => { this.touching = true; }, { passive: true });
    const release = () => { this.touching = false; this.holdUntil = performance.now() + 2500; };
    scrollEl.addEventListener('pointerup', release, { passive: true });
    scrollEl.addEventListener('pointercancel', release, { passive: true });
    scrollEl.addEventListener('wheel', () => { this.holdUntil = performance.now() + 2500; }, { passive: true });
  }

  show(blobs) {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.pagesEl.innerHTML = '';
    this.urls = blobs.map((b) => URL.createObjectURL(b));
    this.imgs = this.urls.map((u, i) => {
      const img = document.createElement('img');
      img.src = u;
      img.alt = `Page ${i + 1}`;
      img.className = 'page';
      img.draggable = false;
      this.pagesEl.appendChild(img);
      return img;
    });
    this.scrollEl.scrollTop = 0;
    this.pos = 0;
  }

  get hasPages() { return this.imgs.length > 0; }

  setZoom(z) {
    this.pagesEl.style.width = `${Math.round(z * 100)}%`;
  }

  // Content y of a spot on a page (page is 1-based, frac 0..1 of its height).
  pageY(page, frac) {
    const img = this.imgs[Math.max(0, Math.min(this.imgs.length - 1, page - 1))];
    if (!img) return 0;
    return img.offsetTop + frac * img.offsetHeight;
  }

  userBusy() {
    return this.touching || performance.now() < this.holdUntil;
  }

  // Steady mode: move by pxPerSec * dt, picking up wherever the user left it.
  stepSteady(pxPerSec, dt) {
    const el = this.scrollEl;
    if (this.userBusy()) { this.pos = el.scrollTop; return; }
    if (Math.abs(this.pos - el.scrollTop) > 3) this.pos = el.scrollTop;
    this.pos = Math.min(el.scrollHeight - el.clientHeight, this.pos + pxPerSec * dt);
    el.scrollTop = this.pos;
  }

  // Follow mode: ease toward a target y (content coordinates).
  stepFollow(targetY) {
    const el = this.scrollEl;
    if (this.userBusy()) { this.pos = el.scrollTop; return; }
    const max = el.scrollHeight - el.clientHeight;
    const goal = Math.max(0, Math.min(max, targetY - el.clientHeight * 0.12));
    if (Math.abs(this.pos - el.scrollTop) > 3) this.pos = el.scrollTop;
    this.pos += (goal - this.pos) * 0.08;
    el.scrollTop = this.pos;
  }
}
