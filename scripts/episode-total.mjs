/** 猫耳详情页里的中文数字只需要覆盖常见的百以内集数。 */
function parseCount(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  const digit = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/[十百]/.test(raw)) {
    const value = [...raw].map(c => digit[c]).join('');
    return /^\d+$/.test(value) ? Number(value) : null;
  }
  let total = 0;
  let current = 0;
  for (const c of raw) {
    if (c in digit) current = digit[c];
    else if (c === '十') { total += (current || 1) * 10; current = 0; }
    else if (c === '百') { total += (current || 1) * 100; current = 0; }
  }
  return total + current || null;
}

function plainText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, ' ');
}

const N = '[0-9零〇一二两三四五六七八九十百]+';

/**
 * 优先读取详情文案明确写出的「正剧计划总集数」。
 * 顺序很重要：先找紧贴“正剧”的数量，避免误取免费集、番外或小剧场数量。
 */
export function parsePlannedMainEpisodes(abstractHtml) {
  const text = plainText(abstractHtml);
  const patterns = [
    new RegExp(`正剧\\s*(?:共|为|预计|计划|包含|含)?\\s*(${N})\\s*[集期回章]`, 'i'),
    new RegExp(`(${N})\\s*[集期回章]\\s*正剧`, 'i'),
    new RegExp(`(?:共|合计)\\s*(${N})\\s*[集期回章](?!\\s*(?:番外|小剧场|预告|花絮|福利))`, 'i'),
    new RegExp(`(?:全一季|全季|本季|本剧|本作品)\\s*(?:共|为|预计|计划)?\\s*(${N})\\s*[集期回章]`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match && parseCount(match[1]);
    if (value && value > 0) return value;
  }
  return null;
}

const EXTRA = /预告|花絮|番外|福利|小剧场|彩蛋|主题曲|插曲|配乐|伴奏|直播|访谈|FT|OST/i;

/** 没写计划总数时，从“更新至第几集”和已上架正剧标题推断当前集数。 */
export function inferReleasedMainEpisodes(newest, episodeNames = []) {
  let max = 0;
  for (const name of [newest, ...episodeNames]) {
    const text = plainText(name);
    if (!text || EXTRA.test(text)) continue;
    const pattern = new RegExp(`第\\s*(${N})\\s*[集期回章]`, 'g');
    for (const match of text.matchAll(pattern)) {
      max = Math.max(max, parseCount(match[1]) ?? 0);
    }
  }
  return max || null;
}

/**
 * 总集数来源：详情计划 > 当前更新到的正剧集数 > 列表条目数。
 * 最后一层只是极少数详情完全没写集数、标题也没有编号时的兜底。
 */
export function resolveEpisodeTotal({ abstract, newest, episodeNames = [] }) {
  const planned = parsePlannedMainEpisodes(abstract);
  if (planned) return { total: planned, source: '详情计划' };
  const released = inferReleasedMainEpisodes(newest, episodeNames);
  if (released) return { total: released, source: '更新进度' };
  return { total: episodeNames.length || null, source: '上架条目' };
}
