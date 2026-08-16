-- GitHub Pages 个人版：允许登录用户只管理自己 UUID 目录下的封面。
-- 图片本身用于公开网页展示；剧目和收听记录仍由 dramas 的 RLS 保护。
drop policy if exists "cover_insert_own_folder" on storage.objects;
create policy "cover_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'drama-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "cover_update_own_folder" on storage.objects;
create policy "cover_update_own_folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'drama-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'drama-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "cover_delete_own_folder" on storage.objects;
create policy "cover_delete_own_folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'drama-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
