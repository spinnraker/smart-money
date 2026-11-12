(function () {
  'use strict';

  const E = window.MoneyEngine;
  const STORE = 'money:v1';

  const SECTION = {
    income: { title: 'Income', one: 'income', actual: 'Received', add: 'Add income' },
    debt: { title: 'Debt', one: 'debt', actual: 'Paid', add: 'Add debt' },
    expenses: { title: 'Expenses', one: 'expense', actual: 'Spent', add: 'Add expense' },
  };
  const MODES = [['planned', 'Planned'], ['actual', 'Spent'], ['remaining', 'Remaining']];

  const app = document.getElementById('app');
  const sheetEl = document.getElementById('sheet');
  const toastEl = document.getElementById('toast');

  let state = load();
  let view = 'budget';
  let cur = thisMonth();
  let lastMonth = cur;
  let mode = 'planned';
  let sheet = null;
  let showPaidOff = false;
  let undo = null; // { key, month } after a reset, until the next change

  // ---------- storage ----------

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE);
      if (raw) {
        const { state: s, dropped } = E.normalize(JSON.parse(raw));
        if (dropped) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw);
        return s;
      }
    } catch (e) {
      try { if (raw) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw); } catch (e2) { /* storage unavailable */ }
    }
    return E.freshState();
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { toast('Couldn’t save on this phone'); }
  }

  /** Every change goes through here: save, drop any pending undo, redraw. */
  function commit() {
    undo = null;
    save();
    render();
  }

  // ---------- helpers ----------

  function thisMonth() { return E.monthKey(new Date()); }
  function today() {
    const d = new Date();
    return `${E.monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  const $ = E.money;
  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
  function findLine(key, section, id) {
    const m = state.months[key];
    return m ? m[section].find((l) => l.id === id) || null : null;
  }
  function pct(part, whole) { return whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : (part > 0 ? 100 : 0); }

  // ---------- toasts ----------

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // ---------- files ----------

  function shareFile(text, name, type, title) {
    // Downloads are unreliable in an iPhone home-screen app; the share sheet
    // lets you save to Files instead.
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && typeof File === 'function') {
      const file = new File([text], name, { type });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title }).catch((e) => {
          if (e && e.name !== 'AbortError') download(text, name, type);
        });
        return;
      }
    }
    download(text, name, type);
  }

  function download(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      file.text().then((text) => {
        const raw = JSON.parse(text);
        if (!E.isBackup(raw)) throw new Error('not a backup');
        const { state: next, dropped } = E.normalize(raw);
        const note = dropped ? ` ${plural(dropped, 'item')} in it can’t be read and will be skipped.` : '';
        if (!confirm(`Replace everything in Smart Money with this backup?${note}`)) return;
        state = next;
        view = 'budget';
        commit();
        toast('Backup restored');
      }).catch(() => toast('That file isn’t a Smart Money backup'));
    };
    input.click();
  }

  // ---------- budget view ----------

  function amountFor(l) {
    if (mode === 'planned') return l.planned;
    if (mode === 'actual') return l.actual;
    return l.planned - l.actual;
  }

  function lineRow(section, l) {
    const name = E.lineName(state, l);
    const subs = [];
    if (mode !== 'planned') subs.push(`of ${$(l.planned)}`);
    if (l.due) subs.push(E.dueLabel(cur, l.due));
    if (section === 'debt') {
      const d = E.debtById(state, l.debtId);
      const left = d ? E.debtLeft(state, d) : null;
      if (left != null) subs.push(left <= 0 ? 'Paid off' : `${$(left)} owed`);
    }
    const amt = amountFor(l);
    const over = mode === 'remaining' && amt < 0;
    const bar = mode === 'planned' || !l.actual ? ''
      : `<div class="mini${l.actual > l.planned ? ' over' : ''}"><i style="width:${pct(l.actual, l.planned)}%"></i></div>`;
    return `<button class="line" data-action="edit" data-section="${section}" data-id="${esc(l.id)}">
        <span class="line-head">
          <b>${esc(name)}</b>
          <span class="amt${over ? ' neg' : ''}">${$(amt)}</span>
        </span>
        ${subs.length ? `<span class="line-sub">${esc(subs.join(' · '))}</span>` : ''}
        ${bar}
      </button>`;
  }

  function sectionBlock(section, m) {
    const s = SECTION[section];
    const lines = m[section];
    const total = lines.reduce((a, l) => a + amountFor(l), 0);
    return `<section class="sec">
        <div class="sec-head"><h2 class="section-label">${s.title}</h2><span>${$(total)}</span></div>
        <div class="list">
          ${lines.map((l) => lineRow(section, l)).join('')}
          <button class="add-row" data-action="add" data-section="${section}"><i aria-hidden="true">+</i>${s.add}</button>
        </div>
      </section>`;
  }

  function summary(m) {
    const t = E.totals(m);
    let big, caption;
    if (mode === 'planned') {
      const lb = t.leftToBudget;
      big = $(Math.abs(lb));
      if (lb > 0) caption = 'left to budget';
      else if (lb < 0) caption = 'over budget';
      else caption = t.income.planned ? 'left to budget. Every dollar is planned.' : 'left to budget';
      return `<div class="summary${lb < 0 ? ' warn-num' : ''}"><b>${big}</b><span>${caption}</span>
        <small>${$(t.income.planned)} income · ${$(t.debt.planned + t.expenses.planned)} planned out</small></div>`;
    }
    if (mode === 'actual') {
      return `<div class="summary"><b>${$(t.spent)}</b><span>spent of ${$(t.debt.planned + t.expenses.planned)}</span>
        <small>${$(t.received)} of ${$(t.income.planned)} income received</small></div>`;
    }
    const left = t.leftToSpend;
    return `<div class="summary${left < 0 ? ' warn-num' : ''}"><b>${$(Math.abs(left))}</b><span>${left < 0 ? 'overspent' : 'left to spend'}</span>
      ${t.received ? `<small>${$(t.received - t.spent)} in hand (received − spent)</small>` : ''}</div>`;
  }

  function monthHead() {
    const label = E.monthLabel(cur);
    const isNow = cur === thisMonth();
    return `<div class="month-head">
        <div>
          <div class="date">${isNow ? 'This month' : `<button class="link-inline" data-action="this-month">Back to ${esc(E.monthName(thisMonth()))}</button>`}</div>
          <h1>${esc(label)}</h1>
        </div>
        <div class="month-nav">
          <button data-action="month" data-delta="-1" aria-label="Previous month">‹</button>
          <button data-action="month" data-delta="1" aria-label="Next month">›</button>
        </div>
      </div>`;
  }

  function budgetView() {
    const m = state.months[cur];
    if (!m) {
      const prev = E.previousBudget(state, cur);
      const name = E.monthName(cur);
      return `${monthHead()}
        <div class="empty">
          <h2>Let’s plan ${esc(name)}.</h2>
          ${prev
            ? `<p>Copy ${esc(E.monthLabel(prev))}: same lines and planned amounts, nothing spent yet.</p>
               <button class="btn block" data-action="create" data-copy="1">Copy ${esc(E.monthName(prev))}’s budget</button>
               <button class="link" data-action="create" data-copy="0">Start empty instead</button>`
            : `<p>Add your income, debts and expenses. Next month starts as a copy of this one.</p>
               <button class="btn block" data-action="create" data-copy="0">Start ${esc(name)}’s budget</button>`}
        </div>`;
    }
    const seg = `<div class="seg" role="group" aria-label="Show">${MODES.map(([id, label]) =>
      `<button data-action="mode" data-mode="${id}" aria-pressed="${mode === id}">${label}</button>`).join('')}</div>`;
    const undoBar = undo && undo.key === cur
      ? `<div class="undo"><span>Budget reset</span><button data-action="undo">Undo</button></div>` : '';
    return `${monthHead()}
      ${seg}
      ${undoBar}
      ${summary(m)}
      ${E.SECTIONS.map((s) => sectionBlock(s, m)).join('')}
      <div class="foot"><button class="link" data-action="reset">Reset budget</button></div>`;
  }

  // ---------- debts view ----------

  function debtRow(d) {
    const paid = E.debtPaid(state, d.id);
    const left = E.debtLeft(state, d);
    const sub = left == null ? `${$(paid)} paid · no balance set`
      : left <= 0 ? `${$(paid)} paid · paid off` : `${$(paid)} paid of ${$(paid + left)}`;
    return `<button class="line" data-action="debt" data-id="${esc(d.id)}">
        <span class="line-head"><b>${esc(d.name)}</b><span class="amt">${left == null ? '—' : $(Math.max(0, left))}</span></span>
        <span class="line-sub">${esc(sub)}</span>
        ${left == null ? '' : `<div class="mini"><i style="width:${pct(paid, paid + Math.max(0, left))}%"></i></div>`}
      </button>`;
  }

  function debtsView() {
    const active = state.debts.filter((d) => !E.isPaidOff(state, d));
    const done = state.debts.filter((d) => E.isPaidOff(state, d));
    const owed = active.reduce((a, d) => a + Math.max(0, E.debtLeft(state, d) || 0), 0);
    const paid = state.debts.reduce((a, d) => a + E.debtPaid(state, d.id), 0);
    if (!state.debts.length) {
      return `<div class="date">Debts</div><h1>Nothing owed</h1>
        <p class="lead">Add a debt from the Budget tab. Give it a balance and it counts down as you pay.</p>`;
    }
    return `<div class="date">Debts</div><h1>${$(owed)}</h1>
      <p class="lead">still owed${active.some((d) => d.balance == null) ? ' (on debts with a balance)' : ''} · ${$(paid)} paid so far</p>
      ${active.length ? `<div class="list" style="margin-top:24px">${active.map(debtRow).join('')}</div>` : '<p class="hint" style="margin-top:24px">Everything’s paid off.</p>'}
      ${done.length ? `<button class="link" data-action="paid-off">${showPaidOff ? 'Hide' : 'Show'} paid off (${done.length})</button>
        ${showPaidOff ? `<div class="list">${done.map(debtRow).join('')}</div>` : ''}` : ''}`;
  }

  // ---------- setup view ----------

  function setupView() {
    const months = Object.keys(state.months).length;
    return `<div class="date">Smart Money</div><h1>Setup</h1>
      <h2 class="section-label">Data</h2>
      <div class="list">
        <button class="row-btn" data-action="export"><b>Export backup</b><span>JSON</span></button>
        <button class="row-btn" data-action="import"><b>Restore backup</b><span>Replaces data</span></button>
        <button class="row-btn" data-action="csv"><b>Export for a spreadsheet</b><span>CSV</span></button>
      </div>
      <p class="hint" style="margin-top:20px">${plural(months, 'month')} budgeted. Everything stays on this phone. Nothing is sent anywhere, and there are no ads.</p>
      <h2 class="section-label">How it works</h2>
      <div class="rules">
        <p><b>Planned</b> <span>is the plan. Fill income first, then give it to debts and expenses until “left to budget” reaches $0.</span></p>
        <p><b>Spent</b> <span>is what actually happened. Tap a line to enter what you spent, paid or received.</span></p>
        <p><b>Remaining</b> <span>is planned minus spent, line by line.</span></p>
        <p><b>New month</b> <span>Go to it with ›, then copy last month’s budget or start empty.</span></p>
        <p><b>Debt balances</b> <span>go down by what you mark paid. Paid-off debts aren’t copied forward.</span></p>
      </div>`;
  }

  // ---------- main render ----------

  function top() {
    const tab = (id, label) =>
      `<button class="tab" data-action="view" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${label}</button>`;
    return `<header class="top"><nav class="tabs" aria-label="Sections">${tab('budget', 'Budget')}${tab('debts', 'Debts')}${tab('setup', 'Setup')}</nav></header>`;
  }

  function render() {
    app.innerHTML = top() + (view === 'budget' ? budgetView() : view === 'debts' ? debtsView() : setupView());
  }

  // ---------- sheets ----------

  let opener = null;

  function openSheet(s, focusSel) {
    if (!sheet) opener = document.activeElement;
    sheet = s;
    document.body.style.overflow = 'hidden';
    app.inert = true;
    renderSheet();
    sheetEl.scrollTop = 0;
    const el = sheetEl.querySelector(focusSel || '#sheet-title');
    if (el) el.focus({ preventScroll: true });
  }

  function closeSheet() {
    sheet = null;
    renderSheet();
    app.inert = false;
    document.body.style.overflow = '';
    render();
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  function renderSheet() {
    if (!sheet) {
      sheetEl.hidden = true;
      sheetEl.innerHTML = '';
      return;
    }
    sheetEl.hidden = false;
    const html = { line: lineSheet, debt: debtSheet, reset: resetSheet }[sheet.type]();
    sheetEl.innerHTML = `<div class="sheet-inner">${html}</div>`;
  }

  function moneyField(f, label, value, hint) {
    return `<label class="field"><span>${label}</span>
        <input type="text" inputmode="decimal" autocomplete="off" data-f="${f}" value="${esc(E.plain(value))}" data-initial="${esc(E.plain(value))}" placeholder="0.00">
        ${hint ? `<p class="hint">${hint}</p>` : ''}
      </label>`;
  }

  function lineSheet() {
    const { section, id } = sheet;
    const s = SECTION[section];
    const l = id ? findLine(cur, section, id) : null;
    const debt = l && l.debtId ? E.debtById(state, l.debtId) : null;
    const name = l ? E.lineName(state, l) : '';
    const left = debt ? E.debtLeft(state, debt) : null;
    const verb = s.actual.toLowerCase();
    return `<div class="sheet-top"><button data-action="close">Cancel</button><button class="done" data-action="save-line">Save</button></div>
      <h1 id="sheet-title" tabindex="-1">${l ? esc(name) : `New ${s.one}`}</h1>
      <p class="lead">${esc(E.monthLabel(cur))}</p>
      <label class="field"><span>Name</span>
        <input type="text" data-f="name" maxlength="60" autocomplete="off" value="${esc(name)}" placeholder="${section === 'income' ? 'Paycheck' : section === 'debt' ? 'Car loan' : 'Groceries'}">
      </label>
      ${moneyField('planned', section === 'income' ? 'Planned (expected)' : 'Planned', l ? l.planned : 0)}
      ${moneyField('actual', `${s.actual} so far`, l ? l.actual : 0)}
      <div class="add-amt">
        <input type="text" inputmode="decimal" autocomplete="off" data-f="add" placeholder="Add to ${esc(verb)}" aria-label="Amount to add to ${esc(verb)}">
        <button class="btn ghost small" data-action="add-amt">Add</button>
      </div>
      <label class="field"><span>Due day</span>
        <input type="text" inputmode="numeric" autocomplete="off" data-f="due" maxlength="2" value="${l && l.due ? l.due : ''}" placeholder="None (1–31)">
      </label>
      ${section === 'debt' ? moneyField('left', 'Balance owed', left == null ? 0 : Math.max(0, left),
        'Optional. What’s still owed, after what you’ve marked paid. Goes down as you pay; when it hits $0 the debt is paid off.') : ''}
      ${l ? `<div class="detail-actions"><button class="link danger" data-action="delete-line">${section === 'debt' ? 'Remove from this month' : 'Delete'}</button></div>` : ''}`;
  }

  function debtSheet() {
    const d = E.debtById(state, sheet.id);
    if (!d) return '';
    const paid = E.debtPaid(state, d.id);
    const left = E.debtLeft(state, d);
    const inMonth = state.months[cur] && state.months[cur].debt.some((l) => l.debtId === d.id);
    return `<div class="sheet-top"><button data-action="close">Cancel</button><button class="done" data-action="save-debt">Save</button></div>
      <h1 id="sheet-title" tabindex="-1">${esc(d.name)}</h1>
      <div class="stats three">
        <div class="stat"><b>${$(paid)}</b><small>paid</small></div>
        <div class="stat"><b>${left == null ? '—' : $(Math.max(0, left))}</b><small>owed</small></div>
        <div class="stat"><b>${left == null ? '—' : `${Math.round(pct(paid, paid + Math.max(0, left)))}%`}</b><small>done</small></div>
      </div>
      <label class="field"><span>Name</span>
        <input type="text" data-f="name" maxlength="60" autocomplete="off" value="${esc(d.name)}">
      </label>
      ${moneyField('left', 'Balance owed', left == null ? 0 : Math.max(0, left), 'Leave blank if you don’t want to track it.')}
      <div class="detail-actions">
        ${!inMonth && state.months[cur] && !E.isPaidOff(state, d) ? `<button class="link" data-action="debt-to-month">Add to ${esc(E.monthName(cur))}</button>` : ''}
        <button class="link danger" data-action="delete-debt">Delete debt</button>
      </div>`;
  }

  function resetSheet() {
    const prev = E.previousBudget(state, cur);
    const name = E.monthName(cur);
    const opt = (m, title, desc, disabled) =>
      `<button class="option" data-action="do-reset" data-mode="${m}" ${disabled ? 'disabled' : ''}><b>${title}</b><span>${desc}</span></button>`;
    return `<div class="sheet-top"><button data-action="close">Cancel</button><span></span></div>
      <h1 id="sheet-title" tabindex="-1">Reset ${esc(name)}?</h1>
      <p class="lead">You can undo this right after.</p>
      <div class="options">
        ${opt('zero', 'Set planned amounts to $0', 'Keeps every line and what you’ve already spent.')}
        ${opt('copy', prev ? `Copy ${esc(E.monthName(prev))}’s budget` : 'Copy last month’s budget',
          prev ? `Replaces ${esc(name)} with ${esc(E.monthLabel(prev))}’s lines and planned amounts. Spending here is cleared.` : 'There’s no earlier budget to copy.', !prev)}
        ${opt('clear', 'Start from scratch', `Removes every line in ${esc(name)}, including what you’ve spent.`)}
      </div>`;
  }

  function val(f) {
    const el = sheetEl.querySelector(`[data-f="${f}"]`);
    return el ? el.value : '';
  }

  function badField(f, msg) {
    toast(msg);
    const el = sheetEl.querySelector(`[data-f="${f}"]`);
    if (el) { el.focus(); el.select(); }
  }

  /** Read and check the money fields. Returns null (after pointing at the problem) if any is unreadable. */
  function readMoney(fields) {
    const out = {};
    for (const f of fields) {
      const v = E.parseMoney(val(f));
      if (v == null) { badField(f, 'That amount doesn’t look right'); return null; }
      out[f] = v;
    }
    return out;
  }

  function readDue() {
    const raw = val('due').trim();
    if (!raw) return { due: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 31) { badField('due', 'Due day is 1 to 31'); return null; }
    return { due: n };
  }

  function saveLine() {
    const { section, id } = sheet;
    const name = val('name').trim();
    if (!name) { badField('name', 'Give it a name'); return; }
    const amounts = readMoney(section === 'debt' ? ['planned', 'actual', 'left'] : ['planned', 'actual']);
    if (!amounts) return;
    const due = readDue();
    if (!due) return;

    if (!id) {
      if (section === 'debt') {
        const left = val('left').trim() === '' ? null : amounts.left;
        E.addDebt(state, cur, { name, planned: amounts.planned, actual: amounts.actual, due: due.due, left });
      } else {
        E.month(state, cur)[section].push(E.line({ name, planned: amounts.planned, actual: amounts.actual, due: due.due }));
      }
    } else {
      const l = findLine(cur, section, id);
      if (!l) { closeSheet(); return; }
      l.planned = amounts.planned;
      l.actual = amounts.actual;
      l.due = due.due;
      const debt = l.debtId ? E.debtById(state, l.debtId) : null;
      if (debt) {
        debt.name = name.slice(0, 60);
        applyBalance(debt.id, amounts.left);
      } else {
        l.name = name.slice(0, 60);
      }
    }
    closeSheet();
    commit();
  }

  /**
   * The balance only changes if you edited the number you were shown.
   * Left alone, it simply goes down by whatever you just marked paid.
   */
  function applyBalance(debtId, typed) {
    const el = sheetEl.querySelector('[data-f="left"]');
    if (!el || el.value.trim() === el.dataset.initial) return;
    E.setDebtLeft(state, debtId, el.value.trim() === '' ? null : typed);
  }

  function saveDebt() {
    const d = E.debtById(state, sheet.id);
    if (!d) { closeSheet(); return; }
    const name = val('name').trim();
    if (!name) { badField('name', 'Give it a name'); return; }
    const amounts = readMoney(['left']);
    if (!amounts) return;
    d.name = name.slice(0, 60);
    applyBalance(d.id, amounts.left);
    closeSheet();
    commit();
  }

  // ---------- events ----------

  function handle(el) {
    switch (el.dataset.action) {
      case 'view':
        view = el.dataset.view;
        render();
        window.scrollTo(0, 0);
        break;
      case 'month':
        cur = E.addMonths(cur, Number(el.dataset.delta));
        render();
        break;
      case 'this-month':
        cur = thisMonth();
        render();
        break;
      case 'mode':
        mode = el.dataset.mode;
        render();
        break;
      case 'create': {
        const copy = el.dataset.copy === '1';
        E.createMonth(state, cur, copy);
        mode = 'planned';
        commit();
        toast(copy ? 'Copied. Adjust anything that changed.' : `${E.monthName(cur)} started`);
        break;
      }
      case 'add':
        openSheet({ type: 'line', section: el.dataset.section, id: null }, '[data-f="name"]');
        break;
      case 'edit':
        openSheet({ type: 'line', section: el.dataset.section, id: el.dataset.id },
          mode === 'planned' ? '#sheet-title' : '[data-f="add"]');
        break;
      case 'add-amt': {
        const add = E.parseMoney(val('add'));
        if (add == null) { badField('add', 'That amount doesn’t look right'); break; }
        if (!add) { badField('add', 'Type an amount to add'); break; }
        const total = (E.parseMoney(val('actual')) || 0) + add;
        sheetEl.querySelector('[data-f="actual"]').value = E.plain(total);
        sheetEl.querySelector('[data-f="add"]').value = '';
        toast(`Added ${$(add)}. Save to keep it.`);
        break;
      }
      case 'save-line': saveLine(); break;
      case 'delete-line': {
        const { section, id } = sheet;
        const l = findLine(cur, section, id);
        if (!l) { closeSheet(); break; }
        const name = E.lineName(state, l);
        const msg = section === 'debt'
          ? `Remove ${name} from ${E.monthName(cur)}? Any payment marked here comes off its balance record. The debt stays in Debts.`
          : `Delete ${name} from ${E.monthName(cur)}?`;
        if (!confirm(msg)) break;
        const m = state.months[cur];
        m[section] = m[section].filter((x) => x.id !== id);
        closeSheet();
        commit();
        break;
      }
      case 'debt':
        openSheet({ type: 'debt', id: el.dataset.id });
        break;
      case 'save-debt': saveDebt(); break;
      case 'debt-to-month': {
        const d = E.debtById(state, sheet.id);
        if (d && state.months[cur]) state.months[cur].debt.push(E.line({ debtId: d.id }));
        closeSheet();
        commit();
        toast(`Added to ${E.monthName(cur)}. Set the payment in Budget.`);
        break;
      }
      case 'delete-debt': {
        const d = E.debtById(state, sheet.id);
        if (!d || !confirm(`Delete ${d.name} everywhere? It’s removed from every month, with its payments.`)) break;
        E.deleteDebt(state, d.id);
        closeSheet();
        commit();
        break;
      }
      case 'paid-off':
        showPaidOff = !showPaidOff;
        render();
        break;
      case 'reset':
        openSheet({ type: 'reset' });
        break;
      case 'do-reset': {
        const snap = JSON.parse(JSON.stringify(state.months[cur]));
        if (!E.resetMonth(state, cur, el.dataset.mode)) break;
        closeSheet();
        save();
        undo = { key: cur, month: snap };
        mode = 'planned';
        render();
        window.scrollTo(0, 0);
        break;
      }
      case 'undo':
        if (undo) {
          state.months[undo.key] = undo.month;
          commit();
          toast('Reset undone');
        }
        break;
      case 'close':
        closeSheet();
        break;
      case 'export':
        shareFile(JSON.stringify(state, null, 2), `smart-money-backup-${today()}.json`, 'application/json', 'Smart Money backup');
        break;
      case 'import':
        importData();
        break;
      case 'csv':
        if (!Object.keys(state.months).length) { toast('No budgets yet'); break; }
        shareFile(E.toCsv(state), `smart-money-${today()}.csv`, 'text/csv', 'Smart Money');
        break;
    }
  }

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el) handle(el);
  });
  sheetEl.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el && !el.disabled) handle(el);
  });

  sheetEl.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
    ev.preventDefault();
    if (ev.target.dataset.f === 'add') handle({ dataset: { action: 'add-amt' } });
    else if (sheet && sheet.type === 'line') saveLine();
    else if (sheet && sheet.type === 'debt') saveDebt();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && sheet) closeSheet();
  });

  // A new month began while the app sat open: follow it if you were on the old one.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); return; }
    const now = thisMonth();
    if (now !== lastMonth) {
      if (cur === lastMonth) cur = now;
      lastMonth = now;
      if (!sheet) render();
    }
  });
  window.addEventListener('pagehide', save);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
