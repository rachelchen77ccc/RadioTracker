-- GitHub Pages cannot call the Missevan API directly because it does not allow CORS.
-- This authenticated RPC fetches one fixed public endpoint and returns its JSON
-- plus an optional Base64 cover. The browser still writes only through existing RLS.
create extension if not exists http with schema extensions;

create or replace function public.fetch_missevan_drama(p_missevan_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  detail_response extensions.http_response;
  cover_response extensions.http_response;
  detail jsonb;
  cover_url text;
  cover_bytes bytea;
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

  cover_url := detail #>> '{info,drama,cover}';
  if cover_url is not null and cover_url ~ '^https://([A-Za-z0-9-]+\.)*(maoercdn|missevan)\.com/' then
    select * into cover_response
    from extensions.http((
      'GET',
      cover_url,
      array[
        extensions.http_header('Referer', 'https://www.missevan.com/'),
        extensions.http_header('User-Agent', 'Mozilla/5.0 RadioTracker')
      ]::extensions.http_header[],
      null,
      null
    )::extensions.http_request);
    if cover_response.status = 200 and cover_response.content_type like 'image/%' then
      cover_bytes := extensions.text_to_bytea(cover_response.content);
      if octet_length(cover_bytes) > 8 * 1024 * 1024 then
        cover_bytes := null;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'detail', detail,
    'cover_base64', case when cover_bytes is null then null else encode(cover_bytes, 'base64') end,
    'cover_content_type', case when cover_bytes is null then null else cover_response.content_type end
  );
end;
$$;

revoke all on function public.fetch_missevan_drama(bigint) from public;
revoke all on function public.fetch_missevan_drama(bigint) from anon;
grant execute on function public.fetch_missevan_drama(bigint) to authenticated;
