// background.js – MV3 service-worker (ESM)

import { blocksToMarkdown } from "./utils/markdown.js";
import { Marp } from "./utils/marp.esm.js";

const NOTION_VERSION = "2022-06-28";
const marp = new Marp();

/* ────────── 메시지 수신 ────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "EXPORT_PAGE") {
    (async () => {
      try {
        const marpMarkdown = await handleExport(msg.pageId);
        await buildPdf(marpMarkdown, getSenderTitle(sender) || "slides");
        sendResponse({ ok: true });
      } catch (err) {
        console.error(err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // async 응답 알림
  }
});

/* ────────── 1. Notion → Marp MD ────────── */
async function handleExport(pageId) {
  const { notionToken, openaiKey } = await chrome.storage.sync.get({
    notionToken: "",
    openaiKey: "",
  });

  if (!notionToken || !openaiKey) {
    throw new Error("Notion / OpenAI key가 설정되지 않았습니다.");
  }

  const markdown = await fetchPageAsMarkdown(pageId, notionToken);
  return askLLM(markdown, openaiKey);
}

async function fetchPageAsMarkdown(pageId, token) {
  const blocks = [];
  let cursor = null;

  do {
    const url =
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100` +
      (cursor ? `&start_cursor=${cursor}` : "");

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status}`);

    const data = await res.json();
    blocks.push(...data.results);
    cursor = data.next_cursor;
  } while (cursor);

  return blocksToMarkdown(blocks);
}

async function askLLM(rawMd, openaiKey) {
  const prompt = `Here is a general markdown document.

Please convert this file to markdown for Marp slides.

Conversion conditions:
- Separate each main section or header (#, ##, etc.) into a new slide, and insert slide dividers (---) appropriately.
- Automatically split the content into multiple slides if it is long so that too much content is not crammed into one slide.
- Separate the title (#) and the body (text, list, table, etc.) of each slide.
- To apply Marp slide styles, add \`---\\nmarp: true\\n---\` to the beginning of the document.
- If the table, code block, or quote is too long, automatically split the slide to make it visually better.
- If the list items are too long or too deeply nested, split it into multiple slides as needed. When splitting deeply nested lists, repeat the parent list items at the top of each new slide for context.
- For nested lists, indent using **2 spaces per level** (for example: \`- item\\n  - subitem\`) to prevent them from being recognized as code blocks.
- Do not create new content arbitrarily.
- Do not summarize or delete the original content.
- Do not attach any additional explanations, guidance, or commentary other than the input, and only output the converted Marp Markdown results.
- Images should appear independently on a single page.

Please convert the markdown below.`;

  const body = {
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0 },
    contents: [
      {
        role: "user",
        parts: [{ text: `${prompt}\n\n${rawMd}` }],
      },
    ],
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${openaiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.json();
    throw new Error(
      `Gemini API error ${res.status}: ${errBody.error?.message || "Unknown"}`
    );
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini 응답에서 내용을 찾을 수 없습니다.");

  console.log("Gemini 응답:", raw);
  // ── 새 헬퍼로 펜스 제거 ──
  return extractMarkdown(raw);
}

/* ────────── 2. Marp → PDF ────────── */
async function buildPdf(marpMd, title) {
  const { html, css } = marp.render(marpMd);
  const htmlDoc = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>${css}</style>
    <style>html,body{margin:0;padding:0;background:#fff;}</style>
  </head>
  <body>
  ${html}
  </body>
  </html>`;
  await htmlToPdf(htmlDoc, sanitize(title) + ".pdf");
}

const DEBUG_PREVIEW = true;          // true 로 두면 탭이 눈에 보임

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function waitTabComplete(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function htmlToPdf(htmlString, filename) {
  /* 1️⃣ data: URL 생성 */
  const dataUrl =
    "data:text/html;charset=utf-8;base64," + toBase64Utf8(htmlString);

  /* 2️⃣ 탭 열고 로드 완료 대기 */
  const { id: tabId } = await chrome.tabs.create({
    url: dataUrl,
    active: DEBUG_PREVIEW,          // 디버깅 시 탭 표시
  });
  await waitTabComplete(tabId);
  const target = { tabId };

  /* 3️⃣ PDF 생성 */
  try {
    await chrome.debugger.attach(target, "1.3");
    await chrome.debugger.sendCommand(target, "Page.enable");
    const { data } = await chrome.debugger.sendCommand(
      target,
      "Page.printToPDF",
      { printBackground: true, preferCSSPageSize: true }
    );

    /* 4️⃣ 다운로드 */
    await chrome.downloads.download({
      url: "data:application/pdf;base64," + data,
      filename,
      saveAs: true,
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => { });
    if (!DEBUG_PREVIEW) await chrome.tabs.remove(tabId).catch(() => { });
  }
}

/* ────────── 3. 유틸 ────────── */
function getSenderTitle(sender) {
  return sender.tab?.title ?? "Notion-page";
}

function sanitize(str) {
  return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 180);
}

function extractMarkdown(text) {
  // (a) 식별자(markdown | md | marp) 펜스
  const langFence = /```[ \t]*(markdown|md|marp)[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/i;
  const m1 = text.match(langFence);
  if (m1) return m1[2].trim();

  // (b) 아무 식별자 없는 펜스
  const plainFence = /```\s*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/;
  const m2 = text.match(plainFence);
  if (m2) return m2[1].trim();

  // (c) 펜스가 없으면 전문 그대로
  return text.trim();
}