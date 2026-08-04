import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { cloudEnabled, supabase } from '../cloud/supabase';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!cloudEnabled);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const emailRedirectTo = (
    import.meta.env.NEXT_PUBLIC_SITE_URL?.trim()
    || window.location.origin
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!cloudEnabled) return children;
  if (!ready) return <div className="auth-loading mono">正在打开档案柜…</div>;
  if (session) return children;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setMessage(null);
    try {
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo },
          });
      if (result.error) throw result.error;
      if (mode === 'register' && !result.data.session) {
        setMessage('注册成功，请到邮箱确认后再登录。');
        setMode('login');
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!supabase) return;
    if (!email.trim()) {
      setMessage('请先填写注册时使用的邮箱。');
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo },
      });
      if (error) throw error;
      setMessage('确认邮件已重新发送，请使用新邮件中的链接。');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '确认邮件发送失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="mono">RADIO // PRIVATE ARCHIVE</div>
        <h1>听剧档案柜</h1>
        <p>登录后，你的已购、收藏、收听进度、评分和剧评只属于你。</p>
        <form onSubmit={submit}>
          <label>邮箱<input className="input" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>密码<input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={event => setPassword(event.target.value)} /></label>
          <button className="btn primary big" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}</button>
        </form>
        <button className="linkish auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(null); }}>
          {mode === 'login' ? '第一次使用？创建账号' : '已经有账号？返回登录'}
        </button>
        {mode === 'login' && (
          <button className="linkish auth-switch" disabled={busy} onClick={resendConfirmation}>
            账号还没确认？重新发送确认邮件
          </button>
        )}
        {message && <div className="auth-message">{message}</div>}
      </div>
    </div>
  );
}

export function SignOutButton() {
  const client = supabase;
  if (!client) return null;
  return <button className="signout linkish" onClick={() => client.auth.signOut()}>退出登录</button>;
}
