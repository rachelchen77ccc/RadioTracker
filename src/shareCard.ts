import type { Drama } from './types';

/**
 * 把一部剧渲染成一张可分享的长图。
 *
 * 用 canvas 手绘而不是截 DOM：repo 剧评长度差别很大（几十字到两千字），
 * 高度必须按实际排版算出来，canvas 能精确控制换行和总高，
 * 截图方案在长文本上很容易糊掉或截断。
 *
 * 版式沿用站内的档案基调：纯白纸、发丝线、等宽字段名、底部条码。
 */

const W = 1080;              // 输出宽度，微博/小红书都吃得下
const PAD = 72;
const SCALE = 2;             // 2x 保证手机上看着清楚

const INK = '#1b1a17';
const INK2 = '#57544d';
const MUTED = '#918d84';
const RULE = '#dedbd4';
const RUST = '#8c3b32';
const KRAFT = '#d4c4a5';
const PAPER = '#ffffff';
const PAPER2 = '#f7f6f3';

const MONO = '"SF Mono", SFMono-Regular, Menlo, monospace';
const SANS = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';

/** 按字宽折行，返回每行文本。中文没有空格，只能逐字量。 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line);
        // 折到下一行时丢掉行首空格，否则中文段落会出现莫名的缩进
        line = ch === ' ' ? '' : ch;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 居中裁成正方形后画进去 —— 跟站内封面一样的裁法 */
function drawCoverSquare(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  x: number, y: number, size: number
) {
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, y, size, size);
}

export async function renderShareCard(drama: Drama): Promise<Blob> {
  const cover = drama.cover ? await loadImage(drama.cover) : null;

  const main = drama.cvs.filter(c => c.role_type === '主役').map(c => c.name);
  const review = (drama.review ?? '').trim();

  // ── 先用一个量算用的 ctx 把正文折行，好算总高 ──
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `28px ${SANS}`;
  const bodyW = W - PAD * 2;
  const reviewLines = review ? wrap(measure, review, bodyW) : [];

  const COVER = 420;
  const headTop = PAD + 58;                       // 顶部档案条下方
  const metaTop = headTop + COVER + 46;
  const metaH = 150;                              // 剧名 + CV + 评分区
  const reviewTop = metaTop + metaH;
  const lineH = 46;
  const reviewH = reviewLines.length ? 56 + reviewLines.length * lineH : 0;
  const H = Math.round(reviewTop + reviewH + 120);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'top';

  // 纸
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // 外框
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD - 24.5, PAD - 24.5, W - (PAD - 24) * 2, H - (PAD - 24) * 2);

  // 顶部档案标签
  ctx.fillStyle = KRAFT;
  ctx.beginPath();
  ctx.moveTo(PAD - 24, PAD - 24);
  ctx.lineTo(PAD + 214, PAD - 24);
  ctx.lineTo(PAD + 232, PAD + 8);
  ctx.lineTo(PAD - 24, PAD + 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.font = `600 17px ${MONO}`;
  ctx.fillText('听 剧 档 案', PAD - 8, PAD - 16);

  ctx.fillStyle = MUTED;
  ctx.font = `15px ${MONO}`;
  const fileNo = `FILE_${String(drama.id).padStart(4, '0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(fileNo, W - PAD + 12, PAD - 14);
  ctx.textAlign = 'left';

  // 封面：居中的正方形
  const coverX = (W - COVER) / 2;
  ctx.fillStyle = PAPER2;
  ctx.fillRect(coverX, headTop, COVER, COVER);
  if (cover) drawCoverSquare(ctx, cover, coverX, headTop, COVER);
  ctx.strokeStyle = RULE;
  ctx.strokeRect(coverX + .5, headTop + .5, COVER - 1, COVER - 1);

  // 剧名
  let y = metaTop;
  ctx.fillStyle = INK;
  ctx.font = `650 40px ${SANS}`;
  const titleLines = wrap(ctx, drama.title, bodyW).slice(0, 2);
  for (const l of titleLines) { ctx.fillText(l, PAD, y); y += 50; }

  // CV
  if (main.length) {
    ctx.fillStyle = MUTED;
    ctx.font = `13px ${MONO}`;
    ctx.fillText('主役 CV', PAD, y + 8);
    ctx.fillStyle = INK2;
    ctx.font = `26px ${SANS}`;
    ctx.fillText(main.join('  ·  '), PAD + 92, y + 2);
    y += 44;
  }

  // 评分 + 平台 + 集数
  ctx.fillStyle = MUTED;
  ctx.font = `13px ${MONO}`;
  ctx.fillText('我的评分', PAD, y + 10);
  if (drama.rating != null) {
    ctx.fillStyle = RUST;
    ctx.font = `700 34px ${MONO}`;
    ctx.fillText(drama.rating.toFixed(2).replace(/\.?0+$/, ''), PAD + 92, y);
    const stars = Math.round(drama.rating);
    ctx.fillStyle = RUST;
    ctx.font = `22px ${SANS}`;
    ctx.fillText('★'.repeat(stars) + '☆'.repeat(Math.max(0, 5 - stars)), PAD + 176, y + 8);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = `26px ${SANS}`;
    ctx.fillText('—', PAD + 92, y + 2);
  }

  // 右侧：平台 / 集数
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = `15px ${MONO}`;
  const right = [
    drama.platform,
    drama.total_episodes ? `${drama.total_episodes} 集` : null,
    drama.finished_date ?? null,
  ].filter(Boolean).join('   ');
  ctx.fillText(right, W - PAD, y + 12);
  ctx.textAlign = 'left';

  y += 62;

  // 分隔线
  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.moveTo(PAD, y + .5);
  ctx.lineTo(W - PAD, y + .5);
  ctx.stroke();

  // repo 正文
  if (reviewLines.length) {
    y += 30;
    ctx.fillStyle = MUTED;
    ctx.font = `600 13px ${MONO}`;
    ctx.fillText('R E P O', PAD, y);
    y += 30;

    ctx.fillStyle = INK2;
    ctx.font = `28px ${SANS}`;
    for (const l of reviewLines) {
      ctx.fillText(l, PAD, y);
      y += lineH;
    }
  }

  // 底部条码
  const barY = H - PAD + 4;
  ctx.fillStyle = INK;
  ctx.globalAlpha = .5;
  let bx = PAD;
  const widths = [1, 3, 1, 2, 1, 1, 4, 2, 1, 3, 1, 1, 2, 4, 1, 2, 3, 1];
  for (let i = 0; bx < PAD + 240; i++) {
    const w = widths[i % widths.length];
    if (i % 2 === 0) ctx.fillRect(bx, barY, w, 22);
    bx += w + 2;
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = MUTED;
  ctx.font = `13px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText('MY DRAMA ARCHIVE', W - PAD, barY + 6);
  ctx.textAlign = 'left';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('导出图片失败'))),
      'image/png'
    );
  });
}
