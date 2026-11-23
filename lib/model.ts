// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The point of this file is that the implied value is *derived*, not asserted. The snapshot
// holds 758 protocols and 144 of them already have a token with a market cap. Those 144 are the
// only evidence in the file about what a protocol's TVL is worth on the open market, so the
// model reads the multiple off them, per category, and applies it to the protocols that have no
// token yet. Nothing here names a protocol: the same function scores every row, so a different
// snapshot moves every number.
//
//   benchmark  = median(mcap_usd / tvl_usd) over the live protocols in the same category,
//                shrunk toward the whole-market median by sample size, so a category with
//                three members cannot outvote one with fifteen
//   growthMult = 1 + clamp(change_7d, -50, 100) / 100 * GROWTH_WEIGHT
//   ageMult    = AGE_FLOOR + min(age_days, AGE_HORIZON) / AGE_HORIZON * AGE_RANGE
//   implied    = max(1, round(tvl_usd * benchmark * growthMult * ageMult))
//
// Each term earns its place:
//   - benchmark is the market's own valuation of TVL in that category. A DEX trades at a far
//     higher multiple of TVL than a yield aggregator, and the live protocols say so (a median
//     of 0.34x for Dexs against 0.05x for Yield Aggregator in this snapshot).
//   - growth is momentum: a protocol whose TVL grew 40% in a week is being used harder than one
//     that shrank, and a launch prices that in.
//   - age is time spent building without a token, which is the claim a farm is chasing.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_horizon_days: number;
  /** Pseudo-count pulling a thin category's median toward the whole-market median. */
  shrink_prior: number;
  /** Live members a category needs before its own median is used at all. */
  min_sample: number;
  /** The whole-market median, used when a category has no live member at all. */
  fallback_multiple: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.85,
  age_range: 0.3,
  age_horizon_days: 1460,
  shrink_prior: 6,
  min_sample: 2,
  fallback_multiple: 0.169,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One category's benchmark, as the dashboard shows it. */
export interface Benchmark {
  category: string;
  /** Live protocols in this category that the multiple came from. */
  sample: number;
  /** The category's own median mcap/TVL, before shrinkage. */
  raw_multiple: number;
  /** The multiple actually applied: the raw median pulled toward the market by sample size. */
  multiple: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    benchmark_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan drawn in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  benchmark_multiple: number;
  growth_multiplier: number;
  age_multiplier: number;
  in_watchlist: boolean;
  /**
   * Where the protocol sits against the house's floor, said precisely:
   *   'watchlist'      it is on the house's list;
   *   'above-floor'    it clears the $50M floor but the house's list leaves it out (a wrapped,
   *                    staked or versioned name, or a parent protocol's product): the snapshot
   *                    does not carry parentProtocol, so the rule is the list itself;
   *   'below-floor'    its TVL is under the floor, which is exactly why it is not listed.
   * A single "below floor" badge would be false for the second group, which includes protocols
   * far larger than many on the list.
   */
  floor_status: 'watchlist' | 'above-floor' | 'below-floor';
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, the benchmarks and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  benchmarks: Benchmark[];
  rows: RadarRow[];
  live: LiveRow[];
  /** The model's backtest, measured by the entry's own lab and committed beside the page. */
  evidence?: unknown;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle of a list of numbers, averaging the two middles for an even count. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `asOf` back to `listedAt`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The categories that name a product of another protocol's token rather than a protocol that
 * could issue one: a bridge, a staking wrapper or an exchange's own book cannot launch the token
 * that would make it valuable, because the asset it wraps already trades. The watchlist rule uses
 * the same list, so the board and the watchlist never disagree about what a pre-token protocol is.
 */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
  'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);

/** The names a wrapped or staked product carries, which the watchlist rule also excludes. */
const DERIVATIVE_NAME = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is one the board may rank: pre-token, and not a wrapper of a trading token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (DERIVATIVE_NAME.test(p.name)) return false;
  return true;
}

/** The market's own multiple for one live protocol, or null when its TVL or cap is unusable. */
function marketMultiple(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || !(p.tvl_usd > 0)) return null;
  const m = p.mcap_usd / p.tvl_usd;
  return Number.isFinite(m) && m > 0 ? m : null;
}

/** The band a single protocol's market multiple is trusted inside, before it is clipped to it. */
export const MULTIPLE_BAND = { low: 0.005, high: 8 };

/**
 * The benchmark table: one multiple per category, read off the protocols that already trade.
 *
 * This is the model's evidence, not its decoration. Three rules keep one strange record from
 * setting the price of a whole category:
 *   - each observation is clipped to MULTIPLE_BAND, because a market cap a few hundred times its
 *     TVL is a mis-recorded cap (one protocol in this snapshot carries 400x) and not a valuation
 *     any launch should inherit;
 *   - a category needs `min_sample` live members before its own median is used at all, so a
 *     category with one member falls back to the whole market rather than to that one member;
 *   - the surviving median is still pulled toward the whole-market median by `shrink_prior`
 *     pseudo-observations, so a three-member category does not outvote a fifteen-member one.
 */
export function benchmarks(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, Benchmark> {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    const m = marketMultiple(p);
    if (m === null) continue;
    const clipped = Math.min(MULTIPLE_BAND.high, Math.max(MULTIPLE_BAND.low, m));
    all.push(clipped);
    const key = p.category ?? '(unclassified)';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [clipped]);
    else list.push(clipped);
  }
  const marketMedian = all.length > 0 ? median(all) : model.fallback_multiple;
  const table = new Map<string, Benchmark>();
  for (const [category, list] of byCategory) {
    const raw = median(list);
    const n = list.length;
    // Too few members to speak for a category on their own: the market's median stands in.
    const multiple = n < model.min_sample
      ? marketMedian
      : (raw * n + marketMedian * model.shrink_prior) / (n + model.shrink_prior);
    table.set(category, { category, sample: n, raw_multiple: round4(raw), multiple: round4(multiple) });
  }
  table.set('(market)', {
    category: '(market)',
    sample: all.length,
    raw_multiple: round4(marketMedian),
    multiple: round4(marketMedian),
  });
  return table;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: Map<string, Benchmark>,
  model: ModelConstants,
): { implied: number; benchmark: number; growthPct: number; growthMult: number; ageMult: number; age: number | null } {
  const benchmark = table.get(protocol.category ?? '(market)')?.multiple
    ?? table.get('(market)')?.multiple
    ?? model.fallback_multiple;
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = Math.min(Math.max(age ?? 0, 0), model.age_horizon_days);
  const ageMult = model.age_floor + (ageForModel / model.age_horizon_days) * model.age_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * benchmark * growthMult * ageMult));
  return { implied, benchmark, growthPct, growthMult, ageMult, age };
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The board is every pre-token protocol the snapshot carries that could issue a token of its own,
 * not only the house's 40-slug watchlist: the watchlist is a floor at a size the house picked, and
 * the protocols under it are the early radar the page exists to show.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = benchmarks(snapshot, model);
  const scored = snapshot.protocols.filter(isRankable).map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      benchmark_multiple: s.benchmark,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The step a farmer takes in this kind of protocol, in that protocol's own vocabulary.
 *
 * Keyed on the category's words rather than on a list of names, so a protocol the snapshot adds
 * tomorrow gets a plan on the same rule as one that has been there since the fetch.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a little against it and keep both positions open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return `Deposit $${capital} of USDC into ${name}'s tokenised treasury market on ${chain}.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and keep one small position open.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Allocate $${capital} to a ${name} vault on ${chain} and leave it through the window.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  }
  if (c.includes('index') || c.includes('yield aggregator')) {
    return `Buy $${capital} of ${name}'s index or vault shares on ${chain} and hold them.`;
  }
  return `Use ${name} on ${chain} with $${capital} and keep the position live.`;
}

/**
 * A protocol's farm plan: five steps, each an action with what it costs and how long it takes.
 *
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names, so two protocols in the same category still differ in what they
 * cost and how long they take.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a wallet that holds only the funds you plan to farm, and fund it with $${capital} plus gas on ${chain}.`,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '10 to 20 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `the $${capital} stays in the position`,
      time: 'under an hour to open',
    },
    {
      text: `Return once a week and make one qualifying action, a deposit, a borrow, a swap or a vote, so the activity lands in more than one snapshot.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold for at least ${hold} days, since a launch snapshot is taken on a day nobody announces in advance.`,
      cost: 'opportunity cost only',
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, check ${p.name}'s own page and DefiLlama for a token announcement, and claim only from the link the protocol itself publishes.`,
      cost: 'nothing, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => {
      const m = marketMultiple(p);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        multiple: m === null ? null : round4(m),
      };
    });
}

/** A board row's compact form for data.js, with the farm plan drawn in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>, floorUsd: number): RadarRow {
  const inWatchlist = watchlist.has(row.slug);
  const floor_status: RadarRow['floor_status'] = inWatchlist
    ? 'watchlist'
    : row.tvl_usd >= floorUsd ? 'above-floor' : 'below-floor';
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    benchmark_multiple: row.model.benchmark_multiple,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    in_watchlist: inWatchlist,
    floor_status,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const table = benchmarks(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    benchmarks: [...table.values()].sort((a, b) => b.sample - a.sample || b.multiple - a.multiple),
    rows: board.map((r) => radarRow(r, watchlist, snapshot.floor_usd)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
