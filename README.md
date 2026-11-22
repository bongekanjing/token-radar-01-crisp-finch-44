# token-radar-01-crisp-finch-44

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bongekanjing/token-radar-01-crisp-finch-44/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bongekanjing/token-radar-01-crisp-finch-44/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of the protocol universe,
prices every protocol that records no token by what a launch could be worth,
ranks them, and gives each one the steps to farm it.

## What it does

The board carries 197 protocols, ranked by implied value. It covers all 40
protocols on the house watchlist and 157 more the watchlist leaves out, because
the floor is the set the house kept, never the whole radar.

Every number on the board is derived from the snapshot's own figures. The
snapshot holds 758 protocols, 144 of them with a token and a market cap. Those
144 are the only evidence in the file about what a protocol's TVL is worth, so
the model reads a median market-cap-to-TVL multiple off them, per category, and
applies it to the protocols that have no token yet:

    implied = round( tvl_usd
                   * benchmark_multiple(category)
                   * (1 + clamp(change_7d, -50, 100) / 100 * 0.35)
                   * (0.55 + min(age_days, 3650) / 3650 * 0.45) )

- **benchmark_multiple** is the market's own valuation of TVL in that category,
  shrunk toward the whole-market median by sample size, so a category with three
  members cannot outvote one with fifteen.
- **change_7d** is momentum: a protocol whose TVL is growing is being used
  harder, and a launch prices that in.
- **age_days** is time spent building with no token, which is the claim a farm
  is chasing.

Nothing names a protocol. The same function scores every row, so a different
snapshot moves every number.

## The dashboard

`dashboard/index.html`, `dashboard/app.css` and `dashboard/app.js` are a static
page with no framework and no network. It reads `data.js`, which `main.ts` writes
from the same board, so the page and the board cannot disagree.

- the board: sortable by every column, searchable, filterable by category, with
  views for all protocols, the watchlist only, and the ones already trading
- a detail view for each protocol: its inputs, the model recomputed in the page
  as a check that it matches the board, and its farm plan with costs and times
- the model notes: every term, where it comes from, and what it cannot know

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only. It writes `board.json`, `data.js`,
the dashboard, the screenshots and `dossier.json` into `out/`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
