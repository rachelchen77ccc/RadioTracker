/**
 * 收听状态。「想听 / 囤着」和「搁置」的区别是这套分类的核心：
 *   想听 = 从库里挑出来准备听的短名单
 *   囤着 = 买了堆在库里，还没开始
 *   搁置 = 听了一部分停下了
 */
export type ListenStatus = '在听' | '听完' | '想听' | '囤着' | '搁置' | '弃了';

export const STATUSES: ListenStatus[] = ['在听', '听完', '想听', '囤着', '搁置', '弃了'];
export type Platform = '猫耳' | '漫播' | '其他';
export type Kind = '广播剧' | '听书' | '其他';

export interface Cv {
  id: number;
  name: string;
  character: string | null;
  role_type: string;
}

export interface Drama {
  id: number;
  missevan_id: number | null;
  title: string;
  platform: Platform;
  source: 'notion' | 'missevan' | 'manual';
  kind: Kind | null;
  categories: string[];
  organization: string | null;
  abstract: string | null;
  cover: string | null;
  status: ListenStatus | null;
  purchased: boolean;
  subscribed: boolean;
  heard_episodes: number | null;
  total_episodes: number | null;
  rating: number | null;
  finished_date: string | null;
  rewatch_status: string | null;
  /** 重刷计划：从库里挑出来、还没开始重刷的 */
  rewatch_queued: boolean;
  review: string | null;
  serialize_status: string | null;
  update_info: string | null;
  update_day: string | null;
  price: number | null;
  /** 猫耳记录的上次收听位置（集名）。仅作提示，不是进度真值 */
  sawHint: string | null;
  synced_at: string | null;
  cvs: Cv[];
  weekday?: string;
}

export interface CvStat {
  id: number;
  name: string;
  avatar_url: string | null;
  /** 只统计标记为「听完」的剧 */
  drama_count: number;
  avg_rating: number | null;
}

export interface YearStat {
  year: string;
  count: number;
  avg_rating: number | null;
}

export interface Stats {
  total: number;
  byStatus: { status: string | null; c: number }[];
  byPlatform: { platform: string; c: number }[];
  byKind: { kind: string | null; c: number }[];
  purchased: number;
  subscribed: number;
  reviews: number;
  purchasedTodo: number;
  collectionTodo: number;
  listening: number;
  rewatchQueue: number;
  lastSync: { ran_at: string; kind: string } | null;
}

export interface FacetOption { value: string; n: number }
export type Facets = Record<string, FacetOption[]>;

export interface YearStats {
  year: string;
  total: number;
  avgRating: number | null;
  episodes: number;
  reviews: number;
  byMonth: { month: number; n: number }[];
  byRating: { label: string; n: number }[];
  byCategory: { label: string; n: number }[];
  topCvs: { label: string; n: number }[];
  topRated: { label: string; n: number }[];
}
