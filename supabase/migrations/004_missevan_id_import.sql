-- GitHub Pages cannot call the Missevan API directly because it does not allow CORS.
-- This authenticated RPC fetches one fixed public endpoint and returns its JSON
-- The browser uses the original cover URL. Fetching binary images through
-- pgsql-http's text response corrupts some files, so this RPC returns JSON only.
create extension if not exists http with schema extensions;

create or replace function public.fetch_missevan_drama(p_missevan_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  detail_response extensions.http_response;
  detail jsonb;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;
  if p_missevan_id is null or p_missevan_id <= 0 or p_missevan_id > 999999999999 then
    raise exception '请输入正确的猫耳剧集 ID';
  end if;

  select * into detail_response
  from extensions.http((
    'GET',
    'https://www.missevan.com/dramaapi/getdrama?drama_id=' || p_missevan_id::text,
    array[
      extensions.http_header('Accept', 'application/json'),
      extensions.http_header('User-Agent', 'Mozilla/5.0 RadioTracker')
    ]::extensions.http_header[],
    null,
    null
  )::extensions.http_request);

  if detail_response.status <> 200 then
    raise exception '猫耳详情接口暂时不可用（HTTP %）', detail_response.status;
  end if;
  begin
    detail := detail_response.content::jsonb;
  exception when others then
    raise exception '猫耳返回了无法识别的数据';
  end;
  if detail #> '{info,drama}' is null or coalesce(detail #>> '{info,drama,name}', '') = '' then
    raise exception '这个剧集不存在、已下架，或暂时无法公开访问';
  end if;

  return jsonb_build_object(
    'detail', detail,
    'cover_base64', null,
    'cover_content_type', null
  );
end;
$$;

revoke all on function public.fetch_missevan_drama(bigint) from public;
revoke all on function public.fetch_missevan_drama(bigint) from anon;
grant execute on function public.fetch_missevan_drama(bigint) to authenticated;
