import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { renderShareCard } from '../shareCard';
import { STATUSES, type Drama } from '../types';
import { Tape } from './DramaCard';
import { DramaDiary } from './DramaDiary';

// 「待重刷」不在这里 —— 它已经拆成独立的 rewatch_queued（重刷计划），
// 这一列只剩「刷过几遍」的历史。
const REWATCH = ['', '已二刷', '已三刷', '已四刷', '已n刷'];
const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日', '每日', '复杂'];

/** 所有封面统一 640×640：本地裁好再传，服务端不需要图像库 */
const COVER_SIZE = 640;
const today = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

function cropToSquare(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = COVER_SIZE;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#f7f6f3';
        ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
        // 居中裁 —— 跟站内卡片的 object-fit: cover 一致
        const s = Math.min(img.width, img.height);
        ctx.drawImage(
          img, (img.width - s) / 2, (img.height - s) / 2, s, s,
          0, 0, COVER_SIZE, COVER_SIZE
        );
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => reject(new Error('这个文件不是图片'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('读不了这个文件'));
    reader.readAsDataURL(file);
  });
}

export function DramaDrawer({
  drama, onClose, onSaved, onDeleted,
}: {
  drama: Drama;
  onClose: () => void;
  onSaved: (d: Drama) => void;
  onDeleted: () => void;
}) {
  const [d, setD] = useState(drama);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 待提交的字段。只发改过的，避免把整个对象回写一遍。
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setD(drama); pending.current = {}; }, [drama.id]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (diaryOpen) return;
      if (share) setShare(null); else closeAndFlush();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, diaryOpen, d.id]);

  // 预览用的 objectURL 要回收，不然切几十部就漏几十份
  useEffect(() => () => { if (share) URL.revokeObjectURL(share); }, [share]);

  /**
   * 自动保存。改一下就排一次提交，600ms 内的连续输入合并成一次请求
   * （打字时不会每敲一个字发一次）。
   */
  const flush = async () => {
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setSaving(true);
    try {
      const saved = await api.update(d.id, patch);
      onSaved(saved);
      setSavedAt(Date.now());
    } catch {
      // 失败就把这批改动放回队列，下次再试，不静默丢掉
      pending.current = { ...patch, ...pending.current };
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Drama>(k: K, v: Drama[K]) => {
    const autoFinishedDate = k === 'status' && v === '听完' && !d.finished_date ? today() : null;
    setD(prev => {
      const next = { ...prev, [k]: v } as Drama;
      // 选听完、或修改听完剧的总集数时，界面也立刻显示满进度。
      if (next.status === '听完' && (k === 'status' || k === 'total_episodes')) {
        next.heard_episodes = next.total_episodes;
      }
      if (autoFinishedDate) next.finished_date = autoFinishedDate;
      return next;
    });
    // CV 是关系表，要转成后端认的 cvNames
    if (k === 'cvs') {
      pending.current.cvNames = (v as Drama['cvs'])
        .filter(c => c.role_type === '主役').map(c => c.name);
    } else {
      pending.current[k as string] = v;
    }
    if (autoFinishedDate) pending.current.finished_date = autoFinishedDate;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  // 关窗前把还没提交的改动送出去
  const closeAndFlush = () => {
    if (timer.current) clearTimeout(timer.current);
    flush();
    onClose();
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const uploadCover = async (file: File) => {
    setBusy('cover');
    try {
      const saved = await api.uploadCover(d.id, await cropToSquare(file));
      setD(saved);
      onSaved(saved);
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const makeShare = async () => {
    setBusy('share');
    try {
      const blob = await renderShareCard(d);
      setShare(URL.createObjectURL(blob));
    } catch (e) {
      alert('生成失败：' + String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`确定删除「${d.title}」吗？删除后会从所有页面移除。`)) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = {};
    setBusy('delete');
    try {
      await api.remove(d.id);
      onDeleted();
    } catch (e) {
      alert('删除失败：' + String((e as Error).message ?? e));
      setBusy(null);
    }
  };

  const download = () => {
    if (!share) return;
    const a = document.createElement('a');
    a.href = share;
    a.download = `${d.title.replace(/[\\/:*?"<>|]/g, '_')}.png`;
    a.click();
  };

  const numOrNull = (v: string) => (v === '' ? null : Number(v));
  const mainCvs = d.cvs.filter(c => c.role_type === '主役');
  const support = d.cvs.filter(c => c.role_type !== '主役');

  return (
    <>
      <div className="modal-backdrop" onClick={closeAndFlush} />
      <div className="modal" role="dialog" aria-modal="true">
        <button className="close" onClick={closeAndFlush} aria-label="关闭">×</button>

        <div className="mono" style={{ marginBottom: 16 }}>
          FILE_{String(d.id).padStart(4, '0')} // {d.platform}
        </div>

        <div className="detail-head">
          <div className="cover-col">
            {d.cover
              ? <img src={d.cover} alt="" />
              : <div
                  className="mono"
                  style={{
                    width: 124, height: 124, border: '1px solid var(--rule)',
                    background: 'var(--paper-2)', display: 'grid', placeItems: 'center',
                  }}
                >NO COVER</div>}
            <button
              className="btn"
              style={{ width: '100%', padding: '5px 0', fontSize: 10 }}
              disabled={busy === 'cover'}
              onClick={() => fileRef.current?.click()}
            >
              {busy === 'cover' ? '处理中' : '换封面'}
            </button>
            <input
              ref={fileRef} type="file" accept="image/*" hidden
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadCover(f);
                e.target.value = '';
              }}
            />
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>{d.title}</h2>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
              {d.kind && <span className="badge ghost">{d.kind}</span>}
              {d.serialize_status && <span className="badge ghost">{d.serialize_status}</span>}
              <span className="badge ghost">{d.purchased ? '已购' : '未购'}</span>
              {d.subscribed && <span className="badge ghost">追剧中</span>}
            </div>
            {d.categories.length > 0 && (
              <div className="mono" style={{ marginBottom: 4, textTransform: 'none' }}>
                {d.categories.slice(0, 6).join(' / ')}
              </div>
            )}
            {d.organization && (
              <div className="mono" style={{ textTransform: 'none' }}>{d.organization}</div>
            )}
            {d.missevan_id && (
              <a
                className="hint" style={{ display: 'inline-block', marginTop: 6 }}
                href={`https://www.missevan.com/mdrama/${d.missevan_id}`}
                target="_blank" rel="noreferrer"
              >猫耳页面 ↗</a>
            )}
          </div>
        </div>

        <div className="field-grid">
          <span className="k">收听状态</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {STATUSES.map(s => (
              <button
                key={s}
                className={'chip' + (d.status === s ? ' on' : '')}
                onClick={() => set('status', d.status === s ? null : s)}
              >{s}</button>
            ))}
          </div>

          <span className="k">听到哪</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input" type="number" min={0} style={{ width: 68 }}
              disabled={d.status === '听完'}
              title={d.status === '听完' ? '听完的剧会自动拉满进度' : undefined}
              value={d.heard_episodes ?? ''}
              onChange={e => set('heard_episodes', numOrNull(e.target.value))}
            />
            <span className="mono">/</span>
            <input
              className="input" type="number" min={0} style={{ width: 68 }}
              value={d.total_episodes ?? ''}
              onChange={e => set('total_episodes', numOrNull(e.target.value))}
            />
            <div style={{ flex: 1, minWidth: 110 }}>
              <Tape heard={d.heard_episodes} total={d.total_episodes} />
            </div>
          </div>

          {d.sawHint && (
            <>
              <span className="k" />
              <span className="hint" title="猫耳记录的上次收听位置，仅供参考 —— 点进去不等于听了">
                猫耳停在「{d.sawHint}」
              </span>
            </>
          )}

          <span className="k">评分</span>
          <input
            className="input" type="number" step={0.05} min={0} max={5} style={{ width: 84 }}
            value={d.rating ?? ''}
            onChange={e => set('rating', numOrNull(e.target.value))}
          />

          {/* 年度汇总按这个日期统计。重刷不要改它 ——
              改了那部剧会从原来那一年跑到今年，旧记录就丢了。 */}
          <span className="k">听完日期</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input" type="date" style={{ width: 158 }}
              value={d.finished_date ?? ''}
              onChange={e => set('finished_date', e.target.value || null)}
            />
            {(d.rewatch_status || d.rewatch_queued) && (
              <span className="hint" title="年度汇总只记初听。重刷请改上面的「重刷」，别动这个日期">
                重刷别改这里
              </span>
            )}
          </div>

          <span className="k">重刷</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select" style={{ width: 112 }}
              value={d.rewatch_status ?? ''}
              onChange={e => set('rewatch_status', e.target.value || null)}
              title="刷过几遍的历史"
            >
              {REWATCH.map(r => <option key={r} value={r}>{r || '没重刷过'}</option>)}
            </select>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox" checked={d.rewatch_queued}
                onChange={e => set('rewatch_queued', e.target.checked)}
              />
              放进重刷计划
            </label>
          </div>

          <span className="k">更新日</span>
          <select
            className="select" style={{ width: 128 }}
            value={d.update_day ?? ''}
            onChange={e => set('update_day', e.target.value || null)}
          >
            {DAYS.map(r => <option key={r} value={r}>{r || '—'}</option>)}
          </select>

          <span className="k">是否购买</span>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox" checked={d.purchased}
              onChange={e => set('purchased', e.target.checked)}
            />
            已购买
          </label>

          <span className="k">主役 CV</span>
          <input
            className="input"
            value={mainCvs.map(c => c.name).join(', ')}
            placeholder="逗号分隔"
            onChange={e => {
              const names = e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
              // 只替换主役，配役（猫耳同步来的全体参演）原样保留
              set('cvs', [
                ...names.map((name, i) => ({ id: -i - 1, name, character: null, role_type: '主役' })),
                ...support,
              ]);
            }}
          />
        </div>

        {support.length > 0 && (
          <details style={{ marginTop: 16, fontSize: 13 }}>
            <summary className="mono" style={{ cursor: 'pointer' }}>
              全体参演 {support.length} 位
            </summary>
            <div style={{ marginTop: 8, color: 'var(--ink-2)', lineHeight: 1.9 }}>
              {support.map(c => (
                <span key={`${c.id}-${c.character}`} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                  {c.name}
                  {c.character && <span style={{ color: 'var(--muted)' }}> · {c.character}</span>}
                </span>
              ))}
            </div>
          </details>
        )}

        <div className="review-editor">
          <div className="review-editor-head">
            <div className="mono">R E P O · 剧评</div>
            <button className="btn diary-launch" onClick={() => setDiaryOpen(true)}>听剧日记</button>
          </div>
          <textarea
            className="input"
            style={{ width: '100%', minHeight: 220, lineHeight: 1.85, resize: 'vertical' }}
            value={d.review ?? ''}
            placeholder="听完的感想…"
            onChange={e => set('review', e.target.value || null)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="autosave mono">
            {saving ? '保存中…' : savedAt ? '已自动保存' : '改动会自动保存'}
          </span>
          <button className="btn" onClick={makeShare} disabled={busy === 'share'}>
            {busy === 'share' ? '生成中' : '生成分享长图'}
          </button>
          <button
            className="btn danger"
            onClick={remove}
            disabled={saving || busy === 'delete'}
          >
            {busy === 'delete' ? '删除中' : '删除这部剧'}
          </button>
          {d.synced_at && (
            <span className="mono" style={{ marginLeft: 'auto', textTransform: 'none' }}>
              同步于 {d.synced_at}
            </span>
          )}
        </div>
      </div>

      {share && (
        <div className="share-backdrop" onClick={() => setShare(null)}>
          <div className="share-box" onClick={e => e.stopPropagation()}>
            <div className="head">
              <span className="t">分享卡片</span>
              <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={download}>
                下载 PNG
              </button>
              <button className="btn" onClick={() => setShare(null)}>关闭</button>
            </div>
            <div className="scroll">
              <img src={share} alt="分享卡片" />
            </div>
          </div>
        </div>
      )}

      {diaryOpen && <DramaDiary drama={d} onClose={() => setDiaryOpen(false)} />}
    </>
  );
}
