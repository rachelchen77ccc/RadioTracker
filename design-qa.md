# Design QA — 单剧分享长图「专辑播放」面板

- Source visual truth: `/var/folders/35/9ll_s7nx0210jrl4zv__7w7c0000gp/T/codex-clipboard-70a8fd7c-46fe-47f0-a4d4-1b3d3287029f.png`
- Implementation screenshot: `/private/tmp/radiotracker-player-share.png`
- Combined comparison: `/private/tmp/radiotracker-player-comparison.png`
- Source pixels: 1200 × 675
- Implementation pixels: 2160 × 1404
- Canvas CSS size / density: 1080 × 702 CSS px at 2× export density
- Comparison canvas: 2400 × 1400; both images fit proportionally without cropping
- State: drama `FILE_0242`（赤霞珠），有封面、主役 CV、平台、同步日期和 1/21 进度；无评分、无剧评

## Full-view comparison evidence

The combined comparison shows that the implementation keeps the reference's main compositional idea—a wide rounded playback surface, square album art on the left, and playback information on the right—without copying the iPhone frame, device label, transport icons, or exact control layout. The implementation instead uses RadioTracker's paper archive frame, kraft file tab, monospace metadata, and barcode footer.

## Focused region evidence

The implementation screenshot was also opened at full 2160 × 1404 resolution. A separate crop was not needed because the playback panel is a single contained region and its title, CV, three metadata fields, cover crop, progress line, border, and padding are all legible in that full-resolution view.

## Required fidelity surfaces

- Fonts and typography: hierarchy is clear across `NOW PLAYING`, drama title, cast, facts, and progress. Standard `bold` canvas font syntax avoids renderer-specific numeric-weight parsing problems. Chinese display text uses the existing system CJK stack; compact UI labels use the existing mono stack.
- Spacing and layout rhythm: cover and metadata use a stable two-column layout with 36–48 px interior padding. The 28 px panel radius and 15 px cover radius are visually consistent and do not crowd the archive border.
- Colors and visual tokens: dark neutral playback panel, warm paper, kraft tab, muted gray labels, and a restrained blush score accent remain aligned with the existing archive palette. Contrast is sufficient.
- Image quality and asset fidelity: the real drama cover is center-cropped as a square without stretching and exported at 2× density. No placeholder or generated cassette asset remains in the implementation.
- Copy and content: the right column includes the requested drama title, main CVs, rating, platform, and date, plus listening progress. Missing ratings are shown as an em dash.

## Comparison history

1. First render: the local QA canvas renderer interpreted numeric font weights inconsistently, producing oversized glyphs in metadata. This was treated as a P1 rendering-compatibility issue.
2. Fix: switched canvas font weights to the standards-compatible `bold` keyword and changed compact player labels to concise English while retaining Chinese content values.
3. Post-fix evidence: `/private/tmp/radiotracker-player-share.png` and `/private/tmp/radiotracker-player-comparison.png` show correct type scale, no overlaps, a clean square cover crop, aligned fact columns, and an intact progress line.

## Findings

No actionable P0/P1/P2 visual mismatches remain. The implementation intentionally omits transport-control icons and the device shell so it reads as a RadioTracker share card rather than a copy of the reference image.

## Interaction and test notes

- Share image rendering executed against real local API data and completed successfully.
- Production TypeScript/Vite build passed.
- Existing episode-total tests passed (5/5).
- The in-app browser could not open the localhost preview because of its security policy, so the share canvas was rendered directly from the production `renderShareCard` function for visual evidence.
- Sidebar groups initialize as folded and remain individually expandable through the existing heading controls.

## Follow-up polish

- P3: review a few unusually long titles and CV lists in the browser when localhost access is available.

final result: passed
