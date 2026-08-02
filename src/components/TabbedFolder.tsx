/**
 * 多标签档案夹：顶上一排切角标签舌，点标签 = 切筛选。
 *
 * 选中的那只标签跟夹子体同色、连成一片（视觉上「抽出来的就是这一层」），
 * 没选中的往下沉一点、颜色压暗。
 *
 * 颜色用收听状态各自的色 —— 标签本身就是状态筛选，所以标签色 = 状态色，
 * 不需要另外记一套对应关系。
 */
export type FolderTab = {
  key: string;
  label: string;
  n?: number;
  /** 色板序号 0..5，不给就按下标取 */
  tone?: number;
};

export function TabbedFolder({
  tabs, active, onSelect, count, note, children,
}: {
  tabs: FolderTab[];
  active: string;
  onSelect: (key: string) => void;
  count?: number;
  note?: string;
  children: React.ReactNode;
}) {
  const activeIdx = Math.max(0, tabs.findIndex(t => t.key === active));
  const activeTone = tabs[activeIdx]?.tone ?? activeIdx % 6;

  return (
    <section className="tfolder" data-tone={activeTone}>
      <div className="tfolder-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            className={'tfolder-tab' + (t.key === active ? ' on' : '')}
            data-tone={t.tone ?? i % 6}
            onClick={() => onSelect(t.key)}
            title={t.label}
          >
            <span className="no">{String(i + 1).padStart(2, '0')}</span>
            <span className="lb">{t.label}</span>
            {t.n != null && <span className="n">{t.n}</span>}
          </button>
        ))}
      </div>

      <div className="tfolder-body">
        {count != null && <span className="tfolder-count">{count} 件</span>}
        {note && <p className="folder-note">{note}</p>}
        {children}
      </div>
    </section>
  );
}
