import { AppShell } from '@/components/app/app-shell';
import { ReviewSession } from '@/components/app/review-session';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ deck?: string; tag?: string; mode?: string }> }) {
  const { deck, tag, mode } = await searchParams;
  return (
    <AppShell>
      <ReviewSession deck={deck} tag={tag} mode={mode === 'exam' ? 'exam' : undefined} />
    </AppShell>
  );
}
