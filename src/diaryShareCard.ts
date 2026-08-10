import type { DiaryEntry, Drama } from './types';

const W = 1080;
const SCALE = 2;
const PAD = 84;
const PAPER = '#f7f0e4';
const PAPER_LIGHT = '#fffdf8';
const INK = '#37312d';
const INK_2 = '#625b54';
const MUTED = '#948a80';
const BLUE_RULE = '#c8d6dc';
const RED_RULE = '#d49a9c';
const SAGE = '#798b78';
const MONO = '"SF Mono", SFMono-Regular, Menlo, monospace';
const SANS = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const char of paragraph) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char === ' ' ? '' : char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceRatio = image.width / image.height;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;
  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

const prettyDate = (value: string) => value.slice(0, 10).replaceAll('-', '.');

export async function renderDiaryShareCard(drama: Drama, sourceEntries: DiaryEntry[]): Promise<Blob> {
  const entries = [...sourceEntries].sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date) || a.id - b.id
  );
  if (!entries.length) throw new Error('先写一条听剧日记，再生成分享长图');

  const cover = drama.cover ? await loadImage(drama.cover) : null;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `29px ${SANS}`;
  const textWidth = W - PAD * 2 - 72;
  const prepared = entries.map(entry => ({
    entry,
    lines: wrap(measure, entry.content.trim(), textWidth),
  }));
  const notesHeight = prepared.reduce((sum, row) =>
    sum + 92 + Math.max(1, row.lines.length) * 48 + 34, 0
  );
  const notesTop = 720;
  const H = Math.max(1320, notesTop + notesHeight + 150);

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'top';

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // 贯穿整张图的横线和左侧红线，形成真实笔记本纸的秩序感。
  ctx.strokeStyle = BLUE_RULE;
  ctx.lineWidth = 1;
  for (let y = 72.5; y < H - 45; y += 48) {
    ctx.beginPath();
    ctx.moveTo(46, y);
    ctx.lineTo(W - 46, y);
    ctx.stroke();
  }
  ctx.strokeStyle = RED_RULE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(118.5, 45);
  ctx.lineTo(118.5, H - 45);
  ctx.stroke();

  ctx.strokeStyle = '#cfc5b8';
  ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, W - 68, H - 68);

  ctx.fillStyle = PAPER;
  ctx.fillRect(PAD, 56, W - PAD * 2, 78);
  ctx.fillStyle = INK;
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText('听 剧 日 记', PAD + 10, 70);
  ctx.fillStyle = MUTED;
  ctx.font = `15px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(`第 ${String(drama.id).padStart(4, '0')} 号档案`, W - PAD, 82);
  ctx.textAlign = 'left';

  // 拍立得相纸：略微倾斜、底部留白更宽，真实封面被完整融入而不是贴一张方图。
  const photoW = 410;
  const photoH = 500;
  ctx.save();
  ctx.translate(316, 385);
  ctx.rotate(-3.2 * Math.PI / 180);
  ctx.shadowColor = 'rgba(57, 47, 39, .24)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = 7;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = PAPER_LIGHT;
  ctx.fillRect(-photoW / 2, -photoH / 2, photoW, photoH);
  ctx.shadowColor = 'transparent';
  const imageSize = 354;
  const imageX = -imageSize / 2;
  const imageY = -photoH / 2 + 28;
  ctx.fillStyle = '#ddd8cf';
  ctx.fillRect(imageX, imageY, imageSize, imageSize);
  if (cover) drawCover(ctx, cover, imageX, imageY, imageSize, imageSize);
  else {
    ctx.fillStyle = MUTED;
    ctx.font = `17px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('暂无封面', 0, imageY + 166);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = INK;
  ctx.font = `700 24px ${SANS}`;
  const title = wrap(ctx, drama.title, imageSize - 12).slice(0, 2);
  title.forEach((line, index) => ctx.fillText(line, imageX + 6, imageY + imageSize + 26 + index * 32));
  ctx.restore();

  const infoX = 576;
  let infoY = 212;
  ctx.fillStyle = SAGE;
  ctx.font = `700 14px ${MONO}`;
  ctx.fillText('正在收听的这一刻', infoX, infoY);
  infoY += 44;
  ctx.fillStyle = INK;
  ctx.font = `700 38px ${SANS}`;
  const titleLines = wrap(ctx, drama.title, 390).slice(0, 3);
  titleLines.forEach(line => {
    ctx.fillText(line, infoX, infoY);
    infoY += 50;
  });

  const mainCvs = drama.cvs.filter(cv => cv.role_type === '主役').map(cv => cv.name).join(' · ');
  const facts = [
    ['主役', mainCvs || '—'],
    ['平台', drama.platform],
    ['进度', `${drama.heard_episodes ?? 0} / ${drama.total_episodes ?? '—'} 集`],
    ['日记', `${entries.length} 则`],
  ];
  infoY += 18;
  for (const [label, value] of facts) {
    ctx.fillStyle = MUTED;
    ctx.font = `14px ${MONO}`;
    ctx.fillText(label, infoX, infoY);
    ctx.fillStyle = INK_2;
    ctx.font = `22px ${SANS}`;
    const factLines = wrap(ctx, value, 300).slice(0, 2);
    factLines.forEach((line, index) => ctx.fillText(line, infoX + 70, infoY - 4 + index * 28));
    infoY += Math.max(44, factLines.length * 28 + 10);
  }

  ctx.fillStyle = PAPER;
  ctx.fillRect(PAD, notesTop - 48, 280, 44);
  ctx.fillStyle = INK;
  ctx.font = `700 25px ${SANS}`;
  ctx.fillText('沿途记下的碎碎念', PAD + 12, notesTop - 38);

  let y = notesTop + 14;
  for (let index = 0; index < prepared.length; index++) {
    const { entry, lines } = prepared[index];
    ctx.fillStyle = index % 2 === 0 ? '#d8c7bd' : '#c9d3c4';
    ctx.beginPath();
    ctx.roundRect(PAD + 10, y, 170, 36, 4);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `700 15px ${MONO}`;
    ctx.fillText(prettyDate(entry.entry_date), PAD + 24, y + 9);
    if (entry.episode_label) {
      ctx.fillStyle = MUTED;
      ctx.font = `16px ${SANS}`;
      ctx.fillText(entry.episode_label, PAD + 204, y + 8);
    }
    y += 61;
    ctx.fillStyle = INK_2;
    ctx.font = `29px ${SANS}`;
    for (const line of lines.length ? lines : ['']) {
      ctx.fillText(line, PAD + 42, y);
      y += 48;
    }
    y += 65;
  }

  ctx.fillStyle = PAPER;
  ctx.fillRect(PAD, H - 104, W - PAD * 2, 46);
  ctx.fillStyle = MUTED;
  ctx.font = `14px ${MONO}`;
  ctx.fillText('听剧档案柜 · 私人收听手记', PAD + 10, H - 91);
  ctx.textAlign = 'right';
  const generatedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  ctx.fillText(`生成于 ${prettyDate(generatedDate)}`, W - PAD, H - 91);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('日记长图导出失败')), 'image/png');
  });
}
