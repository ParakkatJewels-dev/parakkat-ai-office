import { requireUser } from '@/lib/auth/session';
import { PageHead } from '@/components/ui';
import Automations from '../automations/Automations';

export const dynamic = 'force-dynamic';

/** Customer questions from Instagram and the showroom, with reply drafts the team prepares for review. */
export default async function CustomerInbox() {
  const { role } = await requireUser();
  return <div className="page">
    <PageHead title="Customer inbox" sub="Customer questions from Instagram, WhatsApp and the showroom. The team drafts each reply; nothing is sent until you choose to send it." />
    <Automations isAdmin={role === 'super_admin'} only="customers" />
  </div>;
}
