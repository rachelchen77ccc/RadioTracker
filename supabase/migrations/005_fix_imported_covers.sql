-- Imported covers created by the old RPC may contain corrupted binary data.
-- Keep custom uploads, but make imported rows fall back to their original URL.
update public.dramas
set cover_local = null,
    updated_at = now()
where cover_local like 'r2:%/imported/%';
