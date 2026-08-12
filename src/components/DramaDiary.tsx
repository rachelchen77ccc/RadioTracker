import { useEffect, useState } from 'react';
import { api } from '../api';
import { renderDiaryShareCard } from '../diaryShareCard';
import type { DiaryEntry, Drama } from '../types';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
type EntryDraft = Pick<DiaryEntry, 'entry_date' | 'episode_label' | 'content'>;

export function DramaDiary({ drama, onClose }: { drama: Drama; onClose: () => void }) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>({ entry_date: today(), episode_label: '', content: '' });
  const [editing, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await api.diary(drama.id));
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [drama.id]);
  useEffect(() => () => { if (share) URL.revokeObjectURL(share); }, [share]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (share) setShare(null); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [share, onClose]);

  const add = async () => {
    if (!draft.content.trim()) return;
    setBusy('add');
    try {
      const saved = await api.addDiary(drama.id, { ...draft, content: draft.content.trim() });
      setEntries(current => [saved, ...current]);
      setDraft({ entry_date: today(), episode_label: '', content: '' });
    } catch (e) {
      alert('保存失败：' + String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const beginEdit = (entry: DiaryEntry) => {
    setEditing(entry.id);
    setEditDraft({ entry_date: entry.entry_date, episode_label: entry.episode_label, content: entry.content });
  };

  const saveEdit = async () => {
    if (editing == null || !editDraft?.content.trim()) return;
    setBusy(`edit-${editing}`);
    try {
      const saved = await api.updateDiary(drama.id, editing, { ...editDraft, content: editDraft.content.trim() });
      setEntries(current => current.map(entry => entry.id === saved.id ? saved : entry));
      setEditing(null);
      setEditDraft(null);
    } catch (e) {
      alert('保存失败：' + String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: DiaryEntry) => {
    if (!window.confirm(`删除 ${entry.entry_date} 的这条日记吗？`)) return;
    setBusy(`delete-${entry.id}`);
    try {
      await api.removeDiary(drama.id, entry.id);
      setEntries(current => current.filter(item => item.id !== entry.id));
    } catch (e) {
      alert('删除失败：' + String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const makeShare = async () => {
    setBusy('share');
    try {
      const blob = await renderDiaryShareCard(drama, entries);
      if (share) URL.revokeObjectURL(share);
      setShare(URL.createObjectURL(blob));
    } catch (e) {
      alert('生成失败：' + String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    if (!share) return;
    const anchor = document.createElement('a');
    anchor.href = share;
    anchor.download = `${drama.title.replace(/[\\/:*?"<>|]/g, '_')}-听剧日记.png`;
    anchor.click();
  };

  return (
    <>
      <div className="diary-backdrop" onClick={onClose} />
      <section className="diary-modal" role="dialog" aria-modal="true" aria-label={`${drama.title}的听剧日记`}>
        <button className="close" onClick={onClose} aria-label="关闭听剧日记">×</button>
        <header className="diary-head">
          <div className="diary-polaroid">
            {drama.cover ? <img src={drama.cover} alt={drama.title} /> : <div className="no-cover">暂无封面</div>}
            <span>{drama.title}</span>
          </div>
          <div>
            <div className="mono">听剧手记 // 私人记录</div>
            <h2>听剧日记</h2>
            <p>把当下的情绪、喜欢的台词，或者听到某一集时突然冒出来的念头留在这里。</p>
            <div className="diary-head-actions">
              <span className="mono">{entries.length} 则记录</span>
              <button className="btn" onClick={makeShare} disabled={!entries.length || busy === 'share'}>
                {busy === 'share' ? '生成中' : '分享长图'}
              </button>
            </div>
          </div>
        </header>

        <div className="diary-compose">
          <div className="diary-compose-meta">
            <label>日期<input className="input" type="date" value={draft.entry_date}
              onChange={event => setDraft({ ...draft, entry_date: event.target.value })} /></label>
            <label>听到哪<input className="input" value={draft.episode_label ?? ''} placeholder="例如：第 7 集"
              onChange={event => setDraft({ ...draft, episode_label: event.target.value })} /></label>
          </div>
          <textarea className="input" value={draft.content} placeholder="今天听到这里，我想记下……"
            onChange={event => setDraft({ ...draft, content: event.target.value })} />
          <button className="btn primary" onClick={add} disabled={!draft.content.trim() || busy === 'add'}>
            {busy === 'add' ? '保存中' : '记下这一条'}
          </button>
        </div>

        <div className="diary-list">
          {loading && <div className="empty-state">— 正在翻日记 —</div>}
          {error && <div className="error">日记读取失败：{error} <button className="btn" onClick={load}>重试</button></div>}
          {!loading && !error && !entries.length && (
            <div className="diary-empty">第一条碎碎念，会从这里开始。</div>
          )}
          {entries.map(entry => (
            <article className="diary-entry" key={entry.id}>
              {editing === entry.id && editDraft ? (
                <>
                  <div className="diary-compose-meta">
                    <label>日期<input className="input" type="date" value={editDraft.entry_date}
                      onChange={event => setEditDraft({ ...editDraft, entry_date: event.target.value })} /></label>
                    <label>听到哪<input className="input" value={editDraft.episode_label ?? ''}
                      onChange={event => setEditDraft({ ...editDraft, episode_label: event.target.value })} /></label>
                  </div>
                  <textarea className="input" value={editDraft.content}
                    onChange={event => setEditDraft({ ...editDraft, content: event.target.value })} />
                  <div className="diary-entry-actions">
                    <button className="btn primary" onClick={saveEdit} disabled={busy === `edit-${entry.id}`}>保存修改</button>
                    <button className="btn" onClick={() => { setEditing(null); setEditDraft(null); }}>取消</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="diary-entry-date">
                    <time>{entry.entry_date.replaceAll('-', '.')}</time>
                    {entry.episode_label && <span>{entry.episode_label}</span>}
                  </div>
                  <p>{entry.content}</p>
                  <div className="diary-entry-actions">
                    <button className="text-btn" onClick={() => beginEdit(entry)}>修改</button>
                    <button className="text-btn danger-text" disabled={busy === `delete-${entry.id}`} onClick={() => remove(entry)}>删除</button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      {share && (
        <div className="share-backdrop diary-share-preview" onClick={() => setShare(null)}>
          <div className="share-box" onClick={event => event.stopPropagation()}>
            <div className="head">
              <span className="t">听剧日记长图</span>
              <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={download}>下载 PNG</button>
              <button className="btn" onClick={() => setShare(null)}>关闭</button>
            </div>
            <div className="scroll"><img src={share} alt={`${drama.title}听剧日记分享长图`} /></div>
          </div>
        </div>
      )}
    </>
  );
}
