import { useState } from 'react';
import { useFetch } from '../api';
import type { Facets as FacetData } from '../types';

/**
 * 筛选面板。所有选项都来自 /api/facets —— 服务端直接从数据里数出来的，
 * 前端不维护任何枚举。你加了新分类、新社团、新 CV，这里自动就有了。
 */

/*
 * 只留这几组。题材/主役CV/社团/连载这几项选项太多又太长，
 * 侧栏塞不下也不是常用的筛法 —— 要按 CV 找剧去「CV」那页。
 */
const GROUPS: { key: string; label: string; limit: number }[] = [
  { key: 'status',   label: '收听状态', limit: 8 },
  { key: 'platform', label: '平台',     limit: 5 },
  { key: 'kind',     label: '类别',     limit: 5 },
  { key: 'year',     label: '听完年份', limit: 8 },
];

/** facet key → /api/dramas 的查询参数名 */
const PARAM: Record<string, string> = {
  status: 'status', platform: 'platform', kind: 'kind', serialize: 'serialize',
  category: 'category', cv: 'cv', organization: 'organization', year: 'year',
};

export function Facets({
  value, onChange, version,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  version: number;
}) {
  const { data } = useFetch<FacetData>('/api/facets', [version]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /**
   * 每个筛选组自己折叠：点组标题把这一组收上去。
   * 记在 localStorage —— 你嫌「主役 CV」占地方收起来之后，翻页回来还是收着的。
   */
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('facets:folded') ?? '{}'); }
    catch { return {}; }
  });

  const fold = (key: string) => {
    setFolded(f => {
      const next = { ...f, [key]: !f[key] };
      localStorage.setItem('facets:folded', JSON.stringify(next));
      return next;
    });
  };

  const toggle = (key: string, v: string) => {
    const param = PARAM[key];
    const next = { ...value };
    if (next[param] === v) delete next[param];
    else next[param] = v;
    onChange(next);
  };

  const active = Object.entries(value).filter(([, v]) => v);

  return (
    <div className="facets">
      {active.length > 0 && (
        <div className="active-filters">
          {active.map(([k, v]) => (
            <span className="pill" key={k}>
              {v}
              <button onClick={() => {
                const next = { ...value };
                delete next[k];
                onChange(next);
              }}>×</button>
            </span>
          ))}
          <button className="chip" onClick={() => onChange({})}>清空</button>
        </div>
      )}

      {GROUPS.map(g => {
        const opts = data?.[g.key] ?? [];
        if (!opts.length) return null;
        const open = expanded[g.key];
        const shown = open ? opts : opts.slice(0, g.limit);
        const param = PARAM[g.key];
        const isFolded = !!folded[g.key];
        // 这一组里有没有正在生效的筛选 —— 折起来也要能看见
        const picked = value[param];

        return (
          <div className={'facet' + (isFolded ? ' folded' : '')} key={g.key}>
            <h4 onClick={() => fold(g.key)} title={isFolded ? '展开' : '收起'}>
              <span className="chev">{isFolded ? '▸' : '▾'}</span>
              {g.label}
              {isFolded && picked && <span className="picked">{picked}</span>}
            </h4>
            {!isFolded && shown.map(o => (
              <button
                key={o.value}
                className={'opt' + (value[param] === o.value ? ' on' : '')}
                onClick={() => toggle(g.key, o.value)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.value}
                </span>
                <span className="n">{o.n}</span>
              </button>
            ))}
            {!isFolded && opts.length > g.limit && (
              <button
                className="more"
                onClick={() => setExpanded(e => ({ ...e, [g.key]: !open }))}
              >
                {open ? '收起' : `还有 ${opts.length - g.limit} 项`}
              </button>
            )}
          </div>
        );
      })}

      <div className={'facet' + (folded.rating ? ' folded' : '')}>
        <h4 onClick={() => fold('rating')} title={folded.rating ? '展开' : '收起'}>
          <span className="chev">{folded.rating ? '▸' : '▾'}</span>
          评分
          {folded.rating && value.rating_min && <span className="picked">{value.rating_min}+</span>}
        </h4>
        {!folded.rating && [5, 4.8, 4.5, 4].map(r => (
          <button
            key={r}
            className={'opt' + (value.rating_min === String(r) ? ' on' : '')}
            onClick={() => {
              const next = { ...value };
              if (next.rating_min === String(r)) delete next.rating_min;
              else next.rating_min = String(r);
              onChange(next);
            }}
          >
            <span>{r === 5 ? '五星' : `${r} 以上`}</span>
          </button>
        ))}
      </div>

    </div>
  );
}
