const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const NOV = '2026-11';
const DEC = '2026-12';
const JAN = '2027-01';

function sample() {
  const st = E.freshState();
  const m = E.month(st, NOV);
  m.income.push(E.line({ name: 'Paycheck', planned: 400000 }));
  m.expenses.push(E.line({ name: 'Rent', planned: 150000, due: 1 }));
  m.expenses.push(E.line({ name: 'Food', planned: 60000, actual: 12345 }));
  const { debt } = E.addDebt(st, NOV, { name: 'Car', planned: 30000, due: 6, left: 50000 });
  return { st, debt };
}

test('months step across years', () => {
  assert.equal(E.addMonths('2026-12', 1), '2027-01');
  assert.equal(E.addMonths('2027-01', -1), '2026-12');
  assert.equal(E.addMonths('2026-11', -23), '2024-12');
  assert.equal(E.monthLabel('2027-01'), 'January 2027');
  assert.equal(E.monthKey(new Date(2026, 10, 12)), '2026-11');
});

test('due labels use ordinals and clamp to short months', () => {
  assert.equal(E.dueLabel(NOV, 1), 'Due Nov 1st');
  assert.equal(E.dueLabel(NOV, 22), 'Due Nov 22nd');
  assert.equal(E.dueLabel(NOV, 13), 'Due Nov 13th');
  assert.equal(E.dueLabel('2027-02', 31), 'Due Feb 28th');
  assert.equal(E.dueLabel(NOV, null), '');
});

test('money parses what people type and never drifts', () => {
  assert.equal(E.parseMoney('$1,853.00'), 185300);
  assert.equal(E.parseMoney('1853'), 185300);
  assert.equal(E.parseMoney('0.1'), 10);
  assert.equal(E.parseMoney(' 19.99 '), 1999);
  assert.equal(E.parseMoney(''), 0);
  assert.equal(E.parseMoney('abc'), null);
  assert.equal(E.parseMoney('-5'), null);
  assert.equal(E.parseMoney('.'), null);
  assert.equal(E.money(185300), '$1,853.00');
  assert.equal(E.money(-500), '−$5.00');
  assert.equal(E.plain(185300), '1853.00');
  assert.equal(E.plain(0), '');
  // 0.1 + 0.2 style error can't happen with cents
  assert.equal(E.parseMoney('0.10') + E.parseMoney('0.20'), 30);
});

test('totals: left to budget, spent, left to spend', () => {
  const { st } = sample();
  const t = E.totals(st.months[NOV]);
  assert.equal(t.income.planned, 400000);
  assert.equal(t.leftToBudget, 400000 - 150000 - 60000 - 30000);
  assert.equal(t.spent, 12345);
  assert.equal(t.leftToSpend, 150000 + 60000 + 30000 - 12345);
});

test('debt balance goes down with payments across months', () => {
  const { st, debt } = sample();
  assert.equal(E.debtLeft(st, debt), 50000);
  st.months[NOV].debt[0].actual = 30000;
  assert.equal(E.debtLeft(st, debt), 20000);
  E.createMonth(st, DEC);
  st.months[DEC].debt[0].actual = 20000;
  assert.equal(E.debtLeft(st, debt), 0);
  assert.equal(E.isPaidOff(st, debt), true);
});

test('setting what is left works back from payments already made', () => {
  const { st, debt } = sample();
  st.months[NOV].debt[0].actual = 10000;
  E.setDebtLeft(st, debt.id, 90000);
  assert.equal(E.debtLeft(st, debt), 90000);
  assert.equal(debt.balance, 100000);
  E.setDebtLeft(st, debt.id, null);
  assert.equal(E.debtLeft(st, debt), null);
  assert.equal(E.isPaidOff(st, debt), false);
});

test('a debt with no balance is never paid off', () => {
  const st = E.freshState();
  const { debt } = E.addDebt(st, NOV, { name: 'Chimney', planned: 30000 });
  st.months[NOV].debt[0].actual = 30000;
  assert.equal(E.debtLeft(st, debt), null);
  assert.equal(E.isPaidOff(st, debt), false);
});

test('copying a month keeps the plan and drops what was spent', () => {
  const { st } = sample();
  E.createMonth(st, DEC);
  const d = st.months[DEC];
  assert.deepEqual(d.expenses.map((l) => [l.name, l.planned, l.actual, l.due]),
    [['Rent', 150000, 0, 1], ['Food', 60000, 0, null]]);
  assert.equal(d.income[0].planned, 400000);
  assert.notEqual(d.expenses[0].id, st.months[NOV].expenses[0].id);
});

test('copy skips months with no budget, like the app going Nov → Jan', () => {
  const { st } = sample();
  assert.equal(E.previousBudget(st, JAN), NOV);
  E.createMonth(st, JAN);
  assert.equal(st.months[JAN].income[0].name, 'Paycheck');
  assert.equal(E.previousBudget(st, '2026-10'), null);
});

test('paid-off debts are not copied, and payments are capped at what is owed', () => {
  const { st, debt } = sample();
  st.months[NOV].debt[0].actual = 30000; // 200.00 left, plan was 300.00
  E.createMonth(st, DEC);
  assert.equal(st.months[DEC].debt.length, 1);
  assert.equal(st.months[DEC].debt[0].planned, 20000);
  st.months[DEC].debt[0].actual = 20000;
  E.createMonth(st, JAN);
  assert.equal(st.months[JAN].debt.length, 0);
  assert.equal(E.isPaidOff(st, debt), true);
});

test('starting empty ignores the previous month', () => {
  const { st } = sample();
  E.createMonth(st, DEC, false);
  assert.deepEqual(st.months[DEC], E.emptyMonth());
});

test('reset: zero keeps lines and spending, clear removes everything', () => {
  const { st } = sample();
  E.resetMonth(st, NOV, 'zero');
  const m = st.months[NOV];
  assert.equal(m.expenses.length, 2);
  assert.ok([...m.income, ...m.debt, ...m.expenses].every((l) => l.planned === 0));
  assert.equal(m.expenses[1].actual, 12345);
  E.resetMonth(st, NOV, 'clear');
  assert.deepEqual(st.months[NOV], E.emptyMonth());
});

test('reset by copying replaces the month, and its own payments do not count', () => {
  const { st, debt } = sample();
  E.createMonth(st, DEC);
  st.months[DEC].debt[0].actual = 50000; // pays it off in December
  st.months[DEC].expenses.push(E.line({ name: 'Gifts', planned: 20000 }));
  assert.equal(E.resetMonth(st, DEC, 'copy'), true);
  assert.deepEqual(st.months[DEC].expenses.map((l) => l.name), ['Rent', 'Food']);
  assert.equal(st.months[DEC].debt.length, 1); // payment was wiped, so still owed
  assert.equal(E.debtLeft(st, debt), 50000);
  assert.equal(E.resetMonth(st, NOV, 'copy'), false); // nothing before November
});

test('deleting a debt removes its lines everywhere', () => {
  const { st, debt } = sample();
  E.createMonth(st, DEC);
  E.deleteDebt(st, debt.id);
  assert.equal(st.debts.length, 0);
  assert.equal(st.months[NOV].debt.length, 0);
  assert.equal(st.months[DEC].debt.length, 0);
});

test('debt lines show the debt name, so renames carry through', () => {
  const { st, debt } = sample();
  E.createMonth(st, DEC);
  debt.name = 'Car loan';
  assert.equal(E.lineName(st, st.months[DEC].debt[0]), 'Car loan');
});

test('normalize round-trips good data and drops what it cannot read', () => {
  const { st } = sample();
  const back = E.normalize(JSON.parse(JSON.stringify(st)));
  assert.equal(back.dropped, 0);
  assert.deepEqual(back.state, st);

  const bad = JSON.parse(JSON.stringify(st));
  bad.months['2026-13'] = E.emptyMonth();
  bad.months[NOV].expenses.push({ name: 'Bad', planned: -5 });
  bad.months[NOV].expenses.push({ name: 'Float', planned: 1.5 });
  bad.months[NOV].debt.push({ debtId: 'missing', planned: 100 });
  bad.months[NOV].income.push({ name: '', planned: 100 });
  bad.debts.push({ id: 'x' });
  const r = E.normalize(bad);
  assert.equal(r.dropped, 6);
  assert.equal(r.state.months[NOV].expenses.length, 2);
  assert.equal(r.state.months[NOV].debt.length, 1);
  assert.equal(E.normalize(null).dropped, 1);
  assert.equal(E.isBackup({ months: {}, debts: [] }), true);
  assert.equal(E.isBackup({ moves: [] }), false);
});

test('csv lists every line with debt names resolved', () => {
  const { st } = sample();
  const csv = E.toCsv(st).trim().split('\n');
  assert.equal(csv[0], 'month,section,name,planned,actual,due_day');
  assert.ok(csv.includes('2026-11,debt,Car,300.00,0.00,6'));
  assert.ok(csv.includes('2026-11,expenses,Food,600.00,123.45,'));
});
