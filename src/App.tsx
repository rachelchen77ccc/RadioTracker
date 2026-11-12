import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useFetch } from './api';
import { DramaDrawer } from './components/DramaDrawer';
import { MissevanImport } from './components/MissevanImport';
import { CloudMigration } from './components/CloudMigration';
import { SignOutButton } from './components/AuthGate';
import type { Drama, Stats } from './types';
import {
  Collection, Cv, History, Home, Library, Lists, Purchased, Rewatch,
} from './pages';

/**
 * 框架就是猫耳那两类数据：已购 / 收藏。
 * 收听状态在这两页里标，标成「在听」的进第 ③ 页看日历，
 * 听完的进「听完的剧」归档。其余都是回看用的。
 *
 * 侧栏是一柜挂耳档案夹，每组一个纸板色，选中的往右抽出来。
 */
type NavItem = {
  to: string; text: string; end?: boolean;
  badge?: (s: Stats) => number;
};

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: '猫耳',
    items: [
      { to: '/', end: true, text: '我的已购', badge: s => s.purchasedTodo },
      { to: '/collection', text: '我的收藏', badge: s => s.collectionTodo },
    ],
  },
  {
    label: '在听',
    items: [
      { to: '/now', text: '正在听', badge: s => s.listening },
      { to: '/rewatch', text: '重刷', badge: s => s.rewatchQueue },
    ],
  },
  {
    label: '回顾',
    items: [
      { to: '/history', text: '听完的剧' },
      { to: '/lists', text: '剧单榜单' },
    ],
  },
  {
    label: '统计',
    items: [
      { to: '/cv', text: 'CV' },
      { to: '/library', text: '档案库' },
    ],
  },
];

export function App() {
  if (window.location.pathname === '/cloud-migration') return <CloudMigration />;

  const [open, setOpen] = useState<Drama | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const { data: stats } = useFetch<Stats>('/api/stats', [version]);

  const bump = () => setVersion(v => v + 1);
  let no = 0;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">听剧<br />档案柜</div>
        <div className="brand-sub">
          {stats
            ? <>ARCHIVE {stats.total} FILES<br />REPO {stats.reviews}</>
            : <>&nbsp;</>}
        </div>

        <button
          className="sync-btn"
          onClick={() => setImportOpen(true)}
          title="输入猫耳剧集 ID，抓取资料和封面"
        >
          <span className="ic">＋</span>
          <span>按 ID 添加</span>
        </button>

        {NAV.map(group => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map(it => {
              const n = stats && it.badge ? it.badge(stats) : 0;
              no += 1;
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                >
                  <span className="idx">{String(no).padStart(2, '0')}</span>
                  <span>{it.text}</span>
                  {!!n && <span className="count">{n}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
        <SignOutButton />
      </nav>

      <main className="main">
        <Routes>
          <Route path="/"           element={<Purchased onOpen={setOpen} version={version} />} />
          <Route path="/collection" element={<Collection onOpen={setOpen} version={version} />} />
          <Route path="/now"        element={<Home onOpen={setOpen} version={version} />} />
          <Route path="/rewatch"    element={<Rewatch onOpen={setOpen} version={version} />} />
          <Route path="/history"    element={<History onOpen={setOpen} version={version} />} />
          <Route path="/lists"      element={<Lists onOpen={setOpen} version={version} />} />
          <Route path="/cv"         element={<Cv onOpen={setOpen} version={version} />} />
          <Route path="/library"    element={<Library onOpen={setOpen} version={version} onChanged={bump} />} />
        </Routes>
      </main>

      {importOpen && (
        <MissevanImport
          onClose={() => setImportOpen(false)}
          onImported={drama => {
            setImportOpen(false);
            setOpen(drama);
            bump();
          }}
        />
      )}

      {open && (
        <DramaDrawer
          drama={open}
          onClose={() => setOpen(null)}
          onSaved={() => bump()}
          onDeleted={() => { setOpen(null); bump(); }}
        />
      )}
    </div>
  );
}
