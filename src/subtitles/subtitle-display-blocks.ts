/**
 * subtitle-display-blocks.ts
 * 同世代のtimelineと本文準備結果から表示枠を導出する純関数。
 * 本文変換・時刻分類・DOM・購読・キャッシュ・session管理は担当しない。
 */
import type { SubtitleDisplayBlock, SubtitleDisplayItem, SubtitleTimeline, TimedSubtitleText } from '../shared/types';
import type { PreparedSubtitleItem, PreparedSubtitleItems } from './subtitle-text-parts';

/** 呼出し内だけで使う、元時刻と準備結果を照合した字幕。 */
type Entry = PreparedSubtitleItem & { startTime: number; endTime: number };
/** 学習言語の存在区間。母国語の配置によって変更しない。 */
type Interval = { startTime: number; endTime: number };
/** 構成確定後の学習言語比較区間と、配置中の母国語。外部へ返さない。 */
type Group = { primary: Entry[]; secondary: Entry[]; intervals: Interval[] };

/**
 * 元入力位置と要素数を照合し、必要な値だけをコピーする。
 * @param timeline 構築済みの1言語の元字幕。
 * @param prepared 同世代の1言語の準備結果。元入力順であること。
 * @returns 呼出し内だけで利用する字幕配列。
 * @throws RangeError 件数・元入力位置・時刻・順序・本文型・分類が不正な場合。
 */
const readEntries = (timeline: readonly TimedSubtitleText[], prepared: readonly PreparedSubtitleItem[]): Entry[] => {
  if (timeline.length !== prepared.length) throw new RangeError('Subtitle display item count does not match timeline');
  const entries: Entry[] = [];
  let previousStart = 0;
  for (let index = 0; index < timeline.length; index += 1) {
    const cue = timeline[index];
    const item = prepared[index];
    if (cue === undefined || item === undefined || item.sourceIndex !== index ||
        (item.kind !== 'dialogue' && item.kind !== 'auxiliary') || typeof item.text !== 'string' ||
        !Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime) ||
        cue.startTime < previousStart || cue.startTime < 0 || cue.endTime <= cue.startTime) {
      throw new RangeError('Subtitle display input is invalid');
    }
    entries.push({ kind: item.kind, sourceIndex: index, text: item.text, startTime: cue.startTime, endTime: cue.endTime });
    previousStart = cue.startTime;
  }
  return entries;
};

/** @param left 左の区間。@param right 右の区間。@returns 正の重なり時間。接触だけなら0。 */
const overlap = (left: Interval, right: Interval): number =>
  Math.max(0, Math.min(left.endTime, right.endTime) - Math.max(left.startTime, right.startTime));

/** @param left 左の元字幕。@param right 右の元字幕。@returns 所属言語の元入力順。 */
const compareInput = (left: Entry, right: Entry): number => left.sourceIndex - right.sourceIndex;

/**
 * 学習言語区間の和集合を作り、内部空白と二重計上を除く。
 * @param primary 元入力順の非空学習言語配列。
 * @returns 入力と独立した開始時刻順の区間。
 */
const buildIntervals = (primary: readonly Entry[]): Interval[] => {
  const intervals: Interval[] = [];
  for (const entry of primary) {
    const last = intervals[intervals.length - 1];
    if (last !== undefined && entry.startTime <= last.endTime) last.endTime = Math.max(last.endTime, entry.endTime);
    else intervals.push({ startTime: entry.startTime, endTime: entry.endTime });
  }
  return intervals;
};

/**
 * 結合済み構成の比較区間を固定する。
 * @param primary 枠へ入れる学習言語。非空であること。
 * @param secondary 結合根拠の母国語。ない場合は空配列。
 * @returns 配置中だけ所有するgroup。
 */
const createGroup = (primary: Entry[], secondary: Entry[]): Group => {
  primary.sort(compareInput);
  return { primary, secondary, intervals: buildIntervals(primary) };
};

/**
 * 全要素から時間範囲を求め、公開用の表示要素だけをコピーする。
 * @param kind セリフまたは補助。
 * @param primary 学習言語の表示要素。空も許可する。
 * @param secondary 母国語の表示要素。空も許可する。
 * @returns DOMや内部作業値を含まない表示枠。
 * @throws Error 両言語が空の場合。内部の構築不整合として扱う。
 */
const createBlock = (kind: SubtitleDisplayBlock['kind'], primary: Entry[], secondary: Entry[]): SubtitleDisplayBlock => {
  primary.sort(compareInput);
  secondary.sort(compareInput);
  let startTime = Infinity;
  let endTime = -Infinity;
  const values: { primary: SubtitleDisplayItem[]; secondary: SubtitleDisplayItem[] } = { primary: [], secondary: [] };
  for (const role of ['primary', 'secondary'] as const) {
    for (const entry of role === 'primary' ? primary : secondary) {
      startTime = Math.min(startTime, entry.startTime);
      endTime = Math.max(endTime, entry.endTime);
      values[role].push({ sourceIndex: entry.sourceIndex, text: entry.text });
    }
  }
  if (startTime === Infinity) throw new Error('Cannot create an empty subtitle display block');
  return { kind, startTime, endTime, ...values };
};

/**
 * 区分内で共通に使う固定順へ並べる。区分判定は行わない。
 * @param left 左の非空表示枠。
 * @param right 右の非空表示枠。
 * @returns 開始・終了・種別・言語役割・元入力位置の比較結果。
 */
const compareBlocks = (left: SubtitleDisplayBlock, right: SubtitleDisplayBlock): number => {
  const time = left.startTime - right.startTime || left.endTime - right.endTime;
  if (time !== 0) return time;
  if (left.kind !== right.kind) return left.kind === 'dialogue' ? -1 : 1;
  const leftPrimary = left.primary[0];
  const rightPrimary = right.primary[0];
  if (leftPrimary !== undefined && rightPrimary !== undefined) return leftPrimary.sourceIndex - rightPrimary.sourceIndex;
  if (leftPrimary !== undefined) return -1;
  if (rightPrimary !== undefined) return 1;
  const leftSecondary = left.secondary[0];
  const rightSecondary = right.secondary[0];
  if (leftSecondary === undefined || rightSecondary === undefined) throw new Error('Missing subtitle display item');
  return leftSecondary.sourceIndex - rightSecondary.sourceIndex;
};

/**
 * 元字幕を変更せず、結合・競合・配置と独立した補助枠を導出する。
 * @param timeline 構築済みの元字幕。準備結果と同じ世代であること。
 * @param prepared 言語別件数と元入力順を保持した本文準備結果。
 * @returns 固定順の新しい全枠配列。入力・別呼出しと枠や表示要素を共有しない。
 * @throws RangeError 入力の照合条件に違反する場合。同形の別世代までは検出しない。
 * @throws Error 内部の構築不整合。正常な空へ置き換えない。
 */
export const buildSubtitleDisplayBlocks = (timeline: SubtitleTimeline, prepared: PreparedSubtitleItems): readonly SubtitleDisplayBlock[] => {
  const primary = readEntries(timeline.primary, prepared.primary);
  const secondary = readEntries(timeline.secondary, prepared.secondary);
  const frames: Entry[][] = [];
  const byTime = new Map<string, Entry[]>();
  for (const entry of primary) {
    if (entry.kind !== 'dialogue') continue;
    const key = `${entry.startTime}:${entry.endTime}`;
    const existing = byTime.get(key);
    if (existing !== undefined) existing.push(entry);
    else {
      const frame = [entry];
      byTime.set(key, frame);
      frames.push(frame);
    }
  }

  const groups: Group[] = [];
  const locked = new Set<number>();
  const placed = new Set<number>();
  // secondaryは元の開始時刻順・同点は元入力順。確定済み枠を別候補で拡張しない。
  for (const entry of secondary) {
    if (entry.kind !== 'dialogue') continue;
    const matched: number[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      const first = frames[index]?.[0];
      if (first !== undefined && overlap(first, entry) > 0) matched.push(index);
    }
    const firstIndex = matched[0];
    const lastIndex = matched[matched.length - 1];
    if (matched.length < 2 || firstIndex === undefined || lastIndex === undefined) continue;
    // 非連続の端ケースは結合せず、通常配置へ回すだけに留める。
    if (lastIndex - firstIndex + 1 !== matched.length) continue;
    let conflict = false;
    for (const index of matched) if (locked.has(index)) conflict = true;
    if (conflict) continue;
    const members: Entry[] = [];
    for (const index of matched) {
      const frame = frames[index];
      if (frame === undefined) throw new Error('Missing primary display frame');
      for (const member of frame) members.push(member);
      locked.add(index);
    }
    groups.push(createGroup(members, [entry]));
    placed.add(entry.sourceIndex);
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) throw new Error('Missing primary display frame');
    if (!locked.has(index)) groups.push(createGroup(frame, []));
  }

  // 同点時の選択順を学習言語の最早開始・最初の元入力位置で固定する。
  groups.sort(/** @param left 左group。@param right 右group。@returns 学習言語の固定優先順。 */ (left, right) => {
    const a = left.primary[0];
    const b = right.primary[0];
    if (a === undefined || b === undefined) throw new Error('Missing primary display item');
    return a.startTime - b.startTime || a.sourceIndex - b.sourceIndex;
  });
  const blocks: SubtitleDisplayBlock[] = [];
  for (const entry of secondary) {
    if (entry.kind !== 'dialogue' || placed.has(entry.sourceIndex)) continue;
    let best: Group | undefined;
    let bestOverlap = 0;
    for (const group of groups) {
      let duration = 0;
      for (const interval of group.intervals) duration += overlap(interval, entry);
      if (duration > bestOverlap) { best = group; bestOverlap = duration; }
    }
    // 母国語を加えても比較区間を変えず、後続配置へ連鎖させない。
    if (best !== undefined) best.secondary.push(entry);
    else blocks.push(createBlock('dialogue', [], [entry]));
  }
  for (const group of groups) blocks.push(createBlock('dialogue', group.primary, group.secondary));
  for (const entry of primary) if (entry.kind === 'auxiliary') blocks.push(createBlock('auxiliary', [entry], []));
  for (const entry of secondary) if (entry.kind === 'auxiliary') blocks.push(createBlock('auxiliary', [], [entry]));
  return blocks.sort(compareBlocks);
};
