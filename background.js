// background.js – MV3 service-worker (ESM)

import { Client as NotionClient } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { Marp } from "./utils/marp.esm.js";

const NOTION_VERSION = "2022-06-28";
const marp = new Marp();

/* ────────── 메시지 수신 ────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[background] 메시지 수신:', msg, sender);
  if (msg?.type === "EXPORT_PAGE") {
    (async () => {
      try {
        const marpMarkdown = await handleExport(msg.pageId);
        await buildPdf(marpMarkdown, getSenderTitle(sender) || "slides");
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[background] EXPORT_PAGE 처리 오류:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // async 응답 알림
  }
});

/* ────────── 1. Notion → Marp MD ────────── */
async function handleExport(pageId) {
  console.log('[background] handleExport 호출:', pageId);
  const { notionToken, openaiKey } = await chrome.storage.sync.get({
    notionToken: "",
    openaiKey: "",
  });
  console.log('[background] 저장소에서 토큰 로드:', { notionToken: !!notionToken, openaiKey: !!openaiKey });
  if (!notionToken || !openaiKey) {
    throw new Error("Notion / OpenAI key가 설정되지 않았습니다.");
  }
  const markdown = await fetchPageAsMarkdown(pageId, notionToken);
  console.log('[background] Notion → Markdown 변환 완료');
  return askLLM(markdown, openaiKey);
}

async function fetchPageAsMarkdown(pageId, token) {
  console.log('[background] fetchPageAsMarkdown 호출:', pageId);
  // ➊ Notion SDK 인스턴스
  // const notion = new NotionClient({ auth: token });
  const notion = new NotionClient({
    auth: token,
    fetch: (...args) => fetch(...args),
  });
  // ➋ notion-to-md 래퍼
  const n2m = new NotionToMarkdown({
    notionClient: notion,
    config: {
      // separateChildPage: false,    // 자식 페이지는 한 덩어리로
      parseChildPages: false       // 하위 페이지는 참조하지 않음
    },
  });
  // ➌ 페이지 → Markdown
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  console.log('[background] pageToMarkdown 결과:', mdBlocks);
  const { parent: markdown } = n2m.toMarkdownString(mdBlocks);
  console.log('[background] toMarkdownString 결과:', markdown);
  return markdown;
}

function parseOpenAIText(data) {
  // 1) Responses API 정규 구조: output[].type === "message" → content[].type === "output_text"
  try {
    const outputs = Array.isArray(data?.output) ? data.output : [];
    const msg = outputs.find(o => o?.type === "message");
    if (msg && Array.isArray(msg.content)) {
      const pieces = msg.content
        .filter(c => c?.type === "output_text" && typeof c.text === "string")
        .map(c => c.text);
      if (pieces.length) return pieces.join("\n");
    }
  } catch (_) { /* ignore */ }

  // 2) 일부 변형/래퍼 호환: 단일 text 필드
  if (typeof data?.text?.value === "string") return data.text.value;
  if (typeof data?.text === "string") return data.text;

  // 3) 아주 드문 레거시/변형: output[].content[].text 바로 노출
  try {
    const outputs = Array.isArray(data?.output) ? data.output : [];
    for (const o of outputs) {
      const c = Array.isArray(o?.content) ? o.content : [];
      const t = c.find(x => typeof x?.text === "string");
      if (t) return t.text;
    }
  } catch (_) { /* ignore */ }

  return null;
}

async function askLLM(rawMd, openaiKey) {
  console.log('[background] askLLM 호출, 입력 길이:', rawMd.length);
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

  // const body = {
  //   model: "gemini-2.5-flash",
  //   generationConfig: { temperature: 0 },
  //   contents: [
  //     {
  //       role: "user",
  //       parts: [{ text: `${prompt}\n\n${rawMd}` }],
  //     },
  //   ],
  // };
  const body = {
    model: "gpt-5-mini",
    // input: `${prompt}\n\n${rawMd}`,
    input: [
      {
        role: "developer",
        content: prompt,
      },
      {
        role: "user",
        content: rawMd,
      }
    ]
  };

  const res = await fetch(
    // `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${openaiKey}`,
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      // headers: { "Content-Type": "application/json" },
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
      body: JSON.stringify(body),
    }
  );
  console.log('[background] OpenAI API 요청 완료, status:', res.status);
  if (!res.ok) {
    let errBody;
    try {
      errBody = await res.text();
    } catch (e) {
      console.error('[background] OpenAI API 응답 파싱 오류:', e);
    }
    console.error('[background] OpenAI API 오류:', errBody);
    throw new Error(
      `OpenAI API error ${res.status}: ${errBody.error?.message || "Unknown"}`
    );
  }
  const data = await res.json();
  // const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  // Responses API 표준 출력: output[0].content[0].text (단일 텍스트 사용 시)
  const raw = parseOpenAIText(data);
  if (!raw) {
    console.error("OpenAI 응답에서 내용을 찾을 수 없습니다.", data);
    throw new Error("OpenAI 응답에서 내용을 찾을 수 없습니다.");
  }
  console.log("OpenAI 응답:", raw);
  // ── 새 헬퍼로 펜스 제거 ──
  return extractMarkdown(raw);
}

/* ────────── 2. Marp → PDF ────────── */
async function buildPdf(marpMd, title) {
  console.log('[background] buildPdf 호출:', { title, mdLength: marpMd.length, content: marpMd.slice(0, 100) + '...' });
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

/* ────────── 3. HTML → PDF 변환 ────────── */
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
  console.log('[background] htmlToPdf 호출:', filename, htmlString.slice(0, 500) + '...');
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
    console.log('[background] PDF 다운로드 완료:', filename);
  } finally {
    await chrome.debugger.detach(target).catch(() => { });
    if (!DEBUG_PREVIEW) await chrome.tabs.remove(tabId).catch(() => { });
  }
}

/* ────────── 4. 유틸 ────────── */
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