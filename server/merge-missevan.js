/**
 * 把猫耳的「已购 / 追剧」两个列表合并进数据库。
 *
 * 这一步只处理**需要登录态才能知道的事实**：你买了什么、你追了什么，
 * 外加猫耳记录的收听位置。剧集详情（CV / 分类 / 社团 / 集数）是公开接口，
 * 由 scripts/fetch-details.mjs 单独补 —— 那样浏览器那边几秒钟就能跑完。
 *
 * ── 合并规则（手动优先）────────────────────────────────────────
 *
 *  永不覆盖（你的判断，猫耳无权改）：
 *     status 收听状态 · heard_episodes 已听集数 · rating 评分
 *     finished_date 听完日期 · rewatch_status/rewatch_queued 重刷 · review 剧评
 *
 *  事实字段（仅限 platform='猫耳' 的剧）：
 *     subscribed 是否追剧 —— 双向同步：猫耳上取消了，这里也取消
 *     purchased  是否购买 —— 只升不降。猫耳支持单集购买，整剧不在已购列表
 *                不代表你没花过钱，所以「已购→未购」只提示、不改你的标记。
 *
 *  空缺才回填：cover_url / abstract
 *
 *  只写快照、绝不进主字段：
 *     saw_episode → sync_saw_episode（是集名文本，不是数字）
 *     —— 你说过点进去不等于听了。而且只在有值时才写，
 *        不会被后来一次没带登录态的同步抹成 null。
 *
 *  漫播 / 手动录入的剧：完全不受同步影响。
 */

/** 标题归一：去掉空白和装饰符，用来跟 Notion 来的剧名对齐 */
const norm = s =>
  (s || '')
    .replace(/[\s·・:：!！?？,，。.\-—_「」『』《》()（）【】\[\]]/g, '')
    .toLowerCase();

const nz = v => (v == null || v === '' ? null : v);

export function mergeMissevan(db, payload) {
  const boughtList = payload.boughtIds ?? (payload.bought ?? []).map(d => String(d.id));
  const subList = payload.subscriptionIds ?? (payload.subscriptions ?? []).map(d => String(d.id));
  const boughtIds = new Set(boughtList.map(String));
  const subIds = new Set(subList.map(String));
  const boughtOrder = new Map(boughtList.map((id, i) => [String(id), i]));
  const subOrder = new Map(subList.map((id, i) => [String(id), i]));
  // 新格式显式标记完整；旧导出只要同时带两份数组，也可视为完整快照。
  const listsComplete = payload.listsComplete === true ||
    (Array.isArray(payload.bought) && Array.isArray(payload.subscriptions));
  const sawEpisodes = payload.sawEpisodes ?? {};

  // 两个列表并起来当作「猫耳侧已知的全部剧」，取每部剧的基础信息
  const meta = new Map();
  for (const d of [...(payload.subscriptions ?? []), ...(payload.bought ?? [])]) {
    meta.set(String(d.id), d);
  }
  // 兼容早期带 details 的导出格式
  for (const [id, d] of Object.entries(payload.details ?? {})) {
    if (!meta.has(id)) meta.set(id, d);
  }

  const all = db.prepare('SELECT * FROM dramas').all();
  const hadOfficialSnapshot = all.some(d =>
    d.platform === '猫耳' && d.synced_at &&
    (d.sync_purchased != null || d.sync_subscribed != null)
  );
  const previousBought = new Set(all
    .filter(d => d.platform === '猫耳' && d.missevan_id && d.sync_purchased === 1)
    .map(d => String(d.missevan_id)));
  const previousSubs = new Set(all
    .filter(d => d.platform === '猫耳' && d.missevan_id && d.sync_subscribed === 1)
    .map(d => String(d.missevan_id)));
  const byMissevan = new Map(all.filter(d => d.missevan_id).map(d => [String(d.missevan_id), d]));
  const byTitle = new Map(all.filter(d => d.platform === '猫耳').map(d => [norm(d.title), d]));

  const insert = db.prepare(`
    INSERT INTO dramas (missevan_id, title, platform, source, purchased, subscribed,
                        bought_order, sub_order,
                        cover_url, abstract, sync_saw_episode, sync_purchased,
                        sync_subscribed, synced_at)
    VALUES (@missevan_id, @title, '猫耳', 'missevan', @purchased, @subscribed,
            @bought_order, @sub_order,
            @cover_url, @abstract, @saw, @purchased, @subscribed, datetime('now'))
  `);

  const stats = { added: 0, updated: 0, untouched: 0, filled: 0, unsubscribed: 0 };
  const notices = [];

  db.transaction(() => {
    for (const id of new Set([...boughtIds, ...subIds])) {
      const m = meta.get(id) ?? {};
      const purchased = boughtIds.has(id) ? 1 : 0;
      const subscribed = subIds.has(id) ? 1 : 0;
      const saw = nz(sawEpisodes[id]);

      const existing = byMissevan.get(id) ?? byTitle.get(norm(m.name));

      if (!existing) {
        if (!m.name) continue;           // 没名字就建不了，等下次导出
        insert.run({
          missevan_id: Number(id),
          title: m.name,
          purchased,
          subscribed,
          bought_order: boughtOrder.get(id) ?? null,
          sub_order: subOrder.get(id) ?? null,
          cover_url: nz(m.cover),
          abstract: nz(m.abstract),
          saw,
        });
        stats.added++;
        continue;
      }

      if (existing.platform !== '猫耳') { stats.untouched++; continue; }

      const sets = [];
      const p = { id: existing.id };

      if (!existing.purchased && purchased) {
        sets.push('purchased = 1');
        notices.push({ title: existing.title, change: '未购 → 已购（猫耳已购列表）' });
      } else if (existing.purchased && !purchased) {
        notices.push({
          title: existing.title,
          change: '你标了已购，但不在猫耳整剧已购列表里（可能是单集购买）—— 保留你的标记',
        });
      }
      if (existing.subscribed !== subscribed) {
        sets.push('subscribed = @subscribed');
        p.subscribed = subscribed;
      }
      const nextBoughtOrder = boughtOrder.get(id) ?? null;
      const nextSubOrder = subOrder.get(id) ?? null;
      if (existing.bought_order !== nextBoughtOrder) {
        sets.push('bought_order = @bought_order'); p.bought_order = nextBoughtOrder;
      }
      if (existing.sub_order !== nextSubOrder) {
        sets.push('sub_order = @sub_order'); p.sub_order = nextSubOrder;
      }
      if (!existing.missevan_id) {
        sets.push('missevan_id = @missevan_id');
        p.missevan_id = Number(id);
      }
      if (!existing.cover_url && !existing.cover_local && nz(m.cover)) {
        sets.push('cover_url = @cover_url'); p.cover_url = m.cover; stats.filled++;
      }
      if (!existing.abstract && nz(m.abstract)) {
        sets.push('abstract = @abstract'); p.abstract = m.abstract; stats.filled++;
      }
      // 快照：saw 只在有值时写，避免没带登录态的同步把它抹掉
      if (saw) { sets.push('sync_saw_episode = @saw'); p.saw = saw; }

      sets.push(
        'sync_purchased = @sp', 'sync_subscribed = @ss',
        "synced_at = datetime('now')", "updated_at = datetime('now')"
      );
      p.sp = purchased;
      p.ss = subscribed;

      db.prepare(`UPDATE dramas SET ${sets.join(', ')} WHERE id = @id`).run(p);
      stats.updated++;
    }

    /*
     * 取关清扫。
     *
     * 上面那个循环只走这次列表里出现过的剧 —— 你在猫耳取消追剧之后，
     * 那部剧不在 subIds 里，循环压根碰不到它，subscribed 会一直挂着 1。
     * 所以这里反过来扫一遍：猫耳来源的剧，只要不在这次的追剧列表里，
     * 就把 subscribed 归零。
     *
     * 只对 subscribed 这么做。purchased 仍然是只升不降 ——
     * 猫耳支持单集购买，整剧不在已购列表不代表你没花过钱。
     *
     * 列表为空时绝不清扫：那多半是登录态过期或抓取失败，
     * 照着空列表扫会把 274 部追剧全部清掉。
     */
    if (listsComplete) {
      const ids = [...subIds];
      const notInSubs = ids.length
        ? `AND (missevan_id IS NULL OR missevan_id NOT IN (${ids.map(() => '?').join(',')}))`
        : '';
      const dropped = db.prepare(`
        SELECT id, title FROM dramas
        WHERE platform = '猫耳' AND subscribed = 1
          ${notInSubs}
      `).all(...ids);

      if (dropped.length) {
        db.prepare(`
          UPDATE dramas SET subscribed = 0, sub_order = NULL,
            sync_subscribed = 0, updated_at = datetime('now')
          WHERE id IN (${dropped.map(() => '?').join(',')})
        `).run(...dropped.map(d => d.id));
        stats.unsubscribed = dropped.length;
        for (const d of dropped) {
          notices.push({ title: d.title, change: '猫耳上已取消追剧 → 移出收藏' });
        }
      }

      // 完整快照允许把官方只读状态双向刷新。主 purchased 仍坚持只升不降，
      // 但 sync_purchased / 排序必须如实反映这次猫耳列表。
      for (const d of all) {
        if (d.platform !== '猫耳' || !d.missevan_id) continue;
        const id = String(d.missevan_id);
        db.prepare(`
          UPDATE dramas SET
            sync_purchased = ?, sync_subscribed = ?,
            bought_order = ?, sub_order = ?, synced_at = datetime('now')
          WHERE id = ?
        `).run(
          boughtIds.has(id) ? 1 : 0,
          subIds.has(id) ? 1 : 0,
          boughtOrder.get(id) ?? null,
          subOrder.get(id) ?? null,
          d.id
        );
      }
    }

    const diff = (next, prev) => [...next].filter(id => !prev.has(id));
    const summary = {
      baseline: !hadOfficialSnapshot,
      boughtTotal: boughtIds.size,
      subscriptionTotal: subIds.size,
      boughtAdded: hadOfficialSnapshot ? diff(boughtIds, previousBought).length : 0,
      boughtRemoved: hadOfficialSnapshot ? diff(previousBought, boughtIds).length : 0,
      subscribedAdded: hadOfficialSnapshot ? diff(subIds, previousSubs).length : 0,
      subscribedRemoved: hadOfficialSnapshot ? diff(previousSubs, subIds).length : 0,
    };
    notices.unshift({
      title: summary.baseline ? '建立猫耳列表基线' : '猫耳列表变化',
      change: summary.baseline
        ? `已购 ${summary.boughtTotal} · 追剧 ${summary.subscriptionTotal}`
        : `已购 +${summary.boughtAdded}/-${summary.boughtRemoved} · 追剧 +${summary.subscribedAdded}/-${summary.subscribedRemoved}`,
    });

    db.prepare(
      `INSERT INTO sync_log (kind, added, updated, skipped, detail)
       VALUES ('missevan', ?, ?, ?, ?)`
    ).run(stats.added, stats.updated, stats.untouched, JSON.stringify(notices));
  })();

  const drift = db.prepare(`
    SELECT title, heard_episodes, total_episodes, sync_saw_episode
    FROM dramas WHERE sync_saw_episode IS NOT NULL AND sync_saw_episode <> ''
  `).all();

  const diff = (next, prev) => [...next].filter(id => !prev.has(id));
  const summary = {
    baseline: !hadOfficialSnapshot,
    boughtTotal: boughtIds.size,
    subscriptionTotal: subIds.size,
    boughtAdded: hadOfficialSnapshot ? diff(boughtIds, previousBought).length : 0,
    boughtRemoved: hadOfficialSnapshot ? diff(previousBought, boughtIds).length : 0,
    subscribedAdded: hadOfficialSnapshot ? diff(subIds, previousSubs).length : 0,
    subscribedRemoved: hadOfficialSnapshot ? diff(previousSubs, subIds).length : 0,
  };

  return { ...stats, notices, drift, summary };
}
