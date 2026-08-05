import { useEffect, useRef, useState } from 'react';
import { appFetch } from '../cloud/supabase';
import {
  clearPendingMissevanCookie,
  pendingMissevanCookie,
} from '../cloud/missevanConnect';
import { verifyMissevanCaptcha } from '../cloud/missevanLogin';

/**
 * 同步面板。
 *
 * 存过登录态之后就只有一个按钮 —— 拉列表、合并、补详情、缓存封面全在服务端跑。
 * 第一次通过猫耳的手机号、滑块和短信验证码建立登录态。
 *
 * 云端会加密存入当前网页账号自己的凭据记录；接口只回「有没有」，
 * 从不把 cookie 原文传回浏览器。
 */

type Job = {
  running: boolean;
  step: string | null;
  log: string[];
  error: string | null;
  expired?: boolean;
  finishedAt: string | null;
};

type Session = { hasSession: boolean; userId: string | null; savedAt: string | null };

export function SyncPanel({
  onClose, onDone, autoStart, firstRun = false,
}: {
  onClose: () => void;
  onDone: () => void;
  /** 侧栏按钮点进来的：有凭据就直接开跑，不用再点一次 */
  autoStart?: boolean;
  /** 新账号第一次进入：显示完整引导，关联后立即跑首次同步 */
  firstRun?: boolean;
}) {
  const incomingCookie = useRef(pendingMissevanCookie());
  const [job, setJob] = useState<Job | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [cookie, setCookie] = useState(incomingCookie.current);
  const [userId, setUserId] = useState('');
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(Boolean(incomingCookie.current));
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [loginState, setLoginState] = useState('');
  const [loginStep, setLoginStep] = useState<'phone' | 'code'>('phone');
  const [countdown, setCountdown] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const doneRef = useRef<string | null>(null);

  const loadSession = () =>
    appFetch('/api/sync/session').then(r => r.json()).then(setSession).catch(() => {});

  useEffect(() => { loadSession(); }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setTimeout(() => setCountdown(value => value - 1), 1000);
    return () => window.clearTimeout(id);
  }, [countdown]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const j: Job = await appFetch('/api/sync/status').then(r => r.json());
        if (!alive) return;
        setJob(j);
        // 只在「这一轮刚跑完」时刷一次外面的数据，别每次轮询都刷
        if (!j.running && j.finishedAt && doneRef.current !== j.finishedAt) {
          doneRef.current = j.finishedAt;
          onDone();
        }
      } catch { /* 服务端在重启，下次再说 */ }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => { alive = false; clearInterval(id); };
  }, [onDone]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log.length]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const saveSession = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await appFetch('/api/sync/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie, userId }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? '存不下'); return; }
      clearPendingMissevanCookie();
      setCookie(''); setUserId(''); setSetup(false);
      await loadSession();
    } finally {
      setBusy(false); setAutoConnecting(false);
    }
  };

  const consumedIncomingCookie = useRef(false);
  useEffect(() => {
    if (consumedIncomingCookie.current || !incomingCookie.current || !session) return;
    consumedIncomingCookie.current = true;
    saveSession();
    // 只消费从猫耳书签跳回来的那一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const forget = async () => {
    await appFetch('/api/sync/session', { method: 'DELETE' });
    await loadSession();
  };

  const start = async () => {
    setErr(null);
    const res = await appFetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? '起不来');
  };

  const responseJson = async (response: Response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '猫耳登录暂时不可用');
    return payload;
  };

  const sendSmsCode = async () => {
    const normalizedPhone = phone.replace(/\s+/g, '');
    if (!/^\d{6,20}$/.test(normalizedPhone)) {
      setErr('请输入正确的手机号');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const challenge = await responseJson(await appFetch('/api/sync/missevan-login/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }));
      const captchaToken = await verifyMissevanCaptcha(challenge);
      const result = await responseJson(await appFetch('/api/sync/missevan-login/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone, captchaToken, loginState: challenge.loginState }),
      }));
      setPhone(normalizedPhone);
      setLoginState(result.loginState);
      setLoginStep('code');
      setCountdown(60);
    } catch (error) {
      setErr(String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  };

  const verifySmsCode = async () => {
    if (!/^\d{6}$/.test(smsCode.trim())) {
      setErr('请输入 6 位短信验证码');
      return;
    }
    setBusy(true); setErr(null);
    try {
      await responseJson(await appFetch('/api/sync/missevan-login/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: smsCode.trim(), loginState }),
      }));
      setSmsCode(''); setLoginState(''); setLoginStep('phone'); setSetup(false);
      await loadSession();
      await start();
    } catch (error) {
      setErr(String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  };

  const running = !!job?.running;
  const ready = !!session?.hasSession;

  // 带着 autoStart 进来、有凭据、当前没在跑 —— 直接开始，只触发一次
  const kicked = useRef(false);
  useEffect(() => {
    if (!autoStart || kicked.current) return;
    if (!session || job === null) return;      // 等状态问回来再决定
    if (!session.hasSession) return;            // 首次设置完成后再消费自动启动
    kicked.current = true;
    if (!job.running) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, session, job]);

  return (
    <>
      {/* 同步在服务端跑，关掉窗口不会打断它 —— 所以任何时候都能关 */}
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal sync" role="dialog" aria-modal="true">
        <button className="close" onClick={onClose} aria-label="关闭">×</button>

        <div className="mono" style={{ marginBottom: 14 }}>
          {firstRun ? 'WELCOME // 首次设置' : 'SYNC // 猫耳同步'}
        </div>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>
          {firstRun ? '关联你的猫耳账号' : '自动更新'}
        </h2>

        {firstRun && (
          <div className="onboarding-track">
            <span className="done">1 创建账号</span>
            <span className={ready ? 'done' : 'active'}>2 关联猫耳</span>
            <span className={job?.running ? 'active' : job?.finishedAt && !job.error ? 'done' : ''}>3 同步剧目</span>
            <span>4 标记状态</span>
          </div>
        )}

        {autoConnecting && (
          <div className="quick-connect-status">
            <span className="dot on" />
            <div>
              <strong>正在验证猫耳账号…</strong>
              <p>验证成功后会自动开始同步，不需要再操作。</p>
            </div>
          </div>
        )}

        {!autoConnecting && ready && !setup && (
          <>
            <p style={{ margin: '0 0 20px', color: 'var(--ink-2)', fontSize: 13 }}>
              {firstRun ? '账号已经关联。接下来会拉取你的已购和追剧，并补齐剧目资料。' : '拉取已购和追剧 → 合并标记 → 补新剧的 CV 分类集数 → 缓存封面。'}
              <b>随时可以关掉这个窗口</b>，同步在后台继续，侧栏按钮上能看到进度。
            </p>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn primary big" onClick={start} disabled={running}>
                {running ? '同步中…' : firstRun ? '开始首次同步' : '开始同步'}
              </button>
              {running && <button className="btn" onClick={onClose}>放后台跑</button>}
            </div>

            <div className="session-line">
              <span className="mono">凭据已保存 · 用户 {session.userId}</span>
              <button className="linkish" onClick={() => setSetup(true)}>更新</button>
              <button className="linkish" onClick={forget}>删除</button>
            </div>

            {firstRun && job?.finishedAt && !job.running && !job.error && (
              <div className="onboarding-done">
                <strong>已购和追剧已同步完成</strong>
                <span>没有确定收听状态的剧会保留六个状态按钮，之后由你逐个标记。</span>
                <button className="btn primary" onClick={onClose}>开始标记收听状态</button>
              </div>
            )}
          </>
        )}

        {!autoConnecting && (!ready || setup) && (
          <>
            <p style={{ margin: '0 0 6px', color: 'var(--ink-2)', fontSize: 13 }}>
              {firstRun
                ? '用猫耳短信验证码完成关联，成功后会立即开始第一次同步。'
                : '重新验证猫耳账号，成功后会立即继续同步。'}
            </p>
            <div className="phone-connect">
              <div className="phone-connect-head">
                <span className="recommended">推荐</span>
                <strong>手机号验证码登录</strong>
              </div>

              {loginStep === 'phone' ? (
                <>
                  <label className="auth-field">
                    <span>猫耳手机号</span>
                    <div className="phone-input-row">
                      <span className="region-code">+86</span>
                      <input
                        className="input"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="请输入手机号"
                        value={phone}
                        onChange={event => setPhone(event.target.value.replace(/[^\d\s]/g, ''))}
                        onKeyDown={event => event.key === 'Enter' && sendSmsCode()}
                      />
                    </div>
                  </label>
                  <button className="btn primary big" onClick={sendSmsCode} disabled={busy || !phone.trim()}>
                    {busy ? '正在打开安全验证…' : '获取短信验证码'}
                  </button>
                </>
              ) : (
                <>
                  <div className="code-sent">
                    验证码已发送至 +86 {phone}
                    <button className="linkish" onClick={() => { setLoginStep('phone'); setSmsCode(''); setLoginState(''); }}>
                      修改手机号
                    </button>
                  </div>
                  <label className="auth-field">
                    <span>6 位短信验证码</span>
                    <div className="code-input-row">
                      <input
                        className="input"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="请输入验证码"
                        value={smsCode}
                        onChange={event => setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        onKeyDown={event => event.key === 'Enter' && verifySmsCode()}
                        autoFocus
                      />
                      <button className="btn" onClick={sendSmsCode} disabled={busy || countdown > 0}>
                        {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
                      </button>
                    </div>
                  </label>
                  <button className="btn primary big" onClick={verifySmsCode} disabled={busy || smsCode.length !== 6}>
                    {busy ? '正在关联…' : '关联并开始同步'}
                  </button>
                </>
              )}

              <p className="privacy-note">
                手机号和验证码只用于这一次猫耳登录，不会保存；关联成功后仅加密保存猫耳会话。
              </p>
            </div>

            <details className="manual-connect">
              <summary>验证码登录暂时不可用？使用旧版手动关联</summary>
              <p className="warn">
                这段 cookie 等同于你的猫耳登录态。网页部署后会先加密再保存，
                不会发给其他用户，也不会进入 GitHub。它会过期，失效时同步会明确报错。
              </p>

              <ol className="sync-steps">
                <li>
                  <div className="t">在已登录的猫耳页面打开控制台</div>
                  <div className="d">missevan.com → F12 → Console</div>
                </li>
                <li>
                  <div className="t">运行这一行，把结果贴到下面</div>
                  <pre className="snippet">copy(document.cookie)</pre>
                </li>
              </ol>

              <textarea
                className="input"
                style={{ width: '100%', minHeight: 84, marginTop: 12, fontSize: 12 }}
                placeholder="在这里粘贴 cookie…"
                value={cookie}
                onChange={e => setCookie(e.target.value)}
              />
              {!/muid=\d+/.test(cookie) && cookie.trim() !== '' && (
                <input
                  className="input"
                  style={{ width: '100%', marginTop: 8 }}
                  placeholder="cookie 里没有 muid，请填你的猫耳用户 ID（个人主页链接里那串数字）"
                  value={userId}
                  onChange={e => setUserId(e.target.value)}
                />
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="btn primary"
                  onClick={saveSession}
                  disabled={busy || !cookie.trim()}
                >
                  {busy ? '验证中…' : firstRun ? '关联并开始同步' : '验证并保存'}
                </button>
                {setup && <button className="btn" onClick={() => setSetup(false)}>取消</button>}
              </div>
            </details>
          </>
        )}

        {err && <div className="error" style={{ marginTop: 16 }}>{err}</div>}

        {job && (job.running || job.log.length > 0) && (
          <div className="sync-progress">
            <div className="head">
              <span className={'dot' + (job.running ? ' on' : '')} />
              <span className="mono">{job.step ?? '待命'}</span>
              {job.error && <span className="err">{job.error}</span>}
              {job.expired && (
                <button className="linkish" onClick={() => setSetup(true)}>重新验证猫耳</button>
              )}
            </div>
            <pre ref={logRef} className="log">{job.log.join('\n')}</pre>
          </div>
        )}
      </div>
    </>
  );
}
