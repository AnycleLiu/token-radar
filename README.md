# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AnycleLiu/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AnycleLiu/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. From a sealed DefiLlama snapshot (758 protocols, 40 on a
watchlist, frozen 2026-11-14), it ranks 260 pre-token protocols by implied
launch value and gives each a concrete, costed farm plan.

**The valuation model** prices a pre-token protocol from the snapshot's own
figures: its TVL multiplied by the market-cap/TVL multiple that already-listed
protocols in the same category actually trade at (median of live peers, ratios
winsorised to [0.01, 3], shrunk toward the global median when a category has
few live peers), adjusted for 7-day TVL momentum, for how long the protocol
has operated without a token, and for chain breadth. No protocol is named in
the model; every number on the board can be recomputed from the snapshot by
hand, and the dashboard shows each row's full factor breakdown. Protocols
that are already tradeable assets in their own right (a bare ticker such as
WBTC or USDT0 tracked as a bridge record, exchange-operated entries, versioned
re-deploys, wrapped/staked variants) are set aside, not ranked.

**The dashboard** is a sortable, filterable board (watchlist / beyond /
category / chain / minimum TVL) with a per-protocol detail view: the facts,
the valuation waterfall, and a 5–7 step farm plan where every step carries an
action, a cost and a time commitment, parameterised by the protocol's own
category, chains, TVL and age.

## Run it

```sh
node main.ts --input /input/snapshot.json   # writes board.json, data.js, dashboard/, screenshots/, dossier.json under /output
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9sb6h50s&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
