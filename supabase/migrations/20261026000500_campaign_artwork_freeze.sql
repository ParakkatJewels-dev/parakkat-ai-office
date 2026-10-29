-- Keep the approved asset stable while publishing, including redraws already running on another worker.
-- The parent campaign lock serializes the final approval with each creative mutation.
create or replace function guard_approved_campaign_artwork() returns trigger
language plpgsql security definer set search_path = public as $$
declare campaign_status text; campaign uuid;
begin
  campaign := case when TG_OP = 'DELETE' then OLD.campaign_id else NEW.campaign_id end;
  if TG_OP = 'UPDATE' and NEW.campaign_id is distinct from OLD.campaign_id then
    raise exception 'A campaign creative cannot move to another campaign';
  end if;
  -- SHARE conflicts with campaign status updates, without deadlocking independent creative writes.
  select status into campaign_status from campaigns where id = campaign for share;
  if campaign_status in ('approved','publishing','publish_review','live') then
    if TG_OP in ('INSERT','DELETE') then
      raise exception 'This campaign is approved. Its banner and copy are frozen';
    end if;
    if NEW.art_status in ('queued','making') or
       (to_jsonb(NEW) - array['art_status','art_error','queued_at','review_note','redo_note']) is distinct from
       (to_jsonb(OLD) - array['art_status','art_error','queued_at','review_note','redo_note']) then
      raise exception 'This campaign is approved. Its banner and copy are frozen';
    end if;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

create or replace function guard_campaign_artwork_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'approved' and OLD.status is distinct from NEW.status then
    if exists (select 1 from creatives where campaign_id = NEW.id and art_status in ('queued','making')) then
      raise exception 'Wait for the banner redesign to finish before final approval';
    end if;
    if NEW.channels = array['meta']::text[] and not exists
      (select 1 from creatives where campaign_id = NEW.id and image_path is not null) then
      raise exception 'Create a finished banner before approving a Meta-only campaign';
    end if;
  end if;
  return NEW;
end $$;

create trigger approved_campaign_artwork before insert or update or delete on creatives
for each row execute function guard_approved_campaign_artwork();
create trigger campaign_artwork_approval before update of status on campaigns
for each row execute function guard_campaign_artwork_approval();
revoke all on function guard_approved_campaign_artwork(), guard_campaign_artwork_approval() from public, anon, authenticated;
