type JsonObject = Record<string, any>;

const WEEK: Record<string, string> = {
  一: '周一', 二: '周二', 三: '周三', 四: '周四',
  五: '周五', 六: '周六', 日: '周日', 天: '周日',
};
const DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const NUMBER_TEXT = '[0-9零〇一二两三四五六七八九十百]+';
const EXTRA = /预告|花絮|番外|福利|小剧场|彩蛋|主题曲|插曲|配乐|伴奏|直播|访谈|FT|OST/i;

function plainText(value: unknown) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, ' ');
}

function parseCount(raw: string) {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/[十百]/.test(raw)) {
    const value = [...raw].map(character => DIGIT[character]).join('');
    return /^\d+$/.test(value) ? Number(value) : null;
  }
  let total = 0;
  let current = 0;
  for (const character of raw) {
    if (character in DIGIT) current = DIGIT[character];
    else if (character === '十') { total += (current || 1) * 10; current = 0; }
    else if (character === '百') { total += (current || 1) * 100; current = 0; }
  }
  return total + current || null;
}

function plannedEpisodes(abstract: unknown) {
  const text = plainText(abstract);
  const patterns = [
    new RegExp(`正剧\\s*(?:共|为|预计|计划|包含|含)?\\s*(${NUMBER_TEXT})\\s*[集期回章]`, 'i'),
    new RegExp(`(${NUMBER_TEXT})\\s*[集期回章]\\s*正剧`, 'i'),
    new RegExp(`(?:共|合计)\\s*(${NUMBER_TEXT})\\s*[集期回章](?!\\s*(?:番外|小剧场|预告|花絮|福利))`, 'i'),
    new RegExp(`(?:全一季|全季|本季|本剧|本作品)\\s*(?:共|为|预计|计划)?\\s*(${NUMBER_TEXT})\\s*[集期回章]`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match ? parseCount(match[1]) : null;
    if (value && value > 0) return value;
  }
  return null;
}

function releasedEpisodes(newest: unknown, episodeNames: unknown[]) {
  let maximum = 0;
  for (const value of [newest, ...episodeNames]) {
    const text = plainText(value);
    if (!text || EXTRA.test(text)) continue;
    const pattern = new RegExp(`第\\s*(${NUMBER_TEXT})\\s*[集期回章]`, 'g');
    for (const match of text.matchAll(pattern)) maximum = Math.max(maximum, parseCount(match[1]) || 0);
  }
  return maximum || null;
}

function episodeTotal(drama: JsonObject, info: JsonObject) {
  const names = (info.episodes?.episode || []).map((episode: JsonObject) => episode.name).filter(Boolean);
  return plannedEpisodes(drama.abstract) || releasedEpisodes(drama.newest, names) || names.length || null;
}

function updateDay(abstract: unknown) {
  const text = plainText(abstract);
  if (!/更新|播出/.test(text)) return null;
  const weekly = /每\s*[周週]\s*([一二三四五六日天])/.exec(text);
  if (weekly) return WEEK[weekly[1]] || null;
  return /每\s*[日天]/.test(text) ? '每日' : null;
}

export type ImportedMissevanDrama = {
  missevanId: number;
  title: string;
  kind: string;
  categories: string[];
  organization: string | null;
  abstract: string | null;
  coverUrl: string | null;
  totalEpisodes: number | null;
  serializeStatus: string | null;
  updateInfo: string | null;
  updateDay: string | null;
  price: number | null;
  cvs: Array<{
    name: string;
    missevanId: number | null;
    avatarUrl: string | null;
    character: string | null;
    suggestedRole: '主役' | '配役';
  }>;
};

export function normalizeMissevanDrama(payload: JsonObject, requestedId: number): ImportedMissevanDrama {
  const info = payload?.info;
  const drama = info?.drama;
  if (!drama?.name) throw new Error('没有找到这个猫耳剧集');
  const type = String(drama.type || '');
  return {
    missevanId: Number(drama.id || requestedId),
    title: String(drama.name).trim(),
    kind: Number(drama.type) === 2 || /听书|有声/.test(type) ? '听书' : '广播剧',
    categories: [...new Set([
      drama.catalog_name,
      ...(Array.isArray(drama.tags) ? drama.tags.map((tag: JsonObject | string) => typeof tag === 'string' ? tag : tag?.name) : []),
    ].filter(Boolean).map(String))],
    organization: drama.organization?.name || null,
    abstract: drama.abstract || null,
    coverUrl: drama.cover || null,
    totalEpisodes: episodeTotal(drama, info),
    serializeStatus: String(drama.integrity) === '1'
      ? '已完结'
      : String(drama.integrity) === '2' ? '连载中' : null,
    updateInfo: drama.newest || null,
    updateDay: updateDay(drama.abstract),
    price: drama.price ?? null,
    cvs: (info.cvs || []).flatMap((entry: JsonObject, index: number) => {
      const name = entry.cv_info?.name;
      return name ? [{
        name: String(name),
        missevanId: entry.cv_info?.id ?? null,
        avatarUrl: entry.cv_info?.icon ?? null,
        character: entry.character || null,
        suggestedRole: index < 2 ? '主役' as const : '配役' as const,
      }] : [];
    }),
  };
}

export function decodeCover(base64: string, contentType: string | null | undefined) {
  const bytes = Uint8Array.from(atob(base64.replace(/\s+/g, '')), character => character.charCodeAt(0));
  const type = contentType?.split(';', 1)[0].toLowerCase() || 'image/jpeg';
  const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  return { bytes, type, extension };
}
