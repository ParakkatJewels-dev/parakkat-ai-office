-- Signed-out callers never need these; handle_new_user only runs from the auth trigger.
revoke execute on function public.decide_approval(uuid, text, text) from public, anon;
revoke execute on function public.decide_report(uuid, text, text) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.my_depts() from public, anon;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
