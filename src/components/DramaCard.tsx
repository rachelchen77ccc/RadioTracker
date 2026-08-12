import { useEffect, useState, type MouseEvent } from 'react';
import { api } from '../api';
import { STATUSES, type Drama } from '../types';

const PLATFORM: Record<string, string> = { 猫耳: 'MEV', 漫播: 'MBO', 其他: 'ETC' };

/**
 * 磁带进度：两个卷轴夹一段带子。
 * 只表达「听到哪 / 一共几集」—— 不做任何「落后几集」的提示。
 */
export function Tape({ heard, total }: { heard: number | null; total: number | null }) {
  if (total == null) return null;
  const h = heard ?? 0;
  const pct = total > 0 ? Math.min(100, (h / total) * 100) : 0;
  return (
    <div className="tape" title={`听到第 ${h} 集，共 ${total} 集`}>
      <span className="reel" />
      <span className="band"><i style={{ width: `${pct}%` }} /></span>
      <span className="reel" />
      <span className="n">{h}/{total}</span>
    </div>
  );
}

export function DramaCard({ drama, onOpen }: { drama: Drama; onOpen: (d: Drama) => void }) {
  const [current, setCurrent] = useState(drama);
  const [marking, setMarking] = useState(false);
  useEffect(() => { setCurrent(drama); }, [drama]);
  const main = current.cvs.filter(c => c.role_type === '主役');

  const mark = async (e: MouseEvent<HTMLButtonElement>, status: Drama['status']) => {
    e.stopPropagation();
    setMarking(true);
    try {
      setCurrent(await api.update(current.id, { status }));
    } catch (err) {
      alert('状态保存失败：' + String((err as Error).message ?? err));
    } finally {
      setMarking(false);
    }
  };

  return (
    <article
      className={'card' + (current.rewatch_queued ? ' rewatching' : '')}
      /* 卡片底色跟着收听状态走，见 styles.css 里的 .card[data-status] */
      data-status={current.status ?? undefined}
      onClick={() => onOpen(current)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) onOpen(current);
      }}
      role="button"
      tabIndex={0}
      title={current.title}
    >
      <div className="cover">
        {current.cover
          ? <img src={current.cover} alt="" loading="lazy" />
          : <div className="placeholder">NO COVER</div>}
        {/* 真实元素，不用 ::after —— 那个位置被状态色条占了 */}
        {current.rewatch_queued && <span className="rewatch-flag">重刷</span>}
      </div>

      <div className="filerow">
        <span>{PLATFORM[current.platform] ?? 'ETC'}</span>
        <span>·</span>
        <span>{String(current.id).padStart(3, '0')}</span>
        {current.rating != null && <span className="score">{current.rating.toFixed(1)}</span>}
      </div>

      <div className="body">
        <div className="title">
          {current.title}
          {current.status && <span className={`tag s-${current.status}`}>{current.status}</span>}
        </div>
        {main.length > 0 && <div className="cv">{main.map(c => c.name).join(' · ')}</div>}

        <Tape heard={current.heard_episodes} total={current.total_episodes} />

        {!current.status && (
          <div className="status-picker" aria-label="选择收听状态" onClick={e => e.stopPropagation()}>
            {STATUSES.map(s => (
              <button key={s} type="button" disabled={marking} onClick={e => mark(e, s)}>{s}</button>
            ))}
          </div>
        )}

        <div className="meta">
          {!current.purchased && <span className="badge ghost">未购</span>}
          {current.review && <span className="badge ghost">REPO</span>}
        </div>
      </div>
    </article>
  );
}

export function Gallery({
  dramas, onOpen, wide, compact, empty = '这个抽屉是空的',
}: {
  dramas: Drama[]; onOpen: (d: Drama) => void; wide?: boolean; compact?: boolean; empty?: string;
}) {
  if (!dramas.length) return <div className="empty-state">— {empty} —</div>;
  return (
    <div className={'gallery' + (wide ? ' wide' : '') + (compact ? ' compact' : '')}>
      {dramas.map(d => <DramaCard key={d.id} drama={d} onOpen={onOpen} />)}
    </div>
  );
}
