import { useFetch } from '../api';
import { Gallery } from './DramaCard';
import type { Drama, YearStats } from '../types';

/**
 * 年度报告。
 *
 * 四张图全部是**单系列** —— 一个颜色、没有图例，所以不需要分类色板
 * （档案那套低饱和色做分类色是过不了 CVD 分辨检查的）。
 * 单系列的规则是：标题已经说明了它是什么，不需要图例；
 * 数值直接标在条上，不靠颜色传达身份。
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
      <div className="viz-block">
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

  if (loading) return <div className="empty-state">— 读取中 —</div>;
  if (error) return <div className="error">出错了：{error}</div>;
  if (!s) return null;

  const busiest = s.byMonth.reduce((a, b) => (b.n > a.n ? b : a), s.byMonth[0]);

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

      {s.topRated.length > 0 && (
        <Box bare={bare} tab="年度高分">
          <div className="hbars">
            {s.topRated.map((d, i) => (
              <div className="hbar" key={d.label} style={{ gridTemplateColumns: '28px 1fr 44px' }}>
                <span className="n" style={{ textAlign: 'left' }}>{String(i + 1).padStart(2, '0')}</span>
                <span className="name" style={{ color: 'var(--ink)' }}>{d.label}</span>
                <span className="n">{d.n}</span>
              </div>
            ))}
          </div>
        </Box>
      )}

      <Box bare={bare} tab={`${year} 全部`} >
        <span className="folder-count">{dramas?.length ?? 0} 件</span>
        <Gallery dramas={dramas ?? []} onOpen={onOpen} empty="这一年还没有听完的剧" />
      </Box>
    </div>
  );
}
