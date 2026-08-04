import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useFetch } from './api';
import { DramaDrawer } from './components/DramaDrawer';
import { SyncPanel } from './components/SyncPanel';
import { CloudMigration } from './components/CloudMigration';
import { SignOutButton } from './components/AuthGate';
import { appFetch } from './cloud/supabase';
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
  const [sync, setSync] = useState(false);
  const [version, setVersion] = useState(0);
  const { data: stats } = useFetch<Stats>('/api/stats', [version]);

  const bump = () => setVersion(v => v + 1);
  let no = 0;

  /*
   * 侧栏按钮要能显示后台同步的进度，所以这里也轮询一下 ——
   * 但只在真的有任务在跑的时候才高频轮询，闲着的时候 20 秒一次。
   */
  const [syncing, setSyncing] = useState<{ running: boolean; step: string | null }>(
    { running: false, step: null }
  );
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await appFetch('/api/sync/status').then(r => r.json());
        if (!alive) return;
        setSyncing(prev => {
          if (prev.running && !j.running) bump();   // 刚跑完，刷一次数据
          return { running: j.running, step: j.step };
        });
        timer = setTimeout(tick, j.running ? 1500 : 20000);
      } catch {
        timer = setTimeout(tick, 20000);
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

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
          className={'sync-btn' + (syncing.running ? ' running' : '')}
          onClick={() => setSync(true)}
          title={syncing.running ? `同步中：${syncing.step ?? ''}` : '拉取猫耳最新数据'}
        >
          <span className="ic">⟳</span>
          <span>{syncing.running ? (syncing.step ?? '同步中') : '自动更新'}</span>
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

      {sync && (
        <SyncPanel onClose={() => setSync(false)} onDone={bump} autoStart />
      )}

      {open && (
        <DramaDrawer
          drama={open}
          onClose={() => setOpen(null)}
          onSaved={d => { setOpen(d); bump(); }}
          onDeleted={() => { setOpen(null); bump(); }}
        />
      )}
    </div>
  );
}
