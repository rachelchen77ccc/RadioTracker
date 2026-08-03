import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferReleasedMainEpisodes,
  parsePlannedMainEpisodes,
  resolveEpisodeTotal,
} from './episode-total.mjs';

test('优先取详情里的正剧总数，不把免费集和番外算进去', () => {
  assert.equal(parsePlannedMainEpisodes(
    '<p>正剧21集（免费3集）+番外2集（免费1集），另有花絮。</p>'
  ), 21);
});

test('支持总数在正剧前面和中文数字', () => {
  assert.equal(parsePlannedMainEpisodes('第一季共15期正剧+预告*2'), 15);
  assert.equal(parsePlannedMainEpisodes('第一季共十六集（第十六集分上下）正剧'), 16);
});

test('支持没有正剧二字的全季明确总数', () => {
  assert.equal(parsePlannedMainEpisodes('本作品为全一季付费广播剧，共4集，另含1集预告'), 4);
});

test('详情没写总数时按更新到的正剧编号推断', () => {
  assert.equal(inferReleasedMainEpisodes('第7集·他是我的', [
    '剧情预告', '先导花絮·角色讨论', '番外 第二回', '第6集·他没资格',
  ]), 7);
});

test('完全没有编号时才退回上架条目数', () => {
  assert.deepEqual(resolveEpisodeTotal({
    abstract: '', newest: '主题曲', episodeNames: ['预告', '主题曲'],
  }), { total: 2, source: '上架条目' });
});
