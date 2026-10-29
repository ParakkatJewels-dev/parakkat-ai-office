-- Human department heads may see image work they requested through their AI
-- head or Design Studio. Creative heads retain their existing team-wide view.
begin;

create policy "requester reads own Studio designs" on public.designs for select to authenticated
  using (requested_by = auth.uid() and public.my_role() <> 'viewer');

create policy "requester reads own carousel set" on public.carousel_sets for select to authenticated
  using (requested_by = auth.uid() and public.my_role() <> 'viewer');

create policy "requester reads own Studio image review" on public.image_reviews for select to authenticated
  using (source = 'design' and public.my_role() <> 'viewer' and exists (
    select 1 from public.designs d where d.id = image_reviews.item_id and d.requested_by = auth.uid()
  ));

create index if not exists designs_requested_by_created on public.designs (requested_by, created_at desc);
commit;
