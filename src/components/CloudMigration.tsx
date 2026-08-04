import { useState } from 'react';
import { appFetch } from '../cloud/supabase';

type Result = { dramas: number; cvs: number; links: number; covers: number };

export function CloudMigration() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const importData = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const bundle = JSON.parse(await file.text());
      const response = await appFetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '导入失败');
      setResult(payload);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cloud-migration">
      <div className="mono">CLOUD // 首次迁移</div>
      <h1>把本地档案搬到网页</h1>
      <p>只在第一次部署时使用。迁移包不会包含猫耳登录 Cookie。</p>
      {!result ? (
        <>
          <label className="migration-file">
            <span>{file ? file.name : '选择本地迁移包'}</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={event => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <button className="btn primary big" disabled={!file || busy} onClick={importData}>
            {busy ? '正在迁移，请不要关闭页面…' : '开始迁移'}
          </button>
        </>
      ) : (
        <div className="migration-success">
          <h2>迁移完成</h2>
          <p>{result.dramas} 部剧 · {result.cvs} 位 CV · {result.links} 条关联 · {result.covers} 张本地封面</p>
          <a className="btn primary" href="/">进入我的档案柜</a>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
