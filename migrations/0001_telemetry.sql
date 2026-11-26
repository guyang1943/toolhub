-- v3.36 自有埋点：访问事件表
--
-- 只存五列，每一列都要能回答「拿它做什么决定」：
--   ts      时间戳      → 算增长趋势、保留期清理
--   day     中国时区日期 → 看板按天聚合（不在查询时算时区，省一次函数调用）
--   path    路径        → 哪一页有人看、哪一页没人看
--   event   事件名      → 漏斗（view → tool_open → run → result）
--   sid     本机随机号  → 近似「多少台设备」，不是用户 ID
--   country 国家二字码  → 只到国家，不到城市，不含 IP
--
-- **故意没有的列**：IP、UA、referer、输入内容、文件名、错误文本。
-- 前三个能拼出个人身份，后三个会带出用户粘贴的内容。加列之前先改 /privacy/。
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  path    TEXT    NOT NULL,
  event   TEXT    NOT NULL,
  sid     TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_ts   ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_day  ON events (day, event);

-- 保留 90 天。建议每周跑一次（wrangler d1 execute toolhub --command "..." --remote）：
-- DELETE FROM events WHERE ts < (strftime('%s','now') - 90*86400) * 1000;
