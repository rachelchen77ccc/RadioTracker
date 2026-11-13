import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Drama } from '../types';

export function MissevanImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (drama: Drama) => void;
}) {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!id.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importMissevan(id.trim());
      onImported(result.drama);
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={() => !busy && onClose()} />
      <div className="modal sync" role="dialog" aria-modal="true" aria-labelledby="missevan-import-title">
        <button className="close" onClick={onClose} disabled={busy} aria-label="关闭">×</button>

        <div className="mono" style={{ marginBottom: 14 }}>MANUAL IMPORT // 猫耳剧集</div>
        <h2 id="missevan-import-title" style={{ margin: '0 0 6px', fontSize: 20 }}>
          按剧集 ID 添加
        </h2>
        <p style={{ margin: '0 0 20px', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.7 }}>
          输入猫耳剧集页面中的数字 ID，自动补齐剧名、CV、标签、集数和封面。
          新添加的剧会进入已购列表最前面。这个入口只在你点击时运行，不需要猫耳登录，也不会自动刷新其他剧集。
        </p>

        <form onSubmit={submit}>
          <div className="auth-field">
            <label htmlFor="missevan-drama-id">猫耳剧集 ID</label>
            <div className="code-input-row">
              <input
                id="missevan-drama-id"
                className="input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="例如：9888"
                value={id}
                onChange={event => setId(event.target.value.replace(/\D/g, ''))}
                disabled={busy}
                autoFocus
              />
              <button className="btn primary" type="submit" disabled={busy || !id.trim()}>
                {busy ? '正在抓取…' : '抓取并添加'}
              </button>
            </div>
          </div>
        </form>

        <div className="mono" style={{ marginTop: 12, textTransform: 'none', lineHeight: 1.7 }}>
          页面地址形如 missevan.com/mdrama/9888，最后的 9888 就是剧集 ID。
        </div>
        {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
      </div>
    </>
  );
}
