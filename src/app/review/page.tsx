import { AppShell } from '@/components/app/app-shell';
import { ReviewSession } from '@/components/app/review-session';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ deck?: string; tag?: string }> }) {
  const user = await requireUser();
  const { deck, tag } = await searchParams;
  return (
    <AppShell userName={user.name}>
      <ReviewSession deck={deck} tag={tag} />
    </AppShell>
  );
}
