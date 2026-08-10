import { useEffect, useState } from 'react';
import type { DiaryEntry, Drama } from './types';
import { appFetch } from './cloud/supabase';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await appFetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  dramas: (q: Record<string, string> = {}) =>
    req<Drama[]>('/api/dramas?' + new URLSearchParams(q)),
  drama: (id: number) => req<Drama>(`/api/dramas/${id}`),
  create: (body: Partial<Drama> & { cvNames?: string[] }) =>
    req<Drama>('/api/dramas', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: Partial<Drama> & { cvNames?: string[] }) =>
    req<Drama>(`/api/dramas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => req<void>(`/api/dramas/${id}`, { method: 'DELETE' }),
  /** 自定义顺序：把当前可见的 id 按拖好的次序整个发过来 */
  reorder: (ids: number[], offset = 0) =>
    req<{ updated: number }>('/api/dramas/reorder', {
      method: 'PATCH', body: JSON.stringify({ ids, offset }),
    }),
  /** 批量改状态 —— 整理页一次处理一片 */
  bulk: (body: {
    ids: number[];
    status?: string | null;
    rewatch_queued?: boolean;
    purchased?: boolean;
    platform?: string;
  }) => req<{ updated: number }>('/api/dramas/bulk', { method: 'PATCH', body: JSON.stringify(body) }),
  /** 封面：前端已裁成 640×640 的 dataURL */
  uploadCover: (id: number, dataUrl: string) =>
    req<Drama>(`/api/dramas/${id}/cover`, { method: 'POST', body: JSON.stringify({ dataUrl }) }),
  diary: (dramaId: number) => req<DiaryEntry[]>(`/api/dramas/${dramaId}/diary`),
  addDiary: (dramaId: number, body: Pick<DiaryEntry, 'entry_date' | 'episode_label' | 'content'>) =>
    req<DiaryEntry>(`/api/dramas/${dramaId}/diary`, { method: 'POST', body: JSON.stringify(body) }),
  updateDiary: (dramaId: number, entryId: number, body: Pick<DiaryEntry, 'entry_date' | 'episode_label' | 'content'>) =>
    req<DiaryEntry>(`/api/dramas/${dramaId}/diary/${entryId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeDiary: (dramaId: number, entryId: number) =>
    req<void>(`/api/dramas/${dramaId}/diary/${entryId}`, { method: 'DELETE' }),
};

/** 极简数据获取：够用就好，不引 react-query */
export function useFetch<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    req<T>(path)
      .then(d => alive && (setData(d), setError(null)))
      .catch(e => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, loading, reload: () => setNonce(n => n + 1) };
}
