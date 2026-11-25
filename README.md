# Token Launch Radar

A token launch radar for the make.fun `token-radar-01` bounty: it reads a sealed DefiLlama
snapshot of the protocol universe (758 protocols at or above $5M TVL, frozen 2026-11-14) and
ranks every protocol that records no token yet by the value its launch would carry if its record
held — each with a concrete, costed farm plan.

## The model

Implied value is priced the way the market prices the protocol's own sector:

```
implied = TVL × sector_multiple × momentum × seasoning × breadth
```

- **sector_multiple** — the median market-cap/TVL of the sector's *live* protocols in the same
  snapshot, winsorised to [0.01, 3] and shrunk toward the market-wide median by peer count, so a
  sector with one wild peer cannot price a board row alone.
- **momentum** — `1 + clamp(change_7d, −60, +120)/100 × 0.5`.
- **seasoning** — `0.7 + 0.3 × min(age_days, 1460)/1460`: how long it has run with no token.
- **breadth** — `1 + 0.015 × min(chains − 1, 10)`.

Every factor of every row is printed in the dashboard's detail view, so any number on the board
can be rebuilt by hand. No protocol name is special-cased anywhere: the same function scores
every row, and a protocol the snapshot adds tomorrow is scored the day it appears.

Eligibility mirrors the snapshot's own watchlist rule at every size: pre-token, not an exchange
reserve page, not a versioned pool, not a wrapped/staked product of a token that trades — plus
one screen of the same kind: a bridge record named by a bare ticker is the traded asset itself.
The watchlist (40 protocols) is the board's floor; the board ranks 260.

## Run it

```
node main.ts --input <snapshot.json>          # writes /output (or $MAKEFUN_OUTPUT_DIR)
```

Node 22, standard library only. Outputs: `board.json` (the ranked board), `data.js` (the
dashboard's data), `dashboard/` (a static page: sortable, filterable, with a per-protocol
detail view and farm plan), `screenshots/`, and `dossier.json` built with the vendored
make.fun library.

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the peer-multiple model and the farm-plan generator.
- `dashboard/` — the page (index.html, app.css, app.js), no network, no framework.
- `vendor/makefun-board.ts` — the make.fun dossier library, copied from the kit unchanged.
