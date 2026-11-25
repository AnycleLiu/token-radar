// Token launch radar model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that records no token yet and is a plausible launch candidate:
// pre-token (no market cap, no CoinGecko id, no symbol in its record), not an exchange's reserve
// page, not a versioned copy of another pool, and not a wrapped, staked or bridged product of a
// protocol whose token already trades. The snapshot's watchlist is the floor of the board, never
// its ceiling: every watchlist slug is ranked, and so is every other eligible protocol the
// snapshot carries, down to the $5,000,000 TVL line the snapshot itself stops at. Protocols whose
// token already trades are set aside as the live set: the market prices them, a model does not.
//
// Implied value is priced the way the market prices the protocol's own sector. The snapshot's
// live protocols give, for each category, the ratio of market cap to TVL at which that sector
// actually trades; a pre-token protocol's base value is its TVL times its category's median
// ratio, shrunk toward the market-wide median when the category has few live peers to learn
// from. Three adjustments follow, each from the protocol's own figures and each shown on the
// board, so a reader can rebuild any row's number by hand:
//
//   base        = tvl_usd x peer_multiple(category)
//   momentum    = 1 + clamp(change_7d, -60, 120) / 100 x 0.5     (a hot week is worth half its %)
//   seasoning   = 0.7 + 0.3 x min(age_days, 1460) / 1460         (four tokenless years, full marks)
//   breadth     = 1 + 0.015 x min(chains - 1, 10)                 (each extra chain, a wider launch)
//   implied     = max(1, round(base x momentum x seasoning x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and a protocol the
// snapshot adds tomorrow is scored the day it appears. That is what makes it a radar.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  seasoning_base: number;
  seasoning_span: number;
  seasoning_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
  shrink_peers: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.5,
  momentum_floor: -60,
  momentum_cap: 120,
  seasoning_base: 0.7,
  seasoning_span: 0.3,
  seasoning_days: 1460,
  breadth_per_chain: 0.015,
  breadth_max_extra: 10,
  shrink_peers: 8,
};

export const MODEL_VERSION = 'peer-radar-2';

/** A protocol records no token when all three token fields are empty. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /(?:^|\s)(?:V\d+|v\d+|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(?:wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const TICKER_NAME = /^[A-Z][A-Z0-9]{1,5}$/;

/**
 * A launch candidate: pre-token, and not one of the records the house's own watchlist rule sets
 * aside (an exchange page, a versioned pool, a wrapped or staked product of a token that trades).
 * The same test is applied at every size, so the board's rule never changes with a row's TVL.
 * One more screen, same principle: a bridge record named by a bare ticker (WBTC, USDT0) is the
 * traded asset itself wearing a bridge's clothes, so it sits with the live set, not the board.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if ((p.category === 'Bridge' || p.category === 'Canonical Bridge') && TICKER_NAME.test(p.name)) return false;
  return true;
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot's date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface PeerStats {
  /** Market-wide median mcap/TVL over every live protocol that reports both figures. */
  global_multiple: number;
  global_peers: number;
  /** Per-category shrunk multiple and the number of live peers behind it. */
  by_category: Map<string, { multiple: number; peers: number; median: number }>;
}

/**
 * What each sector's token trades for, learned from the snapshot's live set: for every category,
 * the median market-cap-to-TVL ratio of its live protocols, shrunk toward the market-wide median
 * by the peer count, so a category with two wild peers cannot price a board row on its own.
 */
export function peerStats(snapshot: Snapshot, model: ModelConstants = MODEL): PeerStats {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    // Winsorise: one micro-cap outlier must not price a whole sector. No live sector in the
    // snapshot trades durably above 3x TVL or below a hundredth of it.
    const r = Math.min(3, Math.max(0.01, p.mcap_usd / p.tvl_usd));
    if (!Number.isFinite(r)) continue;
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(r);
    ratios.set(key, list);
    all.push(r);
  }
  const globalMultiple = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, { multiple: number; peers: number; median: number }>();
  for (const [key, list] of ratios) {
    const med = median(list);
    const shrunk = (list.length * med + model.shrink_peers * globalMultiple) / (list.length + model.shrink_peers);
    byCategory.set(key, { multiple: shrunk, peers: list.length, median: med });
  }
  return { global_multiple: globalMultiple, global_peers: all.length, by_category: byCategory };
}

export interface Scored {
  implied: number;
  peer_multiple: number;
  peer_count: number;
  category_median: number;
  momentum_multiplier: number;
  seasoning_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

/** Score one protocol. Pure: the same record always earns the same number. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  stats: PeerStats,
  model: ModelConstants = MODEL,
): Scored {
  const cat = stats.by_category.get(p.category ?? 'Uncategorised');
  const peerMultiple = cat?.multiple ?? stats.global_multiple;
  const peerCount = cat?.peers ?? 0;
  const categoryMedian = cat?.median ?? stats.global_multiple;
  const base = p.tvl_usd * peerMultiple;
  const growthPct = p.change_7d === null ? 0 : Math.min(model.momentum_cap, Math.max(model.momentum_floor, p.change_7d));
  const momentum = 1 + (growthPct / 100) * model.momentum_weight;
  const age = ageDays(asOf, p.listed_at);
  const seasoning =
    age === null
      ? model.seasoning_base + model.seasoning_span / 2
      : model.seasoning_base + (model.seasoning_span * Math.min(age, model.seasoning_days)) / model.seasoning_days;
  const breadth = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(base * momentum * seasoning * breadth));
  return {
    implied,
    peer_multiple: peerMultiple,
    peer_count: peerCount,
    category_median: categoryMedian,
    momentum_multiplier: momentum,
    seasoning_multiplier: seasoning,
    breadth_multiplier: breadth,
    age_days: age,
  };
}

// ---------- farm plans ----------

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one board string: its action, then its cost and time, inside the gate's 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and recheck it weekly.`;
  return s;
}

/** Working capital for one farm position, scaled to the protocol's own size. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 1000;
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Weeks to keep a position live: younger protocols earn a longer qualifying window. */
function holdWeeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  return 4;
}

function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum') || c === 'mainnet') return 'about $8 in ETH gas at quiet hours';
  if (c.includes('bitcoin') || c.includes('lightning')) return 'about $1 in network fees';
  if (c.includes('solana')) return 'under $0.10 in SOL fees';
  return 'about $0.50 in gas on this chain';
}

interface Playbook {
  open: (name: string, chain: string, cap: number) => string;
  deepen: (name: string, chain: string, cap: number) => string;
}

/** The two moves that earn eligibility in each sector, in words a farmer can follow. */
const PLAYBOOKS: [RegExp, Playbook][] = [
  [/lend|cdp|collateral/, {
    open: (n, ch, cap) => `Supply $${cap} of USDC as collateral to ${n} on ${ch} and borrow about 40% against it, so the account shows both sides of the market`,
    deepen: (n, ch, cap) => `Repay and re-borrow once, then leave the loan open; lenders count sustained borrowers, not one-day deposits`,
  }],
  [/dex|exchange/, {
    open: (n, ch, cap) => `Provide $${cap} of liquidity to ${n}'s busiest stablecoin pool on ${ch} and keep the LP position open`,
    deepen: (n, ch, cap) => `Route about $${Math.round(cap / 2)} of swaps a week through ${n} itself, so the wallet reads as a trader, not only a depositor`,
  }],
  [/bridge/, {
    open: (n, ch, cap) => `Bridge $${cap} of USDC to ${ch} through ${n} and keep the bridged funds working in the destination app`,
    deepen: (n, ch, cap) => `Bridge a second, different asset (about $${Math.round(cap / 2)}) on a later day; repeat crossings count more than one large one`,
  }],
  [/staking|restak|staking pool/, {
    open: (n, ch, cap) => `Stake $${cap} of the chain's staking asset through ${n} on ${ch} and hold the receipt token in the same wallet`,
    deepen: (n, ch, cap) => `Add about $${Math.round(cap / 2)} more after two weeks instead of staking once; a growing stake reads as conviction`,
  }],
  [/derivative|perpetual|options/, {
    open: (n, ch, cap) => `Deposit $${cap} of USDC as margin on ${n} and open one small hedged position (long and short of equal size)`,
    deepen: (n, ch, cap) => `Trade about $${Math.round(cap / 2)} of volume a week in small clips; volume over time is what these points programs weigh`,
  }],
  [/prediction/, {
    open: (n, ch, cap) => `Fund $${cap} of USDC on ${n} and take small positions (about $${Math.round(cap / 10)} each) on its most liquid markets, on both sides over the week`,
    deepen: (n, ch, cap) => `Provide liquidity to two open markets on ${n} with about $${Math.round(cap / 2)}; market makers are the wallets prediction platforms reward first`,
  }],
  [/curator|allocator|capital/, {
    open: (n, ch, cap) => `Deposit $${cap} into a ${n} vault on ${ch} (pick the vault with the most depositors) and keep the vault shares`,
    deepen: (n, ch, cap) => `Split a second $${Math.round(cap / 2)} deposit into a different ${n} vault on another chain it curates, if it lists one`,
  }],
  [/rwa|real world/, {
    open: (n, ch, cap) => `Mint $${cap} of ${n}'s yield-bearing asset on ${ch} after its onboarding check and hold the asset`,
    deepen: (n, ch, cap) => `Hold through a full monthly distribution cycle; RWA programs reward wallets that stay for the payout, not flippers`,
  }],
  [/basis|funding/, {
    open: (n, ch, cap) => `Deposit $${cap} of USDC into ${n}'s basis vault on ${ch} and keep the position delta-neutral as instructed`,
    deepen: (n, ch, cap) => `Leave the position untouched through two funding cycles; churning a basis vault resets most loyalty counters`,
  }],
  [/insurance|cover/, {
    open: (n, ch, cap) => `Buy $${cap} of cover from ${n} on ${ch} for a protocol you actually use and keep the policy to expiry`,
    deepen: (n, ch, cap) => `Stake about $${Math.round(cap / 2)} into ${n}'s underwriting pool once the first policy is live`,
  }],
  [/stable|wrapper|money/, {
    open: (n, ch, cap) => `Mint or deposit $${cap} of the stable asset through ${n} on ${ch} and hold it in the minting wallet`,
    deepen: (n, ch, cap) => `Use the minted asset in one partner integration ${n} lists (a pool or a lending market) instead of letting it sit idle`,
  }],
  [/yield/, {
    open: (n, ch, cap) => `Deposit $${cap} into ${n}'s main vault on ${ch} and keep the shares; vault share balance is the usual eligibility meter`,
    deepen: (n, ch, cap) => `Compound the yield back into the same vault weekly rather than withdrawing it, so the balance only grows`,
  }],
  [/chain|payments|governance/, {
    open: (n, ch, cap) => `Bridge $${cap} of USDC to ${n}'s chain and make one real transaction a week (a transfer or a swap in its own app)`,
    deepen: (n, ch, cap) => `Hold a small balance on the chain itself between sessions; chains weight resident balances over drive-by visits`,
  }],
];

const FALLBACK: Playbook = {
  open: (n, ch, cap) => `Deposit $${cap} of USDC into ${n} on ${ch} through its own app and keep the position open`,
  deepen: (n, ch, cap) => `Use one second feature of ${n} (a second pool, market or vault) with about $${Math.round(cap / 2)}; breadth inside one protocol counts`,
};

function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const [re, book] of PLAYBOOKS) if (re.test(c)) return book;
  return FALLBACK;
}

const fmtUsd = (n: number): string => `$${n.toLocaleString('en-US')}`;

/**
 * A protocol's farm plan: six steps, each an action with its cost and its time, built from the
 * protocol's own record (category, chains, TVL, age, seven-day move) — never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const cap = capitalFor(p);
  const weeks = holdWeeksFor(age);
  const book = playbookFor(p);
  const gas = gasFor(chain);
  const steps: FarmStep[] = [
    {
      text: `Set up one wallet for ${p.name} and fund it on ${chain} with ${fmtUsd(cap)} of working capital plus a little of the chain's gas token`,
      cost: gas,
      time: '15 minutes, once',
    },
    { text: book.open(p.name, chain, cap), cost: gas, time: '10 minutes, once' },
    { text: book.deepen(p.name, chain, cap), cost: gasFor(secondChain ?? chain), time: '10 minutes, once' },
  ];
  if (secondChain !== null) {
    steps.push({
      text: `Repeat the core position on ${secondChain}, where ${p.name} also runs, with about ${fmtUsd(Math.round(cap / 2))}; multi-chain users are the wallets launch snapshots usually weight highest`,
      cost: gasFor(secondChain),
      time: '15 minutes, once',
    });
  }
  if (p.change_7d !== null && p.change_7d >= 5) {
    steps.push({
      text: `${p.name}'s TVL rose ${p.change_7d.toFixed(1)}% in the snapshot's seven days; add the second deposit this week while the program is growing, because points windows usually open before the crowd arrives`,
      cost: gas,
      time: '10 minutes, this week',
    });
  }
  steps.push(
    {
      text: `Hold every position for ${weeks} weeks and recheck the wallet's eligibility page (or points dashboard, if ${p.name} runs one) each week; do not withdraw before a snapshot date passes`,
      cost: '$0 beyond the gas already spent',
      time: `5 minutes a week for ${weeks} weeks`,
    },
    {
      text: age !== null && age >= 365
        ? `${p.name} has run ${Math.floor(age / 30)} months with no token recorded; keep the position and a dated record of it, since long pre-token histories are exactly what retroactive allocations reward`
        : `Keep dated screenshots or transaction links for each step; if ${p.name} announces a token, eligibility is usually read from records exactly like these`,
      cost: '$0',
      time: '5 minutes, once a month',
    },
  );
  return steps.slice(0, 8);
}

// ---------- board ----------

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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    category_median: number;
    momentum_multiplier: number;
    seasoning_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  global_peers: number;
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const stats = peerStats(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => ({ p, s: impliedValue(p, snapshot.as_of, stats, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peer_multiple),
      peer_count: s.peer_count,
      category_median: round4(s.category_median),
      momentum_multiplier: round4(s.momentum_multiplier),
      seasoning_multiplier: round4(s.seasoning_multiplier),
      breadth_multiplier: round4(s.breadth_multiplier),
      age_days: s.age_days,
    },
    farm_steps: farmSteps(p, s.age_days).map(stepText),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(stats.global_multiple),
    global_peers: stats.global_peers,
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The data.js the dashboard reads: the same board, as one script. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Parse and lightly validate a snapshot file's text. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** The first gate issue with this board, or null when the gate's rows all pass on shape. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `watchlist slug missing from board: ${slug}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank sequence broken at row ${i}`;
    if (i > 0 && board[i - 1]!.implied_value_usd < r.implied_value_usd) return `implied value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug}: farm step of ${n} chars`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every implied value is the same';
  return null;
}
