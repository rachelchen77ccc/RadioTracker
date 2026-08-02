import type { Drama } from '../types';

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
  const main = drama.cvs.filter(c => c.role_type === '主役');

  return (
    <button
      className={'card' + (drama.rewatch_queued ? ' rewatching' : '')}
      /* 卡片底色跟着收听状态走，见 styles.css 里的 .card[data-status] */
      data-status={drama.status ?? undefined}
      onClick={() => onOpen(drama)}
      title={drama.title}
    >
      <div className="cover">
        {drama.cover
          ? <img src={drama.cover} alt="" loading="lazy" />
          : <div className="placeholder">NO COVER</div>}
        {/* 真实元素，不用 ::after —— 那个位置被状态色条占了 */}
        {drama.rewatch_queued && <span className="rewatch-flag">重刷</span>}
      </div>

      <div className="filerow">
        <span>{PLATFORM[drama.platform] ?? 'ETC'}</span>
        <span>·</span>
        <span>{String(drama.id).padStart(3, '0')}</span>
        {drama.rating != null && <span className="score">{drama.rating.toFixed(1)}</span>}
      </div>

      <div className="body">
        <div className="title">
          {drama.title}
          {drama.status && <span className={`tag s-${drama.status}`}>{drama.status}</span>}
        </div>
        {main.length > 0 && <div className="cv">{main.map(c => c.name).join(' · ')}</div>}

        <Tape heard={drama.heard_episodes} total={drama.total_episodes} />

        <div className="meta">
          {!drama.purchased && <span className="badge ghost">未购</span>}
          {drama.review && <span className="badge ghost">REPO</span>}
        </div>
      </div>
    </button>
  );
}

export function Gallery({
  dramas, onOpen, wide, empty = '这个抽屉是空的',
}: {
  dramas: Drama[]; onOpen: (d: Drama) => void; wide?: boolean; empty?: string;
}) {
  if (!dramas.length) return <div className="empty-state">— {empty} —</div>;
  return (
    <div className={'gallery' + (wide ? ' wide' : '')}>
      {dramas.map(d => <DramaCard key={d.id} drama={d} onOpen={onOpen} />)}
    </div>
  );
}
