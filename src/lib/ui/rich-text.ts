// ============================================================================
// RecallForge — Card text renderer (browser-safe)
// ============================================================================
// Card text is plain text with a tiny, safe subset of Markdown:
//   **bold**  *italic*  `code`  ==highlight==  ![alt](media:ID)  line breaks,
//   "- " bullet lines. Everything else is escaped, so card text can never
//   inject HTML. Used by the web app and the in-chat study widget.
// ============================================================================

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderRichText(text: string, mediaUrl: (id: string) => string | null): string {
  const lines = escapeHtml(text).split('\n');
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) html.push('<ul>');
      inList = true;
      html.push(`<li>${inline(bullet[1], mediaUrl)}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    html.push(`${inline(line, mediaUrl)}<br>`);
  }
  if (inList) html.push('</ul>');
  return html.join('').replace(/(<br>)+$/, '');
}

function inline(text: string, mediaUrl: (id: string) => string | null): string {
  return text
    .replace(/!\[([^\]]*)\]\(media:([A-Za-z0-9-]+)\)/g, (_, alt: string, id: string) => {
      const url = mediaUrl(id);
      return url ? `<img src="${url}" alt="${alt}" loading="lazy">` : `<span class="rf-missing">[imagen: ${alt || id}]</span>`;
    })
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
