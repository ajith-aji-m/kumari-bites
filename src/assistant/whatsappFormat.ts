// Converts the Markdown that AI models tend to produce into WhatsApp's own formatting:
// *bold*, _italic_, ~strike~, plain "•" bullets, no headings, tables or link syntax.
// Applied to every AI reply before it is sent; text that is already WhatsApp-formatted is unchanged.

export function toWhatsAppFormat(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => {
    // "# Heading" → "*Heading*"
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return `*${heading[1]!.replace(/\*\*/g, "").replace(/^\*(.*)\*$/, "$1")}*`;
    // Horizontal rules and table separator rows carry no meaning in a chat.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) return null;
    // "| a | b |" table rows → "a · b"
    if (/^\s*\|.*\|\s*$/.test(line)) return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ");
    // "* item", "- item", "+ item" bullets → "• item" (a single "*" followed by a space is a bullet, never bold)
    return line.replace(/^(\s*)[*+-]\s+/, "$1• ");
  }).filter((line): line is string => line !== null);

  return lines.join("\n")
    .replace(/\*\*\*(.+?)\*\*\*/g, "*_$1_*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/`{3}[a-z]*\n?|`{3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
