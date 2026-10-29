-- Run only after migration015, with the current operator's own authenticated
-- super-admin claim already set in this SQL session. Never substitute another user.
-- All rows below are explicitly fake fixtures; no model/provider/storage call is made.
-- BEGIN + final ROLLBACK are mandatory. Nothing from this verification is retained.
begin;
do $$
declare actor uuid:=auth.uid();rid uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();creative uuid:=gen_random_uuid();
  aid uuid;new_aid uuid;got uuid;p jsonb;q jsonb;assets jsonb;n integer;denied boolean:=false;
begin
  if actor is null or public.my_role()<>'super_admin' then
    raise exception 'Set this session to your own signed-in super-admin claim before running the rollback fixture';
  end if;
  p:=jsonb_build_object('name','[ROLLBACK FIXTURE ONLY] Campaign review verification','budget_daily',0,'channels',jsonb_build_array('google'),'days',7);
  insert into public.agent_runs(id,kind,stage,status,state) values(rid,'campaign','done','waiting',jsonb_build_object('campaign_id',cid,'plan',p,'insights',jsonb_build_array('Fixture analysis')));
  insert into public.campaigns(id,run_id,name,budget_daily,channels,plan) values(cid,rid,p->>'name',0,array['google'],p);
  insert into public.creatives(id,campaign_id,kind,headline,body,art_status) values(creative,cid,'banner','Fixture copy','Fixture only; not publication material','needs_fix');
  select jsonb_agg(jsonb_build_object('id',id,'headline',headline,'body',body,'image_path',image_path,'art_status',art_status) order by id) into assets from public.creatives where campaign_id=cid;
  q:=jsonb_build_object('version',1,'passed',true,'claims','clean','policy','ok','cmoApproved',true,'artifact',jsonb_build_object('plan',p,'creatives',assets));
  update public.campaigns set status='in_approval',plan=p||jsonb_build_object('quality',q) where id=cid;
  insert into public.approvals(campaign_id,required_roles) values(cid,array[]::public.app_role[]) returning id into aid;
  -- Make the original approval stale, like work awaiting review from the earlier release.
  update public.campaigns set plan=p where id=cid;
  begin perform public.decide_approval(aid,'approve',null);exception when sqlstate '22023' then denied:=true;end;
  if not denied then raise exception 'FAIL: stale campaign was approved';end if;
  got:=public.request_campaign_rereview(aid);
  if got<>rid or not exists(select 1 from public.agent_runs where id=rid and stage='review' and status='running') then raise exception 'FAIL: saved review was not queued';end if;
  if public.request_campaign_rereview(aid)<>rid then raise exception 'FAIL: request replay did not return saved run';end if;
  if not exists(select 1 from public.creatives where id=creative and headline='Fixture copy' and art_status='needs_fix') then raise exception 'FAIL: saved creative changed';end if;
  if not exists(select 1 from public.approvals where id=aid and status='changes') then raise exception 'FAIL: old approval was not archived';end if;
  -- Simulate a saved passing review of this fixture; no inference is performed.
  update public.agent_runs set stage='approval',state=state||jsonb_build_object('plan',p,'quality',q,'review','Fixture-only review result') where id=rid;
  new_aid:=public.open_campaign_review(rid,p,'Fixture-only review result',q);
  if public.open_campaign_review(rid,p,'Fixture-only review result',q)<>new_aid then raise exception 'FAIL: review handoff repeated';end if;
  select count(*) into n from public.approvals where campaign_id=cid;
  if n<>2 or not exists(select 1 from public.approvals where id=new_aid and version=2 and quality_snapshot=q) then raise exception 'FAIL: new version was not isolated';end if;
  denied:=false;
  begin perform public.decide_approval(new_aid,'approve',null);exception when others then denied:=SQLERRM like '%Department heads have not all approved%';end;
  if not denied then raise exception 'FAIL: new version did not require fresh human votes';end if;
  update public.campaigns set plan=p where id=cid;
  if public.decide_approval(new_aid,'reject','Fixture-only negative decision')<>'rejected' then raise exception 'FAIL: negative decision required passing QC';end if;
  raise notice 'PASS: queue-only recovery, stale approval blocked, version isolation, replay and negative decision verified. Rolling back all fixture rows.';
end $$;
rollback;
