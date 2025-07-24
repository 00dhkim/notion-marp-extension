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
      chrome.runtime.sendMessage({ type: 'BUILD_PDF', marpMarkdown });
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
  // Notion 페이지 ID는 경로 마지막에 위치하는 32자리의 16진수 문자열입니다.
  // 페이지 제목에 non-ASCII 문자가 포함된 경우 등 다양한 경로 형식을 처리하기 위해 정규식을 사용합니다.
  // 예: /some-page-title-2206ec9cbfd080f4b785d3209a7b6ce8
  // 예: /2206ec9cbfd080f4b785d3209a7b6ce8
  const match = path.match(/([0-9a-f]{32})$/i);
  if (!match) return null;

  const id = match[1];
  return id;
}


