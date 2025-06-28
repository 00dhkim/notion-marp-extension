(async () => {
  // 간단한 로딩 지연
  await new Promise(r => setTimeout(r, 3000));
  injectExportButton();
})();

function injectExportButton() {
  if (document.getElementById('marp-export-btn')) return;

  const btn = Object.assign(document.createElement('button'), {
    id: 'marp-export-btn',
    textContent: '⬇️ Export → Marp',
    onclick: startExport,
    style: `
      position:fixed; bottom:24px; right:24px; z-index:10000;
      padding:8px 14px; font-size:14px; background:#2f80ed; color:#fff;
      border:none; border-radius:6px; cursor:pointer;
      box-shadow:0 2px 6px rgba(0,0,0,.2);`
  });
  document.body.appendChild(btn);
}

function startExport() {
  const btn = document.getElementById('marp-export-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Converting…';

  const pageId = parseNotionPageId(location.pathname);
  if (!pageId) return done('Failed to parse Notion page ID.');

  chrome.runtime.sendMessage({ type: 'EXPORT_PAGE', pageId }, async ({ ok, marpMarkdown, error } = {}) => {
    if (!ok) return done('Export failed: ' + (error || 'Unknown error'));
    try {
      await renderMarpToPdf(marpMarkdown);
    } catch (e) {
      console.error(e);
      return done('PDF generation failed: ' + e.message);
    }
    done();
  });

  function done(msg) {
    if (msg) alert(msg);
    btn.disabled = false;
    btn.textContent = '⬇️ Export → Marp';
  }
}

function parseNotionPageId(path) {
  const id = path.split('-').pop().replace(/[^0-9a-f]/gi, '');
  return id.length === 32 ? id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5') : null;
}

async function renderMarpToPdf(marpMarkdown) {
  /* 1️⃣  utils/marp.js ─ ESM 빌드 */
  const { Marp } = await import(
    chrome.runtime.getURL('utils/marp.esm.js')    // ← CDN 대신 로컬 파일
  );
  const marp = new Marp();

  /* 2️⃣  utils/html2pdf.esm.js ─ ESM 번들 */
  const { default: html2pdf } = await import(
    chrome.runtime.getURL('utils/html2pdf.esm.js')
  );

  /* 3️⃣  Marp 슬라이드 렌더링 → PDF 저장 */
  const { html, css } = marp.render(marpMarkdown);
  const slide = document.createElement('div');
  slide.innerHTML = `<style>${css}</style>${html}`;
  slide.style.background = '#fff';
  document.body.appendChild(slide);

  await html2pdf()
    .set({
      margin: 0,
      filename: document.title.replace(/\s+/g, '-') + '.pdf',
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    })
    .from(slide)
    .save();

  slide.remove();
}
