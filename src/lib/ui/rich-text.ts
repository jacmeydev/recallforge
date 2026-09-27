// ============================================================================
// RecallForge — Card text renderer (browser-safe)
// ============================================================================
// Card text is plain text with a tiny, safe subset of Markdown:
//   **bold**  *italic*  `code`  ==highlight==  ![alt](media:ID)  line breaks,
//   "- " bullet lines. Everything else is escaped, so card text can never
//   inject HTML. Used by the web app and the in-chat study widget.
// ============================================================================

export const escapeHtml = (text: string) =>
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

export interface OcclusionView {
  image: string;
  hideAll: boolean;
  ord: number;
  shapes: Array<{
    ord: number;
    shape: 'rect' | 'ellipse' | 'polygon' | 'text';
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    points?: Array<[number, number]>;
    label?: string;
  }>;
}

const pct = (value: number | undefined) => `${((value ?? 0) * 100).toFixed(3)}%`;

/**
 * An image with its occlusion masks. Question side: the asked region is red with "?",
 * the others yellow when "hide all" is on. Answer side: the asked region is outlined
 * and named; the others stay as on the question side. Labels (text shapes) always show.
 */
export function renderOcclusion(view: OcclusionView, revealed: boolean, mediaUrl: (id: string) => string | null): string {
  const url = mediaUrl(view.image);
  if (!url) return `<span class="rf-missing">[imagen]</span>`;
  const parts: string[] = [];
  const polygons: string[] = [];
  for (const shape of view.shapes) {
    const active = shape.ord === view.ord && shape.shape !== 'text';
    if (shape.shape === 'text') {
      if (shape.label) parts.push(`<span class="rf-occ-text" style="left:${pct(shape.left)};top:${pct(shape.top)}">${escapeHtml(shape.label)}</span>`);
      continue;
    }
    const state = active ? (revealed ? 'revealed' : 'active') : view.hideAll ? 'inactive' : null;
    if (!state) continue;
    if (shape.shape === 'polygon' && shape.points?.length) {
      polygons.push(`<polygon class="rf-occ-${state}" points="${shape.points.map(([x, y]) => `${x},${y}`).join(' ')}" vector-effect="non-scaling-stroke"/>`);
      if (active) {
        const cx = shape.points.reduce((sum, [x]) => sum + x, 0) / shape.points.length;
        const cy = shape.points.reduce((sum, [, y]) => sum + y, 0) / shape.points.length;
        parts.push(`<span class="rf-occ-mark" style="left:${pct(cx)};top:${pct(cy)}">${revealed ? escapeHtml(shape.label ?? '') : '?'}</span>`);
      }
      continue;
    }
    const style = `left:${pct(shape.left)};top:${pct(shape.top)};width:${pct(shape.width)};height:${pct(shape.height)}`;
    parts.push(
      `<span class="rf-occ-box rf-occ-${state}${shape.shape === 'ellipse' ? ' rf-occ-ellipse' : ''}" style="${style}">${
        active ? `<span class="rf-occ-label">${revealed ? escapeHtml(shape.label ?? '') : '?'}</span>` : ''
      }</span>`
    );
  }
  const svg = polygons.length ? `<svg class="rf-occ-svg" viewBox="0 0 1 1" preserveAspectRatio="none">${polygons.join('')}</svg>` : '';
  return `<span class="rf-occ"><img src="${url}" alt="Imagen con regiones ocultas">${svg}${parts.join('')}</span>`;
}

/** Styles for renderOcclusion (the web app and the widget include them). */
export const OCCLUSION_CSS = `
.rf-occ { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.rf-occ img { display: block; max-width: 100%; max-height: 70vh; height: auto; margin: 0 auto; border-radius: 6px; }
.rf-occ-box, .rf-occ-text, .rf-occ-mark { position: absolute; line-height: 1.2; }
.rf-occ-box { box-sizing: border-box; border: 1px solid #212121; display: flex; align-items: center; justify-content: center; }
.rf-occ-ellipse { border-radius: 50%; }
.rf-occ-active { background: #ff8e8e; }
.rf-occ-inactive { background: #ffeba2; }
.rf-occ-revealed { background: transparent; border: 2px solid #16a34a; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.rf-occ-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.rf-occ-svg .rf-occ-active { fill: #ff8e8e; stroke: #212121; stroke-width: 1px; }
.rf-occ-svg .rf-occ-inactive { fill: #ffeba2; stroke: #212121; stroke-width: 1px; }
.rf-occ-svg .rf-occ-revealed { fill: none; stroke: #16a34a; stroke-width: 2px; }
.rf-occ-label, .rf-occ-mark { font: 600 13px/1.2 system-ui, sans-serif; color: #111; padding: 1px 4px; border-radius: 4px; }
.rf-occ-revealed .rf-occ-label { position: absolute; top: 100%; left: 50%; transform: translate(-50%, 3px); white-space: nowrap; background: #16a34a; color: #fff; z-index: 1; }
.rf-occ-mark { transform: translate(-50%, -50%); background: rgba(255,255,255,.85); }
.rf-occ-text { font: 600 13px/1.2 system-ui, sans-serif; color: #111; background: rgba(255,255,255,.85); padding: 1px 4px; border-radius: 4px; }
`;
