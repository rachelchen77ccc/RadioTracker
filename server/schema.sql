-- RadioTracker schema
--
-- 设计原则：手动优先（manual-first）
--   主字段 = 你的真实标记，永远以人工输入为准。
--   sync_* 字段 = 猫耳最近一次同步回来的值，只读快照。
--   同步逻辑只在主字段为空时回填；已有人工值一律不覆盖，
--   差异由 UI 以提示形式呈现，由你决定是否采纳。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dramas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 身份
  missevan_id     INTEGER UNIQUE,          -- 猫耳剧 ID；漫播/手动录入的剧为 NULL
  title           TEXT    NOT NULL,
  platform        TEXT    NOT NULL DEFAULT '猫耳',  -- 猫耳 / 漫播 / 其他
  source          TEXT    NOT NULL DEFAULT 'manual', -- notion / missevan / manual（首次来源）

  -- 分类
  kind            TEXT,                    -- 广播剧 / 听书 / 其他
  categories      TEXT,                    -- JSON 数组：['古风','玄幻/仙侠']
  organization    TEXT,                    -- 社团
  abstract        TEXT,

  -- 封面：远程优先，本地兜底（Notion 导出的本地图片搬进 data/covers/）
  cover_url       TEXT,
  cover_local     TEXT,

  -- 我的状态（全部人工可编辑）
  -- 在听 / 听完 / 想听 / 囤着 / 搁置 / 弃了
  --   想听 = 从库里挑出来准备听的短名单     囤着 = 买了还没开始
  --   搁置 = 听了一部分停下了                弃了 = 不听了
  status          TEXT,
  purchased       INTEGER NOT NULL DEFAULT 0,
  subscribed      INTEGER NOT NULL DEFAULT 0,   -- 猫耳「追剧」，与 purchased 独立
  heard_episodes  INTEGER,                 -- 已听集数 —— 以手动标记为准
  total_episodes  INTEGER,
  rating          REAL,                    -- 4.3 ~ 5，允许 4.75 这类半档
  finished_date   TEXT,                    -- ISO yyyy-mm-dd
  -- 重刷分两层：queued 是「挑出来还没开始重刷的」，status 是「刷过几遍的历史」
  rewatch_queued  INTEGER NOT NULL DEFAULT 0,
  rewatch_status  TEXT,                    -- 已二刷 / 已三刷 / 已四刷 / 已n刷
  review          TEXT,                    -- 剧评正文（Markdown）

  -- 连载信息
  serialize_status TEXT,                   -- 已完结 / 连载中
  update_info      TEXT,                   -- 更新情况，如「第一季完结花絮」
  update_day       TEXT,                   -- 更新日，如「周五」「每日」
  price            REAL,

  -- 猫耳同步快照（只读，永不作为展示真值）
  sync_saw_episode    TEXT,                -- 猫耳记录的上次收听位置（是集名不是数字），仅作提示
  sync_total_episodes INTEGER,
  sync_newest         TEXT,
  sync_serialize      TEXT,
  sync_purchased      INTEGER,
  sync_subscribed     INTEGER,
  synced_at           TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dramas_status   ON dramas(status);
CREATE INDEX IF NOT EXISTS idx_dramas_platform ON dramas(platform);
CREATE INDEX IF NOT EXISTS idx_dramas_finished ON dramas(finished_date);
CREATE INDEX IF NOT EXISTS idx_dramas_rewatch_queued ON dramas(rewatch_queued);

CREATE TABLE IF NOT EXISTS cvs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  missevan_id INTEGER UNIQUE,
  avatar_url  TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drama_cvs (
  drama_id  INTEGER NOT NULL REFERENCES dramas(id) ON DELETE CASCADE,
  cv_id     INTEGER NOT NULL REFERENCES cvs(id)    ON DELETE CASCADE,
  role_type TEXT NOT NULL DEFAULT '主役',  -- 主役 / 配役
  character TEXT,
  PRIMARY KEY (drama_id, cv_id, role_type)
);

CREATE INDEX IF NOT EXISTS idx_drama_cvs_cv ON drama_cvs(cv_id);

-- 重刷计划：一部剧可以有多轮重刷记录
CREATE TABLE IF NOT EXISTS rewatch_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id   INTEGER NOT NULL REFERENCES dramas(id) ON DELETE CASCADE,
  planned_at TEXT,
  done_at    TEXT,
  round      INTEGER,                     -- 第几刷
  note       TEXT
);

-- 同步日志：每次导入记录一笔，方便回溯「这次改了什么」
CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at     TEXT NOT NULL DEFAULT (datetime('now')),
  kind       TEXT NOT NULL,               -- notion / missevan
  added      INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  detail     TEXT                         -- JSON：冲突明细
);
