import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/session';
import TaskDesk from './TaskDesk';

export const dynamic='force-dynamic';
export default async function TasksPage() {
  await requireUser();
  return <Suspense><TaskDesk/></Suspense>;
}
