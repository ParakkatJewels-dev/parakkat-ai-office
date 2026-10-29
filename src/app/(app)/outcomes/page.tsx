import { requireUser } from '@/lib/auth/session';
import { UUID } from '@/lib/automation/core.mjs';
import Outcomes from './Outcomes';

export const dynamic = 'force-dynamic';

export default async function OutcomesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {role}=await requireUser(),params=await searchParams;
  const campaign=typeof params.campaign==='string'&&UUID.test(params.campaign)?params.campaign:undefined;
  const view=typeof params.view==='string'&&['initiatives','campaigns','experiments','quality'].includes(params.view)?params.view:campaign?'campaigns':'initiatives';
  const initiative=typeof params.initiative==='string'&&UUID.test(params.initiative)?params.initiative:undefined;
  return <Outcomes initialView={view} initialInitiative={initiative} initialCampaign={campaign} initialRole={role}/>;
}
