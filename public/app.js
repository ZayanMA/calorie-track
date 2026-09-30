const KEYS = ['calories', 'protein', 'carbs', 'fat'];

const $ = (s) => document.querySelector(s);
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString();

// Local calendar date as YYYY-MM-DD — "today" follows the device's timezone.
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

const state = { date: localDate(), today: localDate(), entries: [], goals: {}, foods: [] };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.status === 204 ? null : res.json();
}

async function loadDay() {
  state.entries = await api(`/entries?date=${state.date}`);
  render();
}
async function loadFoods() {
  state.foods = await api('/foods');
  $('#foods').replaceChildren(...state.foods.map((f) => new Option(`${fmt(f.calories)} kcal`, f.name)));
}

function dayLabel(iso) {
  if (iso === state.today) return 'Today';
  if (iso === shiftDate(state.today, -1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const pct = (v, goal) => `${goal ? Math.min(100, (v / goal) * 100) : 0}%`;

function render() {
  const isToday = state.date === state.today;
  $('#day-label').textContent = dayLabel(state.date);
  $('#go-today').hidden = isToday;
  $('#next').disabled = isToday;

  const g = state.goals;
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of state.entries) for (const k of KEYS) t[k] += e[k];

  $('#cal-total').textContent = fmt(t.calories);
  const left = g.calories - t.calories;
  $('#cal-sub').textContent = !g.calories ? 'kcal'
    : left >= 0 ? `/ ${fmt(g.calories)} kcal · ${fmt(left)} left`
    : `/ ${fmt(g.calories)} kcal · ${fmt(-left)} over`;
  $('#cal-bar').style.width = pct(t.calories, g.calories);
  $('#cal-bar').classList.toggle('over', g.calories && t.calories > g.calories);

  for (const el of document.querySelectorAll('.macro')) {
    const k = el.dataset.key;
    el.querySelector('.val').innerHTML = `${fmt(t[k])}g${g[k] ? ` <small>/ ${fmt(g[k])}g</small>` : ''}`;
    el.querySelector('i').style.width = pct(t[k], g[k]);
  }

  $('#empty').hidden = state.entries.length > 0;
  $('#items').replaceChildren(
    ...state.entries.map((e) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="item">
          <div><div class="item-name"></div><div class="item-macros"></div></div>
          <span class="item-kcal"></span>
        </button>`;
      li.querySelector('.item-name').textContent = e.name;
      li.querySelector('.item-macros').textContent = `P ${fmt(e.protein)}g · C ${fmt(e.carbs)}g · F ${fmt(e.fat)}g`;
      li.querySelector('.item-kcal').innerHTML = `${fmt(e.calories)} <small>kcal</small>`;
      li.querySelector('.item').onclick = () => openFood(e);
      return li;
    }),
  );
}

// Parse a typed number, allowing a comma as the decimal separator. Empty means 0.
function parseNum(v) {
  const s = String(v).trim().replace(',', '.');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// ---------- add / edit dialog ----------
const foodDlg = $('#food-dialog');
const form = $('#food-form');
let editing = null; // entry being edited, or null when adding

function openFood(entry = null) {
  editing = entry;
  form.reset();
  $('#food-error').hidden = true;
  $('#food-title').textContent = entry ? 'Edit food' : 'Add food';
  $('#food-submit').textContent = entry ? 'Save' : 'Add';
  $('#delete-food').hidden = !entry;
  if (entry) {
    form.name.value = entry.name;
    for (const k of KEYS) form[k].value = entry[k] || '';
  }
  foodDlg.showModal();
  if (!entry) form.name.focus();
}

// Picking a previously logged food fills in its macros.
form.name.addEventListener('input', () => {
  const f = state.foods.find((x) => x.name.toLowerCase() === form.name.value.trim().toLowerCase());
  if (f) for (const k of KEYS) form[k].value = f[k] || '';
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#food-error');
  const body = { name: form.name.value.trim(), date: editing ? editing.date : state.date };
  for (const k of KEYS) body[k] = parseNum(form[k].value);
  if (!body.name) { err.textContent = 'Give it a name.'; err.hidden = false; return form.name.focus(); }
  const bad = KEYS.find((k) => Number.isNaN(body[k]));
  if (bad) { err.textContent = 'Numbers only, please.'; err.hidden = false; return form[bad].focus(); }
  try {
    if (editing) await api(`/entries/${editing.id}`, { method: 'PUT', body });
    else await api('/entries', { method: 'POST', body });
  } catch (e) {
    err.textContent = e.message; err.hidden = false; return;
  }
  foodDlg.close();
  loadDay();
  loadFoods();
});

$('#delete-food').onclick = async () => {
  if (!editing) return;
  await api(`/entries/${editing.id}`, { method: 'DELETE' });
  foodDlg.close();
  loadDay();
};

$('#open-add').onclick = () => openFood();

// ---------- goals dialog ----------
const goalsDlg = $('#goals-dialog');
const gform = $('#goals-form');
$('#open-goals').onclick = () => {
  for (const k of KEYS) gform[k].value = state.goals[k] || '';
  goalsDlg.showModal();
};
gform.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const body = {};
  for (const k of KEYS) {
    const n = parseNum(gform[k].value);
    if (!Number.isNaN(n)) body[k] = n;
  }
  state.goals = await api('/goals', { method: 'PUT', body });
  goalsDlg.close();
  render();
});

// Cancel buttons, and tapping the backdrop, close dialogs.
for (const dlg of [foodDlg, goalsDlg]) {
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect(); // clicks on the dialog's own padding also target it
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
}

// ---------- day navigation ----------
$('#prev').onclick = () => { state.date = shiftDate(state.date, -1); loadDay(); };
$('#next').onclick = () => { if (state.date < state.today) { state.date = shiftDate(state.date, 1); loadDay(); } };
$('#go-today').onclick = () => { state.date = state.today; loadDay(); };

// Roll over to the new day at midnight (and when the tab/app is reopened).
function checkRollover() {
  const now = localDate();
  if (now === state.today) return;
  const wasOnToday = state.date === state.today;
  state.today = now;
  if (wasOnToday) state.date = now;
  loadDay();
}
setInterval(checkRollover, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });

(async () => {
  state.goals = await api('/goals');
  await Promise.all([loadDay(), loadFoods()]);
})();
