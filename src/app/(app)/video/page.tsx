import { requireUser } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import VideoDesk from './VideoDesk';

export const dynamic = 'force-dynamic';
export default async function VideoPage() {
  const { db, role } = await requireUser();
  const { data: reels } = await db.from('departments').select('human_head_role').eq('id', 'reels').maybeSingle();
  if (role === 'viewer' || (role !== 'super_admin' && reels?.human_head_role !== role)) redirect('/tasks');
  return <VideoDesk />;
}
