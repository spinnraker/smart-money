/*
 * Smart Money engine.
 *
 * Pure logic, no DOM. A budget is one month ('YYYY-MM') with three sections:
 * income, debt and expenses. Every line has a planned amount and an actual
 * amount (received for income, paid for debt, spent for expenses).
 *
 * Money is stored as whole cents so totals never drift.
 *
 * Debts also live outside the months, with an optional balance. What's left on
 * a debt is its balance minus every payment recorded against it in any month,
 * so the balance goes down as you pay and comes back if you undo a payment.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoneyEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTIONS = ['income', 'debt', 'expenses'];
  const MAX = 1e12; // cents: ten billion dollars is plenty

  // ---------- months ('YYYY-MM') ----------

  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function monthKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  function isMonth(k) {
    return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
  }

  function addMonths(key, n) {
    const [y, m] = key.split('-').map(Number);
    const i = y * 12 + (m - 1) + n;
    return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
  }

  function monthName(key) { return MONTHS[Number(key.slice(5)) - 1]; }
  function monthLabel(key) { return `${monthName(key)} ${key.slice(0, 4)}`; }

  function daysIn(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function ordinal(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  /** "Due Nov 1st". A due day of 31 lands on the last day of shorter months. */
  function dueLabel(key, day) {
    if (!day) return '';
    return `Due ${monthName(key).slice(0, 3)} ${ordinal(Math.min(day, daysIn(key)))}`;
  }

  // ---------- money ----------

  /** "$1,853.00", "1853", "1,853.5" → cents. Blank → 0. Unreadable → null. */
  function parseMoney(input) {
    const s = String(input == null ? '' : input).replace(/[$,\s]/g, '');
    if (s === '') return 0;
    if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
    const cents = Math.round(parseFloat(s) * 100);
    return Number.isFinite(cents) && cents <= MAX ? cents : null;
  }

  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(cents) {
    const s = fmt.format(Math.abs(cents) / 100);
    return cents < 0 ? `−${s}` : s;
  }

  /** For editing: 185300 → "1853.00", 0 → "". */
  function plain(cents) { return cents ? (cents / 100).toFixed(2) : ''; }

  // ---------- state ----------

  let seq = 0;
  function uid() {
    seq = (seq + 1) % 1e6;
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4) + seq.toString(36);
  }

  function freshState() { return { version: 1, months: {}, debts: [] }; }
  function emptyMonth() { return { income: [], debt: [], expenses: [] }; }

  function line(fields) {
    return {
      id: fields.id || uid(),
      name: String(fields.name || '').trim().slice(0, 60),
      planned: fields.planned || 0,
      actual: fields.actual || 0,
      due: fields.due || null,
      ...(fields.debtId ? { debtId: fields.debtId } : {}),
    };
  }

  function debtById(state, id) { return state.debts.find((d) => d.id === id) || null; }

  /** What a line is called. Debt lines take the debt's name, so a rename shows everywhere. */
  function lineName(state, l) {
    const d = l.debtId && debtById(state, l.debtId);
    return d ? d.name : l.name;
  }

  // ---------- debts ----------

  function debtPaid(state, id) {
    let sum = 0;
    for (const m of Object.values(state.months)) {
      for (const l of m.debt) if (l.debtId === id) sum += l.actual;
    }
    return sum;
  }

  /** Balance still owed, or null when you haven't entered a balance. */
  function debtLeft(state, debt) {
    return debt.balance == null ? null : debt.balance - debtPaid(state, debt.id);
  }

  function isPaidOff(state, debt) {
    const left = debtLeft(state, debt);
    return left != null && left <= 0;
  }

  /** Set what's still owed today; the starting balance is worked back from payments so far. */
  function setDebtLeft(state, id, leftCents) {
    const d = debtById(state, id);
    if (!d) return;
    d.balance = leftCents == null ? null : leftCents + debtPaid(state, id);
  }

  function addDebt(state, key, { name, planned = 0, actual = 0, due = null, left = null }) {
    const debt = { id: uid(), name: String(name || '').trim().slice(0, 60), balance: null };
    state.debts.push(debt);
    const l = line({ debtId: debt.id, planned, actual, due });
    month(state, key).debt.push(l);
    setDebtLeft(state, debt.id, left);
    return { debt, line: l };
  }

  /** Delete a debt and every line that pays it, in every month. */
  function deleteDebt(state, id) {
    state.debts = state.debts.filter((d) => d.id !== id);
    for (const m of Object.values(state.months)) m.debt = m.debt.filter((l) => l.debtId !== id);
  }

  // ---------- months ----------

  function month(state, key) {
    if (!state.months[key]) state.months[key] = emptyMonth();
    return state.months[key];
  }

  /** The most recent month before `key` that has a budget, or null. */
  function previousBudget(state, key) {
    const keys = Object.keys(state.months).filter((k) => k < key).sort();
    return keys.length ? keys[keys.length - 1] : null;
  }

  /**
   * Lines for a new month, copied from `from`: same names, planned amounts and
   * due days, nothing spent yet. Paid-off debts are left behind, and a debt's
   * payment is capped at what's still owed.
   */
  function copyLines(state, from) {
    const src = state.months[from] || emptyMonth();
    const out = emptyMonth();
    for (const s of SECTIONS) {
      for (const l of src[s]) {
        let planned = l.planned;
        if (l.debtId) {
          const d = debtById(state, l.debtId);
          if (!d) continue;
          const left = debtLeft(state, d);
          if (left != null) {
            if (left <= 0) continue;
            planned = Math.min(planned, left);
          }
        }
        out[s].push(line({ name: l.name, planned, due: l.due, debtId: l.debtId }));
      }
    }
    return out;
  }

  /** Start a month: copy the last budget before it, or begin empty. */
  function createMonth(state, key, copy = true) {
    const from = copy ? previousBudget(state, key) : null;
    state.months[key] = from ? copyLines(state, from) : emptyMonth();
    return state.months[key];
  }

  /**
   * Reset a month.
   *   'zero'  keep every line, planned amounts back to $0 (spending stays)
   *   'copy'  replace it with a copy of the last budget before it
   *   'clear' remove every line
   */
  function resetMonth(state, key, mode) {
    const m = month(state, key);
    if (mode === 'zero') {
      for (const s of SECTIONS) for (const l of m[s]) l.planned = 0;
    } else if (mode === 'copy') {
      const from = previousBudget(state, key);
      if (!from) return false;
      // Payments in this month mustn't count against the debts we're copying.
      state.months[key] = emptyMonth();
      state.months[key] = copyLines(state, from);
    } else if (mode === 'clear') {
      state.months[key] = emptyMonth();
    } else {
      return false;
    }
    return true;
  }

  function sum(lines, field) { return lines.reduce((a, l) => a + l[field], 0); }

  function totals(m) {
    const t = {};
    for (const s of SECTIONS) t[s] = { planned: sum(m[s], 'planned'), actual: sum(m[s], 'actual') };
    const outPlanned = t.debt.planned + t.expenses.planned;
    const outActual = t.debt.actual + t.expenses.actual;
    return {
      ...t,
      leftToBudget: t.income.planned - outPlanned,
      spent: outActual,
      received: t.income.actual,
      leftToSpend: outPlanned - outActual,
    };
  }

  // ---------- loading ----------

  function cents(v) {
    return Number.isInteger(v) && v >= 0 && v <= MAX ? v : null;
  }

  function cleanLine(raw, debtIds) {
    if (!raw || typeof raw !== 'object') return null;
    const planned = cents(raw.planned == null ? 0 : raw.planned);
    const actual = cents(raw.actual == null ? 0 : raw.actual);
    if (planned == null || actual == null) return null;
    if (raw.debtId != null && !debtIds.has(raw.debtId)) return null;
    const due = Number.isInteger(raw.due) && raw.due >= 1 && raw.due <= 31 ? raw.due : null;
    const l = line({ id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : undefined,
      name: typeof raw.name === 'string' ? raw.name : '', planned, actual, due, debtId: raw.debtId });
    if (!l.debtId && !l.name) return null;
    return l;
  }

  /** Check saved or imported data. Anything unreadable is dropped and counted. */
  function normalize(raw) {
    const state = freshState();
    if (!raw || typeof raw !== 'object') return { state, dropped: 1 };
    let dropped = 0;
    for (const d of Array.isArray(raw.debts) ? raw.debts : []) {
      const ok = d && typeof d.id === 'string' && d.id && typeof d.name === 'string' && d.name.trim()
        && (d.balance == null || (Number.isInteger(d.balance) && Math.abs(d.balance) <= MAX))
        && !state.debts.some((x) => x.id === d.id);
      if (ok) state.debts.push({ id: d.id.slice(0, 40), name: d.name.trim().slice(0, 60), balance: d.balance == null ? null : d.balance });
      else dropped++;
    }
    const debtIds = new Set(state.debts.map((d) => d.id));
    const months = raw.months && typeof raw.months === 'object' ? raw.months : {};
    for (const [key, m] of Object.entries(months)) {
      if (!isMonth(key) || !m || typeof m !== 'object') { dropped++; continue; }
      const clean = emptyMonth();
      for (const s of SECTIONS) {
        for (const l of Array.isArray(m[s]) ? m[s] : []) {
          const c = cleanLine(l, s === 'debt' ? debtIds : new Set());
          if (c && (s === 'debt') === !!c.debtId) clean[s].push(c); else dropped++;
        }
      }
      state.months[key] = clean;
    }
    return { state, dropped };
  }

  function isBackup(raw) {
    return !!(raw && typeof raw === 'object' && raw.months && typeof raw.months === 'object' && Array.isArray(raw.debts));
  }

  // ---------- export ----------

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(state) {
    const head = ['month', 'section', 'name', 'planned', 'actual', 'due_day'];
    const rows = [];
    for (const key of Object.keys(state.months).sort()) {
      const m = state.months[key];
      for (const s of SECTIONS) {
        for (const l of m[s]) {
          rows.push([key, s, lineName(state, l), (l.planned / 100).toFixed(2), (l.actual / 100).toFixed(2), l.due || '']
            .map(csvCell).join(','));
        }
      }
    }
    return [head.join(','), ...rows].join('\n') + '\n';
  }

  return {
    SECTIONS,
    monthKey, isMonth, addMonths, monthName, monthLabel, daysIn, ordinal, dueLabel,
    parseMoney, money, plain,
    uid, freshState, emptyMonth, line, lineName, debtById,
    debtPaid, debtLeft, isPaidOff, setDebtLeft, addDebt, deleteDebt,
    month, previousBudget, copyLines, createMonth, resetMonth, totals,
    normalize, isBackup, toCsv,
  };
});
