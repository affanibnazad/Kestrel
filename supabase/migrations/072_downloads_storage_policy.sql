-- Migration 072: Storage Policy for Private Downloads Bucket
-- Creates the private 'downloads' bucket if not present, and grants SELECT only to authenticated users.
-- No anon access. No insert, update, or delete privileges for users.

-- 1. Ensure bucket exists and is private
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('downloads', 'downloads', false, 52428800, null)
on conflict (id) do update set public = false;

-- 2. Ensure RLS is active on storage.objects
alter table storage.objects enable row level security;

-- 3. Drop existing policies for downloads bucket to avoid duplicate definitions
drop policy if exists "Authenticated users can select downloads" on storage.objects;
drop policy if exists "downloads_authenticated_select" on storage.objects;

-- 4. Storage policy: authenticated users may SELECT objects in bucket 'downloads'
create policy "downloads_authenticated_select"
on storage.objects
for select
to authenticated
using (bucket_id = 'downloads');
