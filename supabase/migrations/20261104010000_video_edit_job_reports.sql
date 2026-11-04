-- Keep the editor's observations alongside the job that produced them.
alter table public.video_edit_jobs add column if not exists worker_report text;
