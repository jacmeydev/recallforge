import { renderRichText } from '@/lib/ui/rich-text';

const mediaUrl = (id: string) => `/api/v1/media/${encodeURIComponent(id)}`;

/** Card text with images, highlights and simple formatting (always escaped). */
export function RichText({ text, className }: { text: string; className?: string }) {
  return <div className={`rf-rich ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderRichText(text, mediaUrl) }} />;
}
