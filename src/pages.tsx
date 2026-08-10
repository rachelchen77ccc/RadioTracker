import { useEffect, useState } from 'react';
import { api, useFetch } from './api';
import { Gallery } from './components/DramaCard';
import { Facets } from './components/Facets';
import { Pager, StatusGallery } from './components/StatusGallery';
import { TabbedFolder } from './components/TabbedFolder';
import { YearReport } from './components/YearReport';
import type { CvStat, Drama, YearStat } from './types';

type P = { onOpen: (d: Drama) => void; version: number };

/** 分页接口的统一形状 */
type DramaPage = { total: number; page: number; pageSize: number; pages: number; items: Drama[] };

export const Head = ({
  kicker, title,
}: { kicker: string; title: string }) => (
  <div className="page-head">
    <div className="kicker">{kicker}</div>
    <h1>{title}</h1>
  </div>
);

/**
 * 一只档案夹。
 *
 * 颜色按**标签名散列**取，不按它在页面里排第几 —— 「在听」永远是同一个色，
 * 不管它出现在哪一页、上面还有没有别的夹子。用 nth-of-type 做不到这一点：
 * 单张夹子的页面会永远是同一个颜色，多张时几个 nth 规则还会互相覆盖。
 *
 * 散列会撞（六个色位而已），所以同一页放多张夹子时在调用处显式传 tone。
 * 只有一张夹子的页面交给散列就行。
 */
const TONES = 6;

function toneOf(tab: string) {
  let h = 0;
  for (let i = 0; i < tab.length; i++) h = (h * 31 + tab.charCodeAt(i)) >>> 0;
  return h % TONES;
}

export const Folder = ({
  tab, count, note, tone, children,
}: {
  tab: string; count?: number; note?: string;
  /** 想指定颜色就传 0..5，不传按标签名散列 */
  tone?: number;
  children: React.ReactNode;
}) => (
  <section
    className="folder"
    data-tab={tab}
    data-tone={tone ?? toneOf(tab)}
  >
    {count != null && <span className="folder-count">{count} 件</span>}
    {note && <p className="folder-note">{note}</p>}
    {children}
  </section>
);

const Loading = () => <div className="empty-state">— 读取中 —</div>;
const Err = ({ e }: { e: string }) => <div className="error">出错了：{e}</div>;

export function Async<T>({
  path, version, children,
}: { path: string; version: number; children: (d: T) => React.ReactNode }) {
  const { data, error, loading } = useFetch<T>(path, [version]);
  if (loading) return <Loading />;
  if (error) return <Err e={error} />;
  if (!data) return null;
  return <>{children(data)}</>;
}

// ── 首页：在听 + 本周更新 ───────────────────────────────

const WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const todayCn = WEEK[(new Date().getDay() + 6) % 7];

export function Home({ onOpen, version }: P) {
  return (
    <>
      <Head
        kicker="Now Playing"
        title="我正在听的剧"
      />

      <Async<Drama[]> path="/api/views/listening" version={version}>
        {d => (
          <Folder tab="在听" tone={3} count={d.length}>
            <Gallery dramas={d} onOpen={onOpen} wide compact empty="现在没有在听的剧" />
          </Folder>
        )}
      </Async>

      <Async<Record<string, Drama[]>> path="/api/views/schedule" version={version}>
        {byDay => (
          <Folder tab="本周更新" tone={1}>
            <div className="week">
              {WEEK.map(day => (
                <div key={day} className={'day' + (day === todayCn ? ' today' : '')}>
                  <h3>{day}</h3>
                  {(byDay[day] ?? []).length === 0
                    ? <div className="empty">—</div>
                    : byDay[day].map(dr => (
                        <div
                          className={'item' + (dr.update_day === '每日' ? ' daily' : '')}
                          key={dr.id}
                          onClick={() => onOpen(dr)}
                          title={dr.update_day === '每日' ? `${dr.title} · 每日更新` : dr.title}
                        >
                          {dr.cover && <img src={dr.cover} alt="" loading="lazy" />}
                          <span>{dr.title}</span>
                        </div>
                      ))}
                </div>
              ))}
            </div>
          </Folder>
        )}
      </Async>
    </>
  );
}

// ── 两个主入口：已购 / 收藏 ──────────────────────────────
//
// 猫耳同步来的数据就这两类，收听状态直接在卡片上标。
// 默认「未标记」排最前 —— 同步完进来就是待办。

export function Purchased({ onOpen, version }: P) {
  return (
    <>
      <Head
        kicker="Purchased"
        title="我的已购"
      />
      <StatusGallery
        path="/api/views/purchased"
        countsPath="/api/views/purchased/counts"
        onOpen={onOpen}
        version={version}
        emptyText="这一档是空的"
        hidePageNote
      />
    </>
  );
}

export function Collection({ onOpen, version }: P) {
  return (
    <>
      <Head
        kicker="Collection"
        title="我的收藏"
      />
      <StatusGallery
        path="/api/views/collection"
        countsPath="/api/views/collection/counts"
        onOpen={onOpen}
        version={version}
        emptyText="收藏夹是空的"
      />
    </>
  );
}

// ── 重刷：计划 vs 库 ────────────────────────────────────

export function Rewatch({ onOpen, version }: P) {
  const [tab, setTab] = useState('queue');
  const { data: queue } = useFetch<Drama[]>('/api/views/rewatch-queue', [version]);
  const { data: lib } = useFetch<Drama[]>('/api/views/rewatch-library', [version]);
  const rows = tab === 'queue' ? queue : lib;

  return (
    <>
      <Head
        kicker="Rewatch"
        title="重刷"
      />
      <TabbedFolder
        active={tab}
        onSelect={setTab}
        count={rows?.length}
        tabs={[
          { key: 'queue', label: '重刷计划', n: queue?.length, tone: 5 },
          { key: 'lib', label: '重刷库', n: lib?.length, tone: 2 },
        ]}
      >
        <Gallery
          dramas={rows ?? []} onOpen={onOpen} wide
          empty={tab === 'queue' ? '还没挑重刷的剧' : '还没有重刷记录'}
        />
      </TabbedFolder>
    </>
  );
}

// ── 推荐剧单 ─────────────────────────────────────────────

export function Lists({ onOpen, version }: P) {
  const [tab, setTab] = useState('five');
  const { data: rec } = useFetch<{ 五星: Drama[]; 优质: Drama[] }>('/api/views/recommend', [version]);
  const { data: books } = useFetch<Drama[]>('/api/views/audiobooks', [version]);

  return (
    <>
      <Head kicker="Picks & Charts" title="剧单榜单" />
      <TabbedFolder
        active={tab}
        onSelect={setTab}
        count={tab === 'five' ? rec?.五星.length : tab === 'good' ? rec?.优质.length : books?.length}
        tabs={[
          { key: 'five', label: '五星', n: rec?.五星.length, tone: 4 },
          { key: 'good', label: '优质 4.8+', n: rec?.优质.length, tone: 1 },
          { key: 'book', label: '有声书排行', n: books?.length, tone: 2 },
        ]}
      >
        {tab === 'five' && <Gallery dramas={rec?.五星 ?? []} onOpen={onOpen} wide empty="还没有五星剧" />}
        {tab === 'good' && <Gallery dramas={rec?.优质 ?? []} onOpen={onOpen} empty="暂无" />}
        {tab === 'book' && (
            <table className="table">
              <thead>
                <tr>
                  <th className="rank">No.</th><th>书名</th><th>主役</th>
                  <th>平台</th><th className="num">评分</th>
                </tr>
              </thead>
              <tbody>
                {(books ?? []).map((x, i) => (
                  <tr key={x.id} onClick={() => onOpen(x)} style={{ cursor: 'pointer' }}>
                    <td className={'rank' + (i < 3 ? ' top' : '')}>{String(i + 1).padStart(2, '0')}</td>
                    <td>{x.title}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {x.cvs.filter(c => c.role_type === '主役').map(c => c.name).join(' · ')}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{x.platform}</td>
                    <td className="num">{x.rating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        )}
      </TabbedFolder>
    </>
  );
}

// ── CV：自查 + 排行合一页 ───────────────────────────────

export function Cv({ onOpen, version }: P) {
  const [cv, setCv] = useState('');
  const [query, setQuery] = useState('');
  const [min, setMin] = useState(10);
  const [role, setRole] = useState<'main' | 'all'>('main');

  const roleQ = role === 'all' ? '&role=all' : '';
  const { data: all } = useFetch<CvStat[]>(`/api/cvs?min=1${roleQ}`, [version, role]);
  const { data: rank } = useFetch<CvStat[]>(`/api/cvs?min=${min}${roleQ}`, [version, min, role]);

  const matches = (all ?? []).filter(c => !query || c.name.includes(query)).slice(0, 44);
  const max = Math.max(1, ...(rank ?? []).map(c => c.drama_count));

  return (
    <>
      <Head
        kicker="CV Index"
        title="CV"
      />

      <div className="toolbar">
        <div className="segmented">
          <button className={role === 'main' ? 'on' : ''} onClick={() => setRole('main')}>只算主役</button>
          <button className={role === 'all' ? 'on' : ''} onClick={() => setRole('all')}>含全体参演</button>
        </div>
      </div>

      <Folder tab="CV 自查" tone={3}>
        <div className="toolbar">
          <input
            className="input search" placeholder="搜 CV 名字…"
            value={query} onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="toolbar" style={{ marginBottom: cv ? 20 : 0 }}>
          {matches.map(c => (
            <button
              key={c.id}
              className={'chip' + (cv === c.name ? ' on' : '')}
              onClick={() => setCv(cv === c.name ? '' : c.name)}
            >
              {c.name}<span style={{ opacity: .55, marginLeft: 5 }}>{c.drama_count}</span>
            </button>
          ))}
        </div>
        {cv && (
          <Async<Drama[]>
            path={`/api/cvs/${encodeURIComponent(cv)}/dramas${role === 'all' ? '?role=all' : ''}`}
            version={version}
          >
            {d => <Gallery dramas={d} onOpen={onOpen} />}
          </Async>
        )}
      </Folder>

      <Folder tab="CV 排行" tone={1} count={(rank ?? []).length}>
        <div className="toolbar">
          {[5, 10, 15, 20].map(m => (
            <button key={m} className={'chip' + (min === m ? ' on' : '')} onClick={() => setMin(m)}>
              ≥ {m} 部
            </button>
          ))}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th className="rank">No.</th><th>CV</th>
              <th style={{ width: '34%' }}>听完的剧</th>
              <th className="num">听完</th><th className="num">均分</th>
            </tr>
          </thead>
          <tbody>
            {(rank ?? []).map((c, i) => (
              <tr key={c.id} onClick={() => setCv(c.name)} style={{ cursor: 'pointer' }}>
                <td className={'rank' + (i < 3 ? ' top' : '')}>{String(i + 1).padStart(2, '0')}</td>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td><div className="bar" style={{ width: `${(c.drama_count / max) * 100}%` }} /></td>
                <td className="num">{c.drama_count}</td>
                <td className="num">{c.avg_rating ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Folder>
    </>
  );
}

// ── 年度汇总 ─────────────────────────────────────────────

export function History({ onOpen, version }: P) {
  const { data: years } = useFetch<YearStat[]>('/api/years', [version]);
  // 标签既可以是「近 N 天」，也可以是某一年
  const [pick, setPick] = useState('recent:30');
  const list = years ?? [];

  const isRecent = pick.startsWith('recent:');
  const days = isRecent ? Number(pick.slice(7)) : 0;
  const { data: recent } = useFetch<Drama[]>(
    `/api/views/recent?days=${days || 30}`, [version, days]
  );

  const tabs = [
    { key: 'recent:30', label: '近 30 天', n: undefined, tone: 3 },
    { key: 'recent:90', label: '近 90 天', n: undefined, tone: 1 },
    ...list.map((y, i) => ({
      key: y.year, label: `${y.year} 年`, n: y.count, tone: (i % 4) + 2,
    })),
  ];

  return (
    <>
      <Head
        kicker="History"
        title="听完的剧"
      />
      <TabbedFolder
        tabs={tabs}
        active={pick}
        onSelect={setPick}
        count={isRecent ? recent?.length : list.find(y => y.year === pick)?.count}
      >
        {isRecent
          ? <Gallery
              dramas={recent ?? []} onOpen={onOpen} wide
              empty={`近 ${days} 天没有听完的剧`}
            />
          : <YearReport year={pick} version={version} onOpen={onOpen} bare />}
      </TabbedFolder>
    </>
  );
}

// ── 剧集库（筛选面板 + 手动录入）─────────────────────────

const emptyForm = {
  title: '', platform: '漫播', kind: '广播剧', status: '', cvNames: '',
  total_episodes: '', rating: '', purchased: true,
};

export function Library({
  onOpen, version, onChanged,
}: P & { onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('purchased');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  // 改筛选或排序就回到第一页 —— 不然会停在一个空页上
  useEffect(() => { setPage(1); }, [filters, sort]);

  const params = new URLSearchParams(
    Object.entries({ ...filters, q, sort }).filter(([, v]) => v) as [string, string][]
  );
  params.set('page', String(page));

  const submit = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api.create({
        title: form.title.trim(),
        platform: form.platform as Drama['platform'],
        kind: form.kind as Drama['kind'],
        status: (form.status || null) as Drama['status'],
        purchased: form.purchased,
        total_episodes: form.total_episodes ? Number(form.total_episodes) : null,
        rating: form.rating ? Number(form.rating) : null,
        cvNames: form.cvNames.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      });
      setForm(emptyForm);
      setAdding(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Head
        kicker="Archive"
        title="剧集库"
      />

      <div className="toolbar">
        <input
          className="input search" placeholder="搜剧名…"
          value={q} onChange={e => setQ(e.target.value)}
        />
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="purchased">最新购入</option>
          <option value="updated">最近修改</option>
          <option value="rating">评分</option>
          <option value="finished">听完日期</option>
          <option value="title">剧名</option>
        </select>
        <button className="btn primary" onClick={() => setAdding(a => !a)}>
          {adding ? '取消' : '+ 手动录入'}
        </button>
      </div>

      {adding && (
        <div style={{ border: '1px solid var(--rule)', padding: 16, marginBottom: 22 }}>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <input
              className="input" placeholder="剧名（必填）" style={{ minWidth: 190 }}
              value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            />
            <select className="select" value={form.platform}
              onChange={e => setForm({ ...form, platform: e.target.value })}>
              {['漫播', '猫耳', '其他'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="select" value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value })}>
              {['广播剧', '听书', '其他'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="select" value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="">收听状态</option>
              {['在听', '听完', '想听', '囤着', '搁置', '弃了'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <input
              className="input" placeholder="主役 CV，逗号分隔" style={{ minWidth: 210 }}
              value={form.cvNames} onChange={e => setForm({ ...form, cvNames: e.target.value })}
            />
            <input
              className="input" type="number" placeholder="总集数" style={{ width: 92 }}
              value={form.total_episodes}
              onChange={e => setForm({ ...form, total_episodes: e.target.value })}
            />
            <input
              className="input" type="number" step={0.05} placeholder="评分" style={{ width: 84 }}
              value={form.rating} onChange={e => setForm({ ...form, rating: e.target.value })}
            />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={form.purchased}
                onChange={e => setForm({ ...form, purchased: e.target.checked })} />
              已购买
            </label>
            <button className="btn primary" onClick={submit} disabled={saving || !form.title.trim()}>
              {saving ? '保存中' : '添加'}
            </button>
          </div>
          <div className="mono" style={{ textTransform: 'none' }}>
            手动录入的剧不会被猫耳同步覆盖。封面可以在详情里上传。
          </div>
        </div>
      )}

      <div className="with-facets">
        <Facets value={filters} onChange={setFilters} version={version} />
        <div>
          <Async<DramaPage> path={`/api/dramas?${params}`} version={version}>
            {d => (
              <>
                <div className="mono" style={{ marginBottom: 14 }}>
                  {d.total} 件档案{d.pages > 1 && ` · 第 ${d.page} / ${d.pages} 页`}
                </div>
                <Gallery dramas={d.items} onOpen={onOpen} empty="没有匹配的剧" />
                {d.pages > 1 && (
                  <Pager page={d.page} pages={d.pages} total={d.total} onGo={setPage} />
                )}
              </>
            )}
          </Async>
        </div>
      </div>
    </>
  );
}
