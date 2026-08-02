import { useEffect, useRef, useState } from 'react';
import { api, useFetch } from '../api';
import { Tape } from './DramaCard';
import { STATUSES, type Drama } from '../types';
import { TabbedFolder, type FolderTab } from './TabbedFolder';

/**
 * 已购 / 收藏两个主入口共用的卡片墙。
 *
 * 跟普通 Gallery 的区别：状态按钮直接印在卡片上，点一下就标完。
 * 同步完进来的新剧，一部一次点击就归位，不用开抽屉。
 *
 * 列表**不跟着状态变化重新拉取** —— 标完一部就重排的话，卡片当场消失、
 * 后面的整片往上跳，连着标几十部没法看。标过的原地留着并变淡。
 */

const LABEL: Record<string, string> = { __none__: '未标记' };

const SORTS = [
  { key: 'todo',     label: '未标记优先' },
  { key: 'newest',   label: '最新 → 最旧' },
  { key: 'oldest',   label: '最旧 → 最新' },
  { key: 'rating',   label: '评分' },
  { key: 'title',    label: '剧名' },
  { key: 'episodes', label: '集数' },
  { key: 'custom',   label: '自定义（可拖）' },
] as const;

type Page = { total: number; page: number; pageSize: number; pages: number; items: Drama[] };

export function StatusGallery({
  path, countsPath, onOpen, version, emptyText,
}: {
  path: string;
  countsPath: string;
  onOpen: (d: Drama) => void;
  /** 外部数据变了就 +1，用来触发重拉 */
  version: number;
  emptyText: string;
}) {
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('todo');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(60);

  // 自定义排序时在本地先动，拖完再一次性提交，不然每拖一格都要等一次网络
  const [order, setOrder] = useState<Drama[] | null>(null);
  const dragId = useRef<number | null>(null);

  const q = new URLSearchParams({ sort, page: String(page), pageSize: String(pageSize) });
  if (status) q.set('status', status);

  const { data, loading, error, reload } = useFetch<Page>(`${path}?${q}`, [version]);
  const { data: counts } = useFetch<{ value: string; n: number }[]>(countsPath, [version]);

  // 换筛选/排序/页码时清掉本地拖拽副本
  useEffect(() => { setOrder(null); }, [status, sort, page, pageSize]);
  useEffect(() => { setPage(1); }, [status, sort, pageSize]);

  const rows = order ?? data?.items ?? [];
  const totalAll = (counts ?? []).reduce((n, c) => n + c.n, 0);

  // 标签舌 = 状态筛选。空的状态不出标签，免得一排全是 0。
  // 色位跟状态一一对应，翻到哪一层颜色都固定。
  const TONE: Record<string, number> = {
    '': 0, __none__: 4, 在听: 3, 听完: 2, 想听: 1, 囤着: 4, 搁置: 0, 弃了: 5,
  };
  const tabs: FolderTab[] = [
    { key: '', label: '全部', n: totalAll, tone: TONE[''] },
    ...['__none__', ...STATUSES]
      .map(k => ({
        key: k,
        label: LABEL[k] ?? k,
        n: counts?.find(c => c.value === k)?.n ?? 0,
        tone: TONE[k] ?? 0,
      }))
      .filter(t => t.n > 0),
  ];
  const canDrag = sort === 'custom';

  const onDrop = (targetId: number) => {
    const from = dragId.current;
    dragId.current = null;
    if (from == null || from === targetId) return;
    const list = [...rows];
    const fi = list.findIndex(d => d.id === from);
    const ti = list.findIndex(d => d.id === targetId);
    if (fi < 0 || ti < 0) return;
    list.splice(ti, 0, list.splice(fi, 1)[0]);
    setOrder(list);
  };

  const saveOrder = async () => {
    if (!order || !data) return;
    // offset 让翻页之后的次序也能接上：第 2 页的第一部排在第 1 页最后一部之后
    await api.reorder(order.map(d => d.id), (data.page - 1) * data.pageSize);
    setOrder(null);
    reload();
  };

  return (
    <>
      <div className="toolbar">
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}>
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="select" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
          {[30, 60, 120, 200].map(n => <option key={n} value={n}>每页 {n}</option>)}
        </select>
        {canDrag && (
          order
            ? <button className="btn primary" onClick={saveOrder}>保存顺序</button>
            : <span className="hint">拖动卡片调整顺序</span>
        )}
        <button className="btn" onClick={() => { setOrder(null); reload(); }}>刷新</button>
      </div>

      {loading && <div className="empty-state">— 读取中 —</div>}
      {error && <div className="error">出错了：{error}</div>}
      {!loading && !rows.length && <div className="empty-state">— {emptyText} —</div>}

      <TabbedFolder
        tabs={tabs}
        active={status}
        onSelect={setStatus}
        count={data?.total}
        note={data && data.pages > 1 ? `第 ${data.page} / ${data.pages} 页` : undefined}
      >
      <div className="gallery mark">
        {rows.map(d => {
          const current = d.status;
          return (
            <div
              className={'card' + (canDrag ? ' draggable' : '')}
              data-status={current ?? undefined}
              key={d.id}
              draggable={canDrag}
              onDragStart={() => { dragId.current = d.id; }}
              onDragOver={e => canDrag && e.preventDefault()}
              onDrop={() => canDrag && onDrop(d.id)}
            >
              <div className="cover" onClick={() => onOpen(d)} style={{ cursor: 'pointer' }}>
                {d.cover
                  ? <img src={d.cover} alt="" loading="lazy" />
                  : <div className="placeholder">NO COVER</div>}
              </div>

              <div className="filerow">
                <span>{d.platform === '猫耳' ? 'MEV' : d.platform === '漫播' ? 'MBO' : 'ETC'}</span>
                <span>·</span>
                <span>{String(d.id).padStart(3, '0')}</span>
                {d.rating != null && <span className="score">{d.rating.toFixed(1)}</span>}
              </div>

              <div className="body">
                <div className="title" onClick={() => onOpen(d)} style={{ cursor: 'pointer' }}>
                  {d.title}
                  {current && <span className={`tag s-${current}`}>{current}</span>}
                </div>
                {(() => {
                  const main = d.cvs.filter(c => c.role_type === '主役');
                  return main.length > 0 && <div className="cv">{main.map(c => c.name).join(' · ')}</div>;
                })()}
                <Tape heard={d.heard_episodes} total={d.total_episodes} />

              </div>
            </div>
          );
        })}
      </div>
      </TabbedFolder>

      {data && data.pages > 1 && (
        <Pager page={data.page} pages={data.pages} total={data.total} onGo={setPage} />
      )}
    </>
  );
}

/** 页码条：首尾和当前页附近always显示，中间折成省略号 */
export function Pager({
  page, pages, total, onGo,
}: { page: number; pages: number; total: number; onGo: (p: number) => void }) {
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="pager">
      <button className="btn" disabled={page <= 1} onClick={() => onGo(page - 1)}>← 上一页</button>
      {nums.map((n, i) =>
        n === '…'
          ? <span key={`gap${i}`} className="gap">…</span>
          : <button
              key={n}
              className={'pg' + (n === page ? ' on' : '')}
              onClick={() => onGo(n)}
            >{n}</button>
      )}
      <button className="btn" disabled={page >= pages} onClick={() => onGo(page + 1)}>下一页 →</button>
      <span className="hint" style={{ marginLeft: 'auto' }}>共 {total} 部 · {pages} 页</span>
    </div>
  );
}
