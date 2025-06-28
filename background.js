import { blocksToMarkdown } from "./utils/markdown.js";

// Headers required by Notion API
const NOTION_VERSION = "2022-06-28";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "EXPORT_PAGE") {
    handleExport(msg.pageId)
      .then((result) => {
        sendResponse({ ok: true, marpMarkdown: result });
      })
      .catch((err) => {
        console.error(err);
        sendResponse({ ok: false, error: err.message });
      });
    // Return true to indicate async response will follow
    return true;
  }
});

async function handleExport(pageId) {
  const { notionToken, openaiKey } = await chrome.storage.sync.get({
    notionToken: "",
    openaiKey: ""
  });
  if (!notionToken || !openaiKey)
    throw new Error("Notion / OpenAI key missing. Set them in extension options.");
  const markdown = await fetchPageAsMarkdown(pageId, notionToken);
  const marpMarkdown = await askLLM(markdown, openaiKey);
  return marpMarkdown;
}

async function fetchPageAsMarkdown(pageId, token) {
  const blocks = [];
  let cursor = null;
  do {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${
      cursor ? `&start_cursor=${cursor}` : ""
    }`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      }
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
- To apply Marp slide styles, add \`---\nmarp: true\n---\` to the beginning of the document.
- If the table, code block, or quote is too long, automatically split the slide to make it visually better.
- If the list items are too long or too deeply nested, split it into multiple slides as needed. When splitting deeply nested lists, repeat the parent list items at the top of each new slide for context.
- For nested lists, indent using **2 spaces per level** (for example: \`- item\n  - subitem\`) to prevent them from being recognized as code blocks.
- Do not create new content arbitrarily.
- Do not summarize or delete the original content.
- Do not attach any additional explanations, guidance, or commentary other than the input, and only output the converted Marp Markdown results.
- Images should appear independently on a single page.

Please convert the markdown below.`;

  const body = {
    // Use Gemini 2.0 Flash model based on AI Studio example
    model: "gemini-2.0-flash",
    // Move temperature into generationConfig
    generationConfig: {
      temperature: 0
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: `${prompt}\n\n${rawMd}` }
        ]
      }
    ]
  };

  // Use Gemini API endpoint
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${openaiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Use x-goog-api-key for Gemini API
      // Authorization: `Bearer ${openaiKey}` // Removed OpenAI auth header
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorBody = await res.json();
    console.error("Gemini API error response:", errorBody);
    throw new Error(`Gemini API error ${res.status}: ${errorBody.error?.message || 'Unknown error'}`);
  }

  const data = await res.json();
  // Extract content from Gemini API response
  if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
    return data.candidates[0].content.parts[0].text;
  } else {
    console.error("Unexpected Gemini API response structure:", data);
    throw new Error("Failed to get content from Gemini API response.");
  }
}
