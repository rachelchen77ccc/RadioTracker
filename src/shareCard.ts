import type { Drama } from './types';

/**
 * 把一部剧渲染成一张可分享的长图。
 *
 * 用 canvas 手绘而不是截 DOM：repo 剧评长度差别很大（几十字到两千字），
 * 高度必须按实际排版算出来，canvas 能精确控制换行和总高，
 * 截图方案在长文本上很容易糊掉或截断。
 *
 * 版式沿用站内的档案基调：纯白纸、发丝线、等宽字段名、底部条码。
 * 顶部是一块横向的「正在播放」专辑面板：左边保留完整封面，右边放剧名和收听资料。
 */

const W = 1080;              // 输出宽度，微博/小红书都吃得下
const PAD = 72;
const SCALE = 2;             // 2x 保证手机上看着清楚

const INK = '#1b1a17';
const INK2 = '#57544d';
const MUTED = '#918d84';
const RULE = '#dedbd4';
const KRAFT = '#d4c4a5';
const PAPER = '#ffffff';

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

/** 以 cover 方式裁进任意矩形，避免封面被拉伸。 */
function drawImageCover(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  x: number, y: number, width: number, height: number
) {
  const sourceRatio = img.width / img.height;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (sourceRatio > targetRatio) {
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
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

  const playerTop = PAD + 38;
  const playerH = 430;
  const reviewTop = playerTop + playerH + 42;
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
  ctx.font = `bold 17px ${SANS}`;
  ctx.fillText('听 剧 档 案', PAD - 8, PAD - 16);

  ctx.fillStyle = MUTED;
  ctx.font = `15px ${MONO}`;
  const fileNo = `FILE_${String(drama.id).padStart(4, '0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(fileNo, W - PAD + 12, PAD - 14);
  ctx.textAlign = 'left';

  // 横向专辑播放器。参考播放器的左右分栏，但沿用档案库自己的纸张与暗灰色。
  ctx.fillStyle = '#282826';
  ctx.beginPath();
  ctx.roundRect(PAD, playerTop, bodyW, playerH, 28);
  ctx.fill();
  ctx.strokeStyle = '#45423d';
  ctx.stroke();

  const coverSize = 334;
  const coverX = PAD + 36;
  const coverY = playerTop + 48;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(coverX, coverY, coverSize, coverSize, 15);
  ctx.clip();
  ctx.fillStyle = '#3c3a36';
  ctx.fillRect(coverX, coverY, coverSize, coverSize);
  if (cover) drawImageCover(ctx, cover, coverX, coverY, coverSize, coverSize);
  ctx.restore();
  ctx.strokeStyle = '#56524c';
  ctx.beginPath();
  ctx.roundRect(coverX + .5, coverY + .5, coverSize - 1, coverSize - 1, 15);
  ctx.stroke();

  const infoX = coverX + coverSize + 46;
  const infoW = W - PAD - 36 - infoX;
  let infoY = playerTop + 52;

  ctx.fillStyle = '#aaa69d';
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillText('N O W   P L A Y I N G', infoX, infoY);

  infoY += 35;
  ctx.fillStyle = '#f4f1ea';
  ctx.font = `bold 36px ${SANS}`;
  const titleLines = wrap(ctx, drama.title, infoW).slice(0, 2);
  for (const line of titleLines) {
    ctx.fillText(line, infoX, infoY);
    infoY += 45;
  }

  infoY += 10;
  ctx.fillStyle = '#aaa69d';
  ctx.font = `12px ${MONO}`;
  ctx.fillText('CAST / CV', infoX, infoY);
  infoY += 22;
  ctx.fillStyle = '#ddd9d1';
  ctx.font = `22px ${SANS}`;
  const cvLines = wrap(ctx, main.length ? main.join('  ·  ') : '—', infoW).slice(0, 2);
  for (const line of cvLines) {
    ctx.fillText(line, infoX, infoY);
    infoY += 30;
  }

  const factsY = playerTop + 286;
  const facts = [
    ['RATING', drama.rating != null ? `${drama.rating.toFixed(2).replace(/\.?0+$/, '')} / 5` : '—'],
    ['PLATFORM', drama.platform],
    ['DATE', drama.finished_date ?? drama.synced_at?.slice(0, 10) ?? '—'],
  ];
  const factW = infoW / facts.length;
  for (let i = 0; i < facts.length; i++) {
    const x = infoX + factW * i;
    ctx.fillStyle = '#8f8b83';
    ctx.font = `11px ${MONO}`;
    ctx.fillText(facts[i][0], x, factsY);
    ctx.fillStyle = i === 0 && drama.rating != null ? '#e6a296' : '#f0ece4';
    ctx.font = `bold 19px ${SANS}`;
    ctx.fillText(facts[i][1], x, factsY + 24);
  }

  const progressY = playerTop + 368;
  const progress = drama.total_episodes
    ? Math.max(0, Math.min(1, (drama.heard_episodes ?? 0) / drama.total_episodes))
    : 0;
  ctx.fillStyle = '#5a5751';
  ctx.fillRect(infoX, progressY, infoW, 3);
  ctx.fillStyle = '#eee9df';
  ctx.fillRect(infoX, progressY, infoW * progress, 3);
  ctx.beginPath();
  ctx.arc(infoX + infoW * progress, progressY + 1.5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#aaa69d';
  ctx.font = `12px ${MONO}`;
  ctx.fillText(
    `EP ${drama.heard_episodes ?? 0} / ${drama.total_episodes ?? '—'}`,
    infoX,
    progressY + 17
  );

  let y = reviewTop;
  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.moveTo(PAD, y + .5);
  ctx.lineTo(W - PAD, y + .5);
  ctx.stroke();

  // repo 正文
  if (reviewLines.length) {
    y += 30;
    ctx.fillStyle = MUTED;
    ctx.font = `bold 13px ${MONO}`;
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
