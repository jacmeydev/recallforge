import { AppShell } from '@/components/app/app-shell';
import { ReviewSession, type SessionMode } from '@/components/app/review-session';
import type { QuestionFormat } from '@/lib/core/formats';

export const dynamic = 'force-dynamic';

const MODES: SessionMode[] = ['normal', 'exam', 'quick'];
const FORMATS: QuestionFormat[] = ['recall', 'typing', 'multiple_choice', 'true_false'];

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string; tag?: string; mode?: string; format?: string }>;
}) {
  const { deck, tag, mode, format } = await searchParams;
  const sessionMode = MODES.find((m) => m === mode) ?? 'normal';
  const questionFormat = FORMATS.find((f) => f === format) ?? 'recall';
  return (
    <AppShell>
      <ReviewSession key={`${deck}|${tag}|${sessionMode}|${questionFormat}`} deck={deck} tag={tag} mode={sessionMode} format={questionFormat} />
    </AppShell>
  );
}
