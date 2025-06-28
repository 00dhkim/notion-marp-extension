
export function blocksToMarkdown(blocks, depth = 0) {
  const md = [];
  const indent = "  ".repeat(depth);
  for (const b of blocks) {
    const text = (b[b.type]?.rich_text || []).map(rt => rt.plain_text).join("");
    switch (b.type) {
      case "paragraph":
        md.push(`${indent}${text}\n`);
        break;
      case "heading_1":
        md.push(`${indent}# ${text}\n\n`);
        break;
      case "heading_2":
        md.push(`${indent}## ${text}\n\n`);
        break;
      case "heading_3":
        md.push(`${indent}### ${text}\n\n`);
        break;
      case "bulleted_list_item":
        md.push(`${indent}- ${text}\n`);
        if (b.has_children && b.children) md.push(blocksToMarkdown(b.children, depth + 1));
        break;
      case "numbered_list_item":
        md.push(`${indent}1. ${text}\n`);
        if (b.has_children && b.children) md.push(blocksToMarkdown(b.children, depth + 1));
        break;
      case "code":
        const lang = b.code.language || "";
        md.push(`${indent}\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`);
        break;
      case "quote":
        md.push(`${indent}> ${text}\n\n`);
        break;
      case "image":
        const src = b.image.type === "external" ? b.image.external.url : b.image.file.url;
        md.push(`${indent}![](${src})\n\n`);
        break;
      default:
        // fallback: plain text representation
        if (text) md.push(`${indent}${text}\n`);
    }
  }
  return md.join("");
}