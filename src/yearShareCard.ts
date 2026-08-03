import type { Drama, YearShareData } from './types';

const W = 1080;
const PAD = 64;
const SCALE = 2;

const PAPER = '#f4f2e7';
const PAPER_LIGHT = '#fffdf6';
const INK = '#29483c';
const MUTED = '#708277';
const SAGE = '#7e9b8c';
const BLUE = '#8da5ad';
const GOLD = '#b6a06a';
const RULE = '#d5d4c5';
const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const SERIF = 'Georgia, "Songti SC", serif';
const MONO = '"SF Mono", SFMono-Regular, Menlo, monospace';

type Highlights = {
  byMonth: { month: number; n: number }[];
  topCvs: { label: string; n: number }[];
  byCategory: { label: string; n: number }[];
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#d8d7c8';
  ctx.fillRect(x, y, w, h);
  if (!img) return;
  const sourceRatio = img.width / img.height;
  const targetRatio = w / h;
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
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = ch;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function sectionTitle(ctx: CanvasRenderingContext2D, y: number, code: string, title: string, caption: string) {
  ctx.fillStyle = MUTED;
  ctx.font = `700 14px ${MONO}`;
  ctx.fillText(code, PAD, y);
  ctx.fillStyle = INK;
  ctx.font = `700 25px ${SANS}`;
  ctx.fillText(title, PAD, y + 27);
  ctx.fillStyle = MUTED;
  ctx.font = `italic 20px ${SERIF}`;
  ctx.fillText(caption, PAD, y + 60);
}

export async function renderYearShareCard(
  stats: YearShareData,
  picks: Drama[],
  note: string,
  highlights: Highlights,
): Promise<Blob> {
  const images = await Promise.all(picks.map(d => d.cover ? loadImage(d.cover) : Promise.resolve(null)));
  const noteText = note.trim() || '这一年，耳机里装下了很多不同的世界。';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `28px ${SANS}`;
  const noteLines = wrap(measure, noteText, W - PAD * 2 - 64).slice(0, 4);
  const H = 2660 + Math.max(0, noteLines.length - 2) * 46;
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'top';

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = INK;
  for (let x = 0; x < W; x += 21) {
    for (let y = (x % 42) / 2; y < H; y += 26) ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 26, W - 52, H - 52);

  ctx.fillStyle = INK;
  ctx.font = `700 15px ${MONO}`;
  ctx.fillText('LISTENING ARCHIVE / YEAR END EDITION', PAD, 54);
  ctx.textAlign = 'right';
  ctx.fillText('NO. ' + stats.year, W - PAD, 54);
  ctx.textAlign = 'left';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 84.5); ctx.lineTo(W - PAD, 84.5); ctx.stroke();

  ctx.fillStyle = SAGE;
  ctx.font = `italic 36px ${SERIF}`;
  ctx.fillText('A catalogue of what stayed with me', PAD, 142);
  ctx.fillStyle = INK;
  ctx.font = `700 112px ${SANS}`;
  ctx.fillText(stats.year, PAD, 186);
  ctx.font = `600 31px ${SANS}`;
  ctx.fillText('听剧年度总结', PAD + 12, 330);

  const motifX = W - 212;
  ctx.fillStyle = '#dfe8dd';
  ctx.fillRect(motifX - 118, 126, 236, 236);
  ctx.strokeStyle = SAGE;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) ctx.strokeRect(motifX - 94 + i * 16, 150 + i * 16, 188 - i * 32, 188 - i * 32);
  ctx.fillStyle = PAPER_LIGHT;
  ctx.fillRect(motifX - 43, 222, 86, 44);
  ctx.fillStyle = INK;
  ctx.font = `700 13px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('PLAY / KEEP', motifX, 237);
  ctx.textAlign = 'left';

  const metricY = 435;
  const metrics = [
    [String(stats.total), '听完的剧', SAGE],
    [stats.episodes.toLocaleString(), '总集数', BLUE],
    [stats.avgRating == null ? '—' : String(stats.avgRating), '平均评分', GOLD],
    [String(stats.reviews), '写下剧评', '#89939a'],
  ];
  metrics.forEach(([value, label, color], i) => {
    const x = PAD + i * 238;
    ctx.fillStyle = color;
    ctx.fillRect(x, metricY - 11, 40, 5);
    ctx.fillStyle = INK;
    ctx.font = `700 50px ${MONO}`;
    ctx.fillText(value, x, metricY);
    ctx.fillStyle = MUTED;
    ctx.font = `600 14px ${MONO}`;
    ctx.fillText(label, x, metricY + 62);
    if (i < metrics.length - 1) {
      ctx.strokeStyle = RULE;
      ctx.beginPath(); ctx.moveTo(x + 205.5, metricY + 7); ctx.lineTo(x + 205.5, metricY + 82); ctx.stroke();
    }
  });

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, 575.5); ctx.lineTo(W - PAD, 575.5); ctx.stroke();
  sectionTitle(ctx, 618, '01 / SELECTED SHELF', '年度高分 Top 5', 'Five stories worth keeping on the same shelf.');

  const cardY = 714;
  const gap = 13;
  const cardW = (W - PAD * 2 - gap * 4) / 5;
  const coverH = 204;
  const cardH = 344;
  picks.slice(0, 5).forEach((d, i) => {
    const x = PAD + i * (cardW + gap);
    const accents = [SAGE, BLUE, GOLD, '#879a80', '#89939a'];
    ctx.fillStyle = PAPER_LIGHT;
    ctx.fillRect(x, cardY, cardW, cardH);
    ctx.strokeStyle = RULE;
    ctx.strokeRect(x + .5, cardY + .5, cardW - 1, cardH - 1);
    ctx.fillStyle = accents[i];
    ctx.fillRect(x, cardY, cardW, 6);
    drawCover(ctx, images[i], x + 10, cardY + 17, cardW - 20, coverH);
    ctx.fillStyle = accents[i];
    ctx.font = `700 15px ${MONO}`;
    ctx.fillText(String(i + 1).padStart(2, '0'), x + 12, cardY + 238);
    ctx.fillStyle = INK;
    ctx.font = `700 18px ${SANS}`;
    wrap(ctx, d.title, cardW - 24).slice(0, 2).forEach((line, lineIndex) => ctx.fillText(line, x + 12, cardY + 267 + lineIndex * 25));
    ctx.fillStyle = MUTED;
    ctx.font = `700 13px ${MONO}`;
    ctx.fillText(d.rating == null ? '—' : `${d.rating.toFixed(1)}  ★`, x + 12, cardY + 316);
  });

  const rhythmY = 1115;
  sectionTitle(ctx, rhythmY, '02 / LISTENING RHYTHM', '听剧节奏', 'Twelve bars, one for every month of the year.');
  const monthRows = highlights.byMonth.length ? highlights.byMonth : Array.from({ length: 12 }, (_, i) => ({ month: i + 1, n: 0 }));
  const maxMonth = Math.max(1, ...monthRows.map(d => d.n));
  const chartX = PAD + 30;
  const chartY = rhythmY + 105;
  const chartW = W - PAD * 2 - 60;
  const chartH = 205;
  const baseline = chartY + chartH;
  const barGap = 16;
  const barW = (chartW - barGap * (monthRows.length - 1)) / monthRows.length;
  const barsW = barW * monthRows.length + barGap * (monthRows.length - 1);
  const startX = chartX + (chartW - barsW) / 2;
  ctx.fillStyle = '#e8ede5';
  ctx.fillRect(chartX, chartY, chartW, chartH);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  for (let step = 1; step < 4; step++) {
    const y = chartY + (chartH / 4) * step;
    ctx.beginPath(); ctx.moveTo(chartX, y + .5); ctx.lineTo(chartX + chartW, y + .5); ctx.stroke();
  }
  const accents = [SAGE, BLUE, GOLD, '#879a80', '#89939a'];
  monthRows.forEach((d, i) => {
    const height = d.n === 0 ? 3 : Math.max(8, (d.n / maxMonth) * (chartH - 20));
    const x = startX + i * (barW + barGap);
    const y = baseline - height;
    ctx.fillStyle = accents[i % accents.length];
    ctx.fillRect(x, y, barW, height);
    ctx.fillStyle = INK;
    ctx.font = `700 17px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(d.n), x + barW / 2, y - 28);
    ctx.fillStyle = MUTED;
    ctx.font = `700 15px ${MONO}`;
    ctx.fillText(String(d.month).padStart(2, '0'), x + barW / 2, baseline + 20);
    ctx.textAlign = 'left';
  });

  const tableY = 1480;
  sectionTitle(ctx, tableY, '03 / CAST IN ROTATION', '常听 CV', 'The voices that returned again and again.');
  const cvRows = highlights.topCvs.slice(0, 5);
  const cvMax = Math.max(1, ...cvRows.map(d => d.n));
  cvRows.forEach((d, i) => {
    const y = tableY + 102 + i * 54;
    ctx.fillStyle = i % 2 ? '#e9eee7' : PAPER_LIGHT;
    ctx.fillRect(PAD, y, W - PAD * 2, 42);
    ctx.fillStyle = i === 0 ? GOLD : MUTED;
    ctx.font = `700 14px ${MONO}`;
    ctx.fillText(String(i + 1).padStart(2, '0'), PAD + 14, y + 13);
    ctx.fillStyle = INK;
    ctx.font = `600 19px ${SANS}`;
    ctx.fillText(d.label, PAD + 72, y + 10);
    ctx.fillStyle = '#d2ded5';
    ctx.fillRect(PAD + 362, y + 18, 330, 7);
    ctx.fillStyle = BLUE;
    ctx.fillRect(PAD + 362, y + 18, (d.n / cvMax) * 330, 7);
    ctx.fillStyle = INK;
    ctx.font = `700 14px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${d.n} 部`, W - PAD - 15, y + 13);
    ctx.textAlign = 'left';
  });

  const genreY = 1885;
  sectionTitle(ctx, genreY, '04 / GENRE INDEX', '题材偏好', 'A small index of where the stories led.');
  highlights.byCategory.slice(0, 8).forEach((d, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = PAD + col * 470;
    const y = genreY + 102 + row * 58;
    const shades = ['#e0eadf', '#e4edf0', '#eee8d5', '#e8ece2'];
    ctx.fillStyle = shades[i % shades.length];
    ctx.fillRect(x, y, 446, 44);
    ctx.fillStyle = INK;
    ctx.font = `600 19px ${SANS}`;
    ctx.fillText(d.label, x + 16, y + 10);
    ctx.fillStyle = MUTED;
    ctx.font = `700 14px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${d.n} 部`, x + 426, y + 14);
    ctx.textAlign = 'left';
  });

  const noteY = 2260;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, noteY); ctx.lineTo(W - PAD, noteY); ctx.stroke();
  ctx.fillStyle = SAGE;
  ctx.font = `italic 29px ${SERIF}`;
  ctx.fillText('A note to this year', PAD, noteY + 42);
  ctx.fillStyle = INK;
  ctx.font = `700 17px ${MONO}`;
  ctx.fillText('年度私藏', PAD, noteY + 91);
  ctx.font = `28px ${SANS}`;
  noteLines.forEach((line, i) => ctx.fillText(line, PAD, noteY + 130 + i * 44));

  const footerY = H - 110;
  ctx.fillStyle = INK;
  ctx.fillRect(PAD, footerY, W - PAD * 2, 1);
  ctx.fillStyle = MUTED;
  ctx.font = `13px ${MONO}`;
  ctx.fillText('MADE WITH MY DRAMA ARCHIVE', PAD, footerY + 32);
  ctx.textAlign = 'right';
  ctx.fillText('PRESS PLAY, KEEP THE STORY.', W - PAD, footerY + 32);
  ctx.textAlign = 'left';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('年度长图导出失败')), 'image/png');
  });
}
