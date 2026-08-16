import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useFetch } from './api';
import { DramaDrawer } from './components/DramaDrawer';
import { SyncPanel } from './components/SyncPanel';
import { CloudMigration } from './components/CloudMigration';
import { SignOutButton } from './components/AuthGate';
import { appFetch, githubPagesMode } from './cloud/supabase';
import { refreshStaticData } from './cloud/staticApi';
import { pendingMissevanCookie } from './cloud/missevanConnect';
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
  const [firstRun, setFirstRun] = useState(false);
  const [missevanSession, setMissevanSession] = useState<{ hasSession: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const { data: stats } = useFetch<Stats>('/api/stats', [version]);
  const onboardingOpened = useRef(false);
  const incomingMissevanConnect = useRef(Boolean(pendingMissevanCookie()));

  const bump = () => setVersion(v => v + 1);
  let no = 0;

  const loadMissevanSession = () => {
    if (githubPagesMode) {
      setMissevanSession({ hasSession: true });
      return;
    }
    appFetch('/api/sync/session')
      .then(response => response.json())
      .then(setMissevanSession)
      .catch(() => {});
  };

  useEffect(() => { loadMissevanSession(); }, []);

  useEffect(() => {
    if (!stats || !missevanSession || onboardingOpened.current) return;
    if (incomingMissevanConnect.current || stats.total === 0) {
      onboardingOpened.current = true;
      setFirstRun(stats.total === 0);
      setSync(true);
    }
  }, [stats, missevanSession]);

  /*
   * 侧栏按钮要能显示后台同步的进度，所以这里也轮询一下 ——
   * 但只在真的有任务在跑的时候才高频轮询，闲着的时候 20 秒一次。
   */
  const [syncing, setSyncing] = useState<{ running: boolean; step: string | null }>(
    { running: false, step: null }
  );
  useEffect(() => {
    if (githubPagesMode) return;
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

  const openSync = () => {
    if (!githubPagesMode) {
      setSync(true);
      return;
    }
    refreshStaticData();
    bump();
    window.alert('已重新读取云端档案。猫耳内容由 GitHub 每 6 小时在后台自动同步。');
  };

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
          onClick={openSync}
          title={githubPagesMode ? '重新读取 Supabase 云端档案' : syncing.running ? `同步中：${syncing.step ?? ''}` : '拉取猫耳最新数据'}
        >
          <span className="ic">⟳</span>
          <span>{githubPagesMode ? '刷新云端数据' : syncing.running ? (syncing.step ?? '同步中') : '自动更新'}</span>
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
        {!githubPagesMode && stats?.total === 0 && (
          <div className="first-run-banner">
            <div>
              <div className="mono">FIRST SETUP</div>
              <strong>关联猫耳，导入你的已购和追剧</strong>
              <span>同步后就可以逐个标记收听状态。</span>
            </div>
            <button className="btn primary" onClick={() => { setFirstRun(true); setSync(true); }}>
              开始关联
            </button>
          </div>
        )}
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

      {!githubPagesMode && sync && (
        <SyncPanel
          onClose={() => { setSync(false); setFirstRun(false); }}
          onDone={() => { bump(); loadMissevanSession(); }}
          autoStart
          firstRun={firstRun}
        />
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
