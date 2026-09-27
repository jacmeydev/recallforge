import { renderOcclusion, renderRichText, type OcclusionView } from '@/lib/ui/rich-text';

const mediaUrl = (id: string) => `/api/v1/media/${encodeURIComponent(id)}`;

/** Card text with images, highlights and simple formatting (always escaped). */
export function RichText({ text, className }: { text: string; className?: string }) {
  return <div className={`rf-rich ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderRichText(text, mediaUrl) }} />;
}

/** An image occlusion card: the image with the asked region covered (or revealed). */
export function OcclusionImage({ view, revealed, className }: { view: OcclusionView; revealed: boolean; className?: string }) {
  return <div className={`text-center ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderOcclusion(view, revealed, mediaUrl) }} />;
}
