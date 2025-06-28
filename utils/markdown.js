// utils/markdown.js  –  Markdown 변환 + 중첩 리스트 지원
const INDENT = "  ";                 // 2-space 들여쓰기

export function blocksToMarkdown(blocks, depth = 0) {
  const md = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    const type = block.type;
    const rich = block[type]?.rich_text ?? [];
    const text = rich.map(t => t.plain_text).join("");

    /* ───────── 리스트 그룹 처리 ───────── */
    if (type === "bulleted_list_item" || type === "numbered_list_item") {
      // 같은 타입이 연속될 때 묶어서 처리
      const group = [];
      let j = i;
      while (
        j < blocks.length &&
        blocks[j].type === type
      ) {
        group.push(blocks[j]);
        j++;
      }
      md.push(
        group
          .map(item => {
            const mark = type === "bulleted_list_item" ? "- " : "1. ";
            const line =
              INDENT.repeat(depth) +
              mark +
              (item[item.type].rich_text || [])
                .map(t => t.plain_text)
                .join("");
            const children = item.children
              ? blocksToMarkdown(item.children, depth + 1)
              : "";
            return line + "\n" + children;
          })
          .join("")
      );
      i = j;
      continue;
    }

    /* ───────── 일반 블록들 ───────── */
    switch (type) {
      case "paragraph":
        if (text.trim())
          md.push(INDENT.repeat(depth) + text.trim() + "\n\n");
        break;
      case "quote":
        md.push(INDENT.repeat(depth) + "> " + text + "\n\n");
        break;
      // 필요하면 heading, to_do 등 추가
      default:
        // 기타 블록은 무시하거나 로깅
        console.debug("Unhandled block type:", type);
    }

    // 자식 블록
    if (block.children?.length) {
      md.push(blocksToMarkdown(block.children, depth));
    }
    i++;
  }

  return md.join("");
}
