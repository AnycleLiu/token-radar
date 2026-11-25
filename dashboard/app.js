// Token Launch Radar dashboard: renders window.RADAR (written by main.ts from the sealed
// snapshot) as a sortable, filterable board with a per-protocol detail view. No network, no
// framework: the page is three files and the data script beside it.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const fmtUsd = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const fmtPct = (n) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const fmtAge = (days) => {
  if (days === null) return 'untracked';
  if (days >= 730) return `${(days / 365).toFixed(1)} yrs`;
  if (days >= 60) return `${Math.round(days / 30)} mo`;
  return `${days} days`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- header, stats, method ----------

$('snapshotMeta').innerHTML =
  `snapshot <b>${esc(R.as_of)}</b> · DefiLlama public API<br>${R.protocols_size} protocols ≥ $5M TVL · model <b>${esc(R.model_version)}</b>`;

const topRow = R.rows[0];
$('stats').innerHTML = [
  [String(R.board_size), 'protocols ranked'],
  [`${R.watchlist_size}<em>/${R.watchlist_size}</em>`, 'watchlist covered'],
  [String(R.early_size), 'found beyond the watchlist'],
  [fmtUsd(topRow.implied_value_usd), `top launch: ${esc(topRow.name)}`],
  [`×${R.global_multiple.toFixed(3)}`, `market median (mcap/TVL, ${R.global_peers} live peers)`],
].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

$('method').innerHTML =
  `<b>How a row is priced.</b> Each sector's live tokens give a market-cap-to-TVL multiple; a pre-token protocol's base is ` +
  `its TVL × its own sector's median multiple (shrunk toward the market median when the sector has few live peers), then ` +
  `adjusted for its 7-day TVL momentum, for how long it has run with no token, and for chain breadth. ` +
  `<span class="formula">implied = TVL × sector × × (1 + ½·7d%) × seasoning × breadth</span> — every factor is printed in the detail view, ` +
  `so any row can be rebuilt by hand. Protocols whose token already trades are set aside below, priced by the market, never by this model.`;

// ---------- controls ----------

const categories = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
$('category').innerHTML += categories.map((c) => `<option>${esc(c)}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('chain').innerHTML += chains.map((c) => `<option>${esc(c)}</option>`).join('');

const state = { q: '', scope: 'all', category: '', chain: '', minTvl: 0, sort: 'rank', selected: null };

function visible() {
  let rows = R.rows.filter((r) =>
    (state.scope === 'all' || (state.scope === 'watchlist') === r.watchlist) &&
    (state.category === '' || (r.category ?? 'Uncategorised') === state.category) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.minTvl &&
    (state.q === '' || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    multiple: (a, b) => b.model.peer_multiple - a.model.peer_multiple,
  }[state.sort];
  return rows.sort(by);
}

const CAP = 120;
function render() {
  const rows = visible();
  $('count').textContent = `${rows.length} of ${R.board_size} rows`;
  $('rows').innerHTML = rows.slice(0, CAP).map((r) => `
    <tr data-slug="${esc(r.slug)}" class="${state.selected === r.slug ? 'selected' : ''}">
      <td class="num rank">${r.rank}</td>
      <td class="proto"><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category ?? '—')}</td>
      <td class="chains">${r.chains.length > 2 ? `${esc(r.chains[0])} +${r.chains.length - 1}` : esc(r.chains.join(', ') || '—')}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${fmtPct(r.change_7d)}</td>
      <td class="num">×${r.model.peer_multiple.toFixed(3)}</td>
      <td class="num val">${fmtUsd(r.implied_value_usd)}</td>
      <td class="num">${r.farm_steps.length} steps</td>
    </tr>`).join('');
  $('more').textContent = rows.length > CAP
    ? `Showing the first ${CAP} of ${rows.length} matching rows — narrow the filters to see the rest. The full board is in board.json.`
    : `${rows.length} matching rows — the full ranked board, nothing held back.`;
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => { state.selected = tr.dataset.slug; render(); showDetail(); });
  }
}

// ---------- detail ----------

function splitStep(s) {
  const m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
  if (!m) return { text: s, cost: '', time: '' };
  return { text: m[1], cost: m[2], time: m[3] };
}

function showDetail() {
  const r = R.rows.find((x) => x.slug === state.selected);
  if (!r) { $('detail').innerHTML = '<p class="empty">Select any row to see how its value is built<br>and exactly how to farm it.</p>'; return; }
  const m = r.model;
  const base = r.tvl_usd * m.peer_multiple;
  const afterMom = base * m.momentum_multiplier;
  const afterSea = afterMom * m.seasoning_multiplier;
  const max = Math.max(r.implied_value_usd, base);
  const wf = [
    ['TVL × sector ×', base, ''],
    ['× momentum', afterMom, 'step'],
    ['× seasoning', afterSea, 'step'],
    ['× breadth → implied', r.implied_value_usd, ''],
  ].map(([k, v, cls]) => `
    <div class="wf-row"><span class="k">${k}</span><span class="bar"><i class="${cls}" style="width:${Math.max(2, (v / max) * 100)}%"></i></span><span class="v">${fmtUsd(Math.round(v))}</span></div>`).join('');
  $('detail').innerHTML = `
    <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h2>
    <div class="sub">#${r.rank} of ${R.board_size} · ${esc(r.slug)} · records no token</div>
    <div class="implied">${fmtUsd(r.implied_value_usd)}</div>
    <div class="implied-k">implied launch value, if its record held</div>
    <div class="facts">
      <span class="k">TVL</span><span class="v">${fmtUsd(r.tvl_usd)}</span>
      <span class="k">7-day TVL</span><span class="v">${fmtPct(r.change_7d)}</span>
      <span class="k">Category</span><span class="v">${esc(r.category ?? '—')}</span>
      <span class="k">Chains</span><span class="v">${r.chains.length}</span>
      <span class="k">Tokenless for</span><span class="v">${fmtAge(r.age_days)}</span>
      <span class="k">Tracked since</span><span class="v">${esc(r.listed_at ?? '—')}</span>
    </div>
    <div class="waterfall"><h3>How the value is built</h3>${wf}
      <p style="color:var(--muted);font-size:12px;margin:7px 0 0">Sector multiple ×${m.peer_multiple.toFixed(3)} — the median of ${m.peer_count} live ${esc(r.category ?? '')} peers (raw median ×${m.category_median.toFixed(3)}), shrunk toward the market median ×${R.global_multiple.toFixed(3)}. Momentum ×${m.momentum_multiplier.toFixed(2)}, seasoning ×${m.seasoning_multiplier.toFixed(2)}, breadth ×${m.breadth_multiplier.toFixed(2)}.</p>
    </div>
    <div class="plan"><h3>Farm plan — ${r.farm_steps.length} steps</h3><ol>
      ${r.farm_steps.map((s) => { const p = splitStep(s); return `<li>${esc(p.text)}<span class="chips"><span class="chip">cost ${esc(p.cost)}</span><span class="chip time">time ${esc(p.time)}</span></span></li>`; }).join('')}
    </ol></div>`;
}

// ---------- live set ----------

$('live').innerHTML = `
  <h3>Already trading — set aside, not ranked</h3>
  <p>These protocols' tokens exist, so the market prices them; the radar's model never touches them. Shown so the board's line between “still to come” and “already here” is visible.</p>
  <div class="chips-row">${R.live.map((p) => `<span class="lchip"><b>${esc(p.name)}</b> · mcap ${fmtUsd(p.mcap_usd ?? 0)} · TVL ${fmtUsd(p.tvl_usd)}</span>`).join('')}</div>`;

// ---------- wiring ----------

$('q').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); render(); });
$('scope').addEventListener('change', (e) => { state.scope = e.target.value; render(); });
$('category').addEventListener('change', (e) => { state.category = e.target.value; render(); });
$('chain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
$('minTvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

state.selected = R.rows[0].slug;
render();
showDetail();
