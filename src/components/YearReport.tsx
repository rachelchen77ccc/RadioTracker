import { useEffect, useState } from 'react';
import { useFetch } from '../api';
import { Gallery } from './DramaCard';
import { renderYearShareCard } from '../yearShareCard';
import type { Drama, YearStats } from '../types';

/**
 * 年度报告。
 *
 * 每个数据区块保留单系列图表，数值直接标在条上；区块之间使用
 * 不同的低饱和色，避免整页统计信息被单一颜色淹没。
 */

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

function Bars({ data }: { data: { month: number; n: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.n));
  return (
    <>
      <div className="bars">
        {data.map(d => (
          <div key={d.month} className={'col' + (d.n === 0 ? ' zero' : '')} title={`${d.month} 月 · ${d.n} 部`}>
            <span className="val">{d.n || ''}</span>
            <i style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-axis" />
      <div className="bars" style={{ height: 'auto', alignItems: 'flex-start' }}>
        {MONTHS.map(m => (
          <div key={m} className="col" style={{ height: 'auto' }}>
            <span className="lab">{m}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function HBars({
  data, unit = '',
}: { data: { label: string; n: number }[]; unit?: string }) {
  if (!data.length) return <div className="empty-state">— 没有数据 —</div>;
  const max = Math.max(...data.map(d => d.n));
  return (
    <div className="hbars">
      {data.map(d => (
        <div className="hbar" key={d.label}>
          <span className="name" title={d.label}>{d.label}</span>
          <span className="track"><i style={{ width: `${(d.n / max) * 100}%` }} /></span>
          <span className="n">{d.n}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** 外层已经有夹子时退化成朴素分区，否则还是一只夹子 */
function Box({
  bare, tab, children,
}: { bare?: boolean; tab: string; children: React.ReactNode }) {
  if (bare) {
    return (
      <div className="viz-block" data-tab={tab}>
        <div className="mono viz-block-tab">{tab}</div>
        {children}
      </div>
    );
  }
  return <section className="folder" data-tab={tab}>{children}</section>;
}

export function YearReport({
  year, version, onOpen, bare,
}: {
  year: string; version: number; onOpen: (d: Drama) => void;
  /** 已经被外层夹子包着了，里面就别再套一层夹子 */
  bare?: boolean;
}) {
  const { data: s, loading, error } = useFetch<YearStats>(`/api/years/${year}/stats`, [version]);
  const { data: dramas } = useFetch<Drama[]>(`/api/years/${year}`, [version]);
  const [pickIds, setPickIds] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [share, setShare] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [loadedYear, setLoadedYear] = useState('');

  const ranked = [...(dramas ?? [])].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title));
  const defaultPicks = ranked.slice(0, 5);
  const picks = pickIds
    .map(id => dramas?.find(d => d.id === id))
    .filter((d): d is Drama => !!d);
  const topFive = picks.length === 5 ? picks : defaultPicks;

  useEffect(() => {
    const saved = localStorage.getItem(`radio-tracker:year-report:${year}`);
    if (!saved) {
      setPickIds([]);
      setNote('');
      setLoadedYear(year);
      return;
    }
    try {
      const value = JSON.parse(saved) as { picks?: number[]; note?: string };
      setPickIds(Array.isArray(value.picks) ? value.picks : []);
      setNote(value.note ?? '');
    } catch {
      setPickIds([]);
      setNote('');
    }
    setLoadedYear(year);
  }, [year]);

  useEffect(() => {
    if (!dramas || loadedYear !== year) return;
    localStorage.setItem(`radio-tracker:year-report:${year}`, JSON.stringify({ picks: pickIds, note }));
  }, [dramas, year, pickIds, note, loadedYear]);

  useEffect(() => () => { if (share) URL.revokeObjectURL(share); }, [share]);

  if (loading) return <div className="empty-state">— 读取中 —</div>;
  if (error) return <div className="error">出错了：{error}</div>;
  if (!s) return null;

  const busiest = s.byMonth.reduce((a, b) => (b.n > a.n ? b : a), s.byMonth[0]);

  const updatePick = (slot: number, id: number) => {
    const next = topFive.map(d => d.id);
    const current = next.indexOf(id);
    if (current >= 0) next[current] = next[slot];
    next[slot] = id;
    setPickIds(next);
  };

  const makeShare = async () => {
    setSharing(true);
    try {
      const blob = await renderYearShareCard({
        year, total: s.total, episodes: s.episodes, avgRating: s.avgRating, reviews: s.reviews,
      }, topFive, note, {
        byMonth: s.byMonth,
        topCvs: s.topCvs,
        byCategory: s.byCategory,
      });
      setShare(URL.createObjectURL(blob));
    } catch (e) {
      alert('生成失败：' + String((e as Error).message ?? e));
    } finally {
      setSharing(false);
    }
  };

  const download = () => {
    if (!share) return;
    const a = document.createElement('a');
    a.href = share;
    a.download = `${year}-听剧年度总结.png`;
    a.click();
  };

  return (
    <div className={"viz-root" + (bare ? " bare" : "")}>
      <Box bare={bare} tab={`${year} 年报`}>
        <div className="stat-row">
          <div className="stat">
            <div className="v">{s.total}</div>
            <div className="k">听完的剧</div>
          </div>
          <div className="stat">
            <div className="v">{s.episodes.toLocaleString()}</div>
            <div className="k">总集数</div>
          </div>
          <div className="stat">
            <div className="v">{s.avgRating ?? '—'}</div>
            <div className="k">平均评分</div>
          </div>
          <div className="stat">
            <div className="v">{s.reviews}</div>
            <div className="k">写了剧评</div>
          </div>
          <div className="stat">
            <div className="v">{busiest?.n ?? 0}</div>
            <div className="k">最多的一个月 · {busiest?.month} 月</div>
          </div>
        </div>
      </Box>

      <Box bare={bare} tab="节奏">
        <div className="chart-grid">
          <div className="chart">
            <h3>每月听完</h3>
            <p className="cap">{year} 年逐月听完的部数。</p>
            <Bars data={s.byMonth} />
          </div>

          <div className="chart">
            <h3>评分分布</h3>
            <p className="cap">你给出的分数集中在哪一档。</p>
            <HBars data={s.byRating.map(r => ({ label: `${r.label} 分`, n: r.n }))} unit=" 部" />
          </div>
        </div>
      </Box>

      <Box bare={bare} tab="口味">
        <div className="chart-grid">
          <div className="chart">
            <h3>题材 Top 10</h3>
            <p className="cap">这一年听得最多的题材标签。</p>
            <HBars data={s.byCategory} unit=" 部" />
          </div>

          <div className="chart">
            <h3>主役 CV Top 10</h3>
            <p className="cap">按主役身份统计，不含配役。</p>
            <HBars data={s.topCvs} unit=" 部" />
          </div>
        </div>
      </Box>

      {topFive.length > 0 && (
        <Box bare={bare} tab="年度高分">
          <div className="year-picks-head">
            <div>
              <span className="mono">TOP 5 / MY YEAR IN DRAMAS</span>
              <p>默认按评分排列。把真正舍不得忘记的五部，留在这里。</p>
            </div>
            <div className="year-picks-actions">
              <button className="btn" onClick={() => setEditing(v => !v)}>{editing ? '收起编辑' : '编辑榜单'}</button>
              <button className="btn primary" onClick={makeShare} disabled={sharing}>{sharing ? '生成中' : '生成分享长图'}</button>
            </div>
          </div>
          <div className="year-picks-grid">
            {topFive.map((d, i) => (
              <article className={'year-pick-card rank-' + (i + 1)} key={`${i}-${d.id}`}>
                <button className="year-pick-cover" onClick={() => onOpen(d)} title={`查看 ${d.title}`}>
                  {d.cover ? <img src={d.cover} alt="" /> : <span>NO COVER</span>}
                </button>
                <div className="year-pick-copy">
                  <span className="year-pick-rank">{String(i + 1).padStart(2, '0')}</span>
                  <strong title={d.title}>{d.title}</strong>
                  <span className="year-pick-cv">{d.cvs.filter(c => c.role_type === '主役').map(c => c.name).join(' · ') || '听完这一部的你'}</span>
                  <span className="year-pick-score">{d.rating == null ? '—' : d.rating.toFixed(1)} <i>★</i></span>
                </div>
                {editing && (
                  <select className="select year-pick-select" value={d.id} onChange={e => updatePick(i, Number(e.target.value))}>
                    {ranked.map(option => <option value={option.id} key={option.id}>{option.title}{option.rating == null ? '' : ` · ${option.rating}`}</option>)}
                  </select>
                )}
              </article>
            ))}
          </div>
          <label className="year-note">
            <span className="mono">年度私藏 / 会出现在分享长图中</span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="写一句想留给这一年的话…"
              maxLength={96}
            />
          </label>
        </Box>
      )}

      <Box bare={bare} tab={`${year} 全部`} >
        <span className="folder-count">{dramas?.length ?? 0} 件</span>
        <Gallery dramas={dramas ?? []} onOpen={onOpen} empty="这一年还没有听完的剧" />
      </Box>

      {share && (
        <div className="share-backdrop" onClick={() => setShare(null)}>
          <div className="share-box year-share-box" onClick={e => e.stopPropagation()}>
            <div className="head">
              <span className="t">{year} 年度总结</span>
              <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={download}>下载 PNG</button>
              <button className="btn" onClick={() => setShare(null)}>关闭</button>
            </div>
            <div className="scroll"><img src={share} alt={`${year} 年度听剧总结分享长图`} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
