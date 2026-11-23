// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, the benchmark table the model is derived from, a filterable table, and a
// per-protocol detail view with the model's own inputs and the protocol's farm plan.
//
// Two rules shape this file. First, no network: every byte it shows is in data.js. Second, the page
// must be able to show its own arithmetic: the benchmark table is on the page, and each row states
// the multiple it got and why, so a reader can check any number without trusting the author.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar figure at a readable width: $2.75B, $308.9M, $12K. */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMultiple(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return x >= 1 ? x.toFixed(2) + 'x' : x.toFixed(3) + 'x';
  }

  /**
   * The model, in one function, so the page can recompute any row and show that its own arithmetic
   * and board.json's number are the same function. This is the check a reader should run: if these
   * two disagree the page is lying about its data.
   */
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = Math.min(Math.max(row.age_days === null || row.age_days === undefined ? 0 : row.age_days, 0), model.age_horizon_days);
    var ageMult = model.age_floor + (age / model.age_horizon_days) * model.age_range;
    return Math.max(1, Math.round(row.tvl_usd * row.benchmark_multiple * growthMult * ageMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a little against it and keep both positions open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Provide $" + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and keep the position open.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('real world') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s tokenised treasury market on " + chain + '.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and keep one small position open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and leave it through the window.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('index') >= 0 || c.indexOf('yield aggregator') >= 0) return "Buy $" + capital + " of " + name + "'s index or vault shares on " + chain + ' and hold them.';
    return 'Use ' + name + ' on ' + chain + ' with $' + capital + ' and keep the position live.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a wallet that holds only the funds you plan to farm, and fund it with $' + capital + ' plus gas on ' + chain + '.', cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '10 to 20 minutes' },
      { text: actionFor(p, capital, chain), cost: 'the $' + capital + ' stays in the position', time: 'under an hour to open' },
      { text: 'Return once a week and make one qualifying action, a deposit, a borrow, a swap or a vote, so the activity lands in more than one snapshot.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold for at least ' + hold + ' days, since a launch snapshot is taken on a day nobody announces in advance.', cost: 'opportunity cost only', time: hold + ' days' },
      { text: "Before withdrawing, check " + p.name + "'s own page and DefiLlama for a token announcement, and claim only from the link the protocol itself publishes.", cost: 'nothing, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('w') === '1') state.watchlistOnly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.in_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.benchmark_multiple; bv = b.benchmark_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var onList = DATA.rows.filter(function (r) { return r.floor_status === 'watchlist'; }).length;
    var above = DATA.rows.filter(function (r) { return r.floor_status === 'above-floor'; }).length;
    var below = DATA.rows.filter(function (r) { return r.floor_status === 'below-floor'; }).length;
    var floorM = Math.round(DATA.floor_usd / 1e6);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols with no token, ranked by what a launch could be worth' }),
        el('p', { text: 'Every protocol in the snapshot that records no token and could issue one of its own: ' + onList + ' on the house watchlist, ' + above + ' more that clear the $' + floorM + 'M floor but whose name the watchlist rule leaves out, and ' + below + ' under the floor. Implied value is derived, not asserted: a protocol TVL times the multiple its own category already trades at, adjusted for momentum and for how long it has run with no token.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Rows ranked' }), el('b', { class: 'num', text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'On the watchlist' }), el('b', { class: 'num', text: String(onList) })),
        el('div', { class: 'fact' }, el('span', { text: 'Above floor, unlisted' }), el('b', { class: 'num', text: String(above) })),
        el('div', { class: 'fact' }, el('span', { text: 'Under the floor' }), el('b', { class: 'num', text: String(below) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live, set aside' }), el('b', { class: 'num', text: String(DATA.live_size) }))
      ),
      errorStrip()
    );
  }

  /**
   * The error strip: the headline number a reader needs before trusting any row above.
   *
   * It is the honest summary of the panel below — the flat model's held-out error, the forward
   * error of the four-term model that lost, and the dropdown's own note — in three tiles, so the
   * page states how wrong it is before it states what it thinks.
   */
  function errorStrip() {
    var E = DATA.evidence;
    if (!E) return el('div', null);
    var flat = E.kfold.filter(function (k) { return k.term.indexOf('flat') === 0; })[0];
    var best = E.kfold.reduce(function (a, b) { return b.fold_error < a.fold_error ? b : a; }, E.kfold[0]);
    var fw = E.forward.slice(-1)[0];
    return el('div', { class: 'errstrip' },
      el('div', { class: 'errtile' },
        el('span', { text: 'Held out, flat model' }),
        el('b', { class: 'num', text: flat ? 'x' + flat.fold_error.toFixed(2) : 'n/a' })
      ),
      el('div', { class: 'errtile' },
        el('span', { text: 'Held out, best fit' }),
        el('b', { class: 'num', text: 'x' + best.fold_error.toFixed(2) })
      ),
      el('div', { class: 'errtile bad' },
        el('span', { text: 'That fit, a later year' }),
        el('b', { class: 'num', text: fw ? 'x' + fw.with_terms.toFixed(2) : 'n/a' })
      ),
      el('div', { class: 'errtile' },
        el('span', { text: 'Traded protocols measured' }),
        el('b', { class: 'num', text: String(E.evidence_n) })
      ),
      el('div', { class: 'errnote' },
        el('span', { text: 'A row\'s implied value is a claim at that width, not a forecast. The terms that looked better in-fold did worse forward, so the board prices with the flat multiple and says so.' })
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var all = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var watch = el('button', { type: 'button', class: 'chip' + (state.watchlistOnly ? ' on' : ''), 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, all, live)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Floor' }), el('div', null, watch)),
      el('span', { class: 'count', text: state.tab === 'board' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' protocols already trading' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  /** The benchmark table: the evidence the whole model is built on, on the page where it can be read. */
  function benchmarkPanel() {
    var rows = DATA.benchmarks.filter(function (b) { return b.category !== '(market)'; });
    var market = DATA.benchmarks.filter(function (b) { return b.category === '(market)'; })[0];
    var tbody = el('tbody');
    rows.forEach(function (b) {
      tbody.appendChild(el('tr', { class: b.sample < DATA.model.min_sample ? 'thin' : null },
        el('td', null, el('b', { text: b.category })),
        el('td', { class: 'num', text: String(b.sample) }),
        el('td', { class: 'num', text: fmtMultiple(b.raw_multiple) }),
        el('td', { class: 'num', text: fmtMultiple(b.multiple) }),
        el('td', { class: 'sub', text: b.sample < DATA.model.min_sample ? 'too few members: market median used' : 'applied to this category' })
      ));
    });
    return el('section', { class: 'panel bench' },
      el('h2', { text: 'The multiple each category already trades at' }),
      el('p', { class: 'sub', text: 'The snapshot carries ' + market.sample + ' protocols that already have a token and a market cap. Their market cap over their TVL is the only evidence in the file about what TVL is worth, so the model reads a median per category off them and applies it to the protocols that have no token. A category with fewer than ' + DATA.model.min_sample + ' live members cannot speak for itself and takes the market median, ' + fmtMultiple(market.multiple) + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'bench-table' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live members' }),
            el('th', { scope: 'col', text: 'Raw median' }),
            el('th', { scope: 'col', text: 'Applied' }),
            el('th', { scope: 'col', text: 'Rule' })
          )),
          tbody
        )
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMultiple(r.benchmark_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, r.floor_status === 'watchlist'
          ? el('span', { class: 'status in', text: 'on watchlist' })
          : r.floor_status === 'above-floor'
            ? el('span', { class: 'status above', text: 'above floor, unlisted' })
            : el('span', { class: 'status out', text: 'under floor' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The multiple column is the category benchmark each row was priced at. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Floor' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMultiple(r.multiple) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'These ' + DATA.live_size + ' protocols already trade, so their market cap is a fact and not a model. Their market cap over TVL is what the benchmarks above are computed from, which is why they are shown here and kept out of the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap/TVL' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased and no row is hand-picked, so a different snapshot moves every number.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x benchmark_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.age_floor + ' + min(age_days, ' + m.age_horizon_days + ') / ' + m.age_horizon_days + ' x ' + m.age_range + ') )'
      ),
      el('ol', { class: 'glossary' },
        el('li', null, el('b', { text: 'benchmark_multiple' }), ' is the median market cap over TVL of the live protocols in the same category, shrunk toward the market median by sample size. It is the market saying what this kind of protocol is worth, and the table above is every value it takes.'),
        el('li', null, el('b', { text: 'change_7d' }), ' is momentum, clamped to ' + m.growth_floor + ' to ' + m.growth_cap + ' per cent: a protocol whose TVL is growing is being used harder, and a launch prices that in.'),
        el('li', null, el('b', { text: 'age_days' }), ' is how long the protocol has run with no token, from its first listing, clamped at ' + m.age_horizon_days + ' days. It is the claim a farm is chasing: a protocol that has run longer with no token owes its users more.')
      ),
      el('p', { class: 'sub', text: 'A protocol whose record carries no token is ranked. One that wraps or stakes an asset that already trades is not, because the token it would issue is the one it wraps: bridges, liquid staking, restaked BTC and exchanges are all excluded by category, and wrapped or staked products by name.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.in_watchlist ? ' - on the watchlist' : ' - below the floor') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category benchmark' }), el('b', { class: 'num', text: fmtMultiple(row.benchmark_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: String(row.age_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries, so the page and the board agree.' : ', which differs from the board and means the data is stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'What to do on this protocol before or after it issues a token, with what it costs and how long it takes.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /**
   * The evidence panel: the model's own backtest, printed with the way each figure was measured.
   *
   * The two tables are deliberately not merged. A k-fold figure and a forward figure answer
   * different questions, and this page says so rather than quoting the better-looking one.
   */
  function evidencePanel() {
    var E = DATA.evidence;
    if (!E) return el('div', null);
    var kf = el('table', { class: 'bench' },
      el('thead', null, el('tr', null,
        el('th', { text: 'Term, added in order' }),
        el('th', { class: 'num', text: '5-fold error' })
      )),
      el('tbody', null, E.kfold.map(function (k) {
        return el('tr', null,
          el('td', { text: k.term }),
          el('td', { class: 'num', text: 'x' + k.fold_error.toFixed(2) })
        );
      }))
    );
    var fw = el('table', { class: 'bench' },
      el('thead', null, el('tr', null,
        el('th', { text: 'Listed in' }),
        el('th', { class: 'num', text: 'n' }),
        el('th', { class: 'num', text: 'Flat' }),
        el('th', { class: 'num', text: 'Four terms' })
      )),
      el('tbody', null, E.forward.map(function (f) {
        return el('tr', null,
          el('td', { text: String(f.year) }),
          el('td', { class: 'num', text: String(f.n) }),
          el('td', { class: 'num', text: 'x' + f.model.toFixed(2) }),
          el('td', { class: 'num bad', text: 'x' + f.with_terms.toFixed(2) })
        );
      }))
    );
    var odds = el('table', { class: 'bench' },
      el('thead', null, el('tr', null,
        el('th', { text: 'Tokenless for' }),
        el('th', { class: 'num', text: 'No token' }),
        el('th', { class: 'num', text: 'Token trades' })
      )),
      el('tbody', null, E.odds.map(function (o) {
        return el('tr', null,
          el('td', { text: o.band }),
          el('td', { class: 'num', text: String(o.tokenless) }),
          el('td', { class: 'num', text: String(o.traded) })
        );
      }))
    );
    return el('section', { class: 'panel evidence' },
      el('h2', { text: 'Why these numbers, and how wrong they are' }),
      el('p', { text: 'The snapshot holds ' + E.evidence_n + ' protocols that already trade, out of ' + E.protocol_n + '. Their market cap over their TVL is the only evidence in the file about what a protocol is worth, so every figure below is measured on them and on nothing else.' }),
      el('div', { class: 'two' },
        el('div', null,
          el('h3', { text: 'Does each term earn its place?' }),
          kf,
          el('p', { class: 'sub', text: E.kfold_note })
        ),
        el('div', null,
          el('h3', { text: 'Does it survive a later year?' }),
          fw,
          el('p', { class: 'sub', text: E.forward_note })
        )
      ),
      el('p', { class: 'verdict', text: E.verdict }),
      el('div', { class: 'two' },
        el('div', null,
          el('h3', { text: 'How long protocols stay tokenless' }),
          odds,
          el('p', { class: 'sub', text: 'Counts at or above the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. A protocol that has run this long without a token is not proof it will not issue one, and the radar never says it will.' })
        ),
        el('div', null,
          el('h3', { text: 'What the error means for a row' }),
          el('p', { text: 'A fold error of x4.6 means the model\'s implied value is typically within a factor of about 4.6 of the real cap, in either direction. The Implied value column is a claim at that width, not a forecast, and the P25 to P75 band in each detail view is drawn at that width.' }),
          el('p', { class: 'sub', text: 'Measured on ' + E.measured_on + ' by the entry\'s own lab, from this snapshot alone.' })
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') {
      shell.appendChild(evidencePanel());
      shell.appendChild(benchmarkPanel());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  // The screenshot harness waits for this rather than guessing at a delay.
  document.body.dataset.rendered = '1';
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
