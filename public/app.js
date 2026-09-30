const MEALS = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['snacks', 'Snacks'],
];
const RING_LEN = 2 * Math.PI * 52;

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

function sum(list) {
  return list.reduce(
    (t, e) => ({ calories: t.calories + e.calories, protein: t.protein + e.protein, carbs: t.carbs + e.carbs, fat: t.fat + e.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function dayLabel(iso) {
  if (iso === state.today) return 'Today';
  if (iso === shiftDate(state.today, -1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function render() {
  const isToday = state.date === state.today;
  $('#day-label').textContent = dayLabel(state.date);
  $('#go-today').hidden = isToday;
  $('#next').disabled = isToday;

  const g = state.goals;
  const t = sum(state.entries);

  // Calorie ring
  const ratio = g.calories ? t.calories / g.calories : 0;
  const ring = $('#ring');
  ring.style.strokeDasharray = RING_LEN;
  ring.style.strokeDashoffset = RING_LEN * (1 - Math.min(ratio, 1));
  ring.classList.toggle('over', ratio > 1);
  $('#cal-total').textContent = fmt(t.calories);
  const left = g.calories - t.calories;
  $('#cal-sub').textContent = g.calories
    ? (left >= 0 ? `${fmt(left)} left of ${fmt(g.calories)}` : `${fmt(-left)} over ${fmt(g.calories)}`)
    : 'kcal';

  // Macro bars
  for (const el of document.querySelectorAll('.macro')) {
    const k = el.dataset.key;
    el.querySelector('.macro-val').textContent = g[k] ? `${fmt(t[k])} / ${fmt(g[k])} g` : `${fmt(t[k])} g`;
    el.querySelector('i').style.width = `${g[k] ? Math.min(100, (t[k] / g[k]) * 100) : 0}%`;
  }

  // Meal sections
  $('#meals').replaceChildren(
    ...MEALS.map(([key, label]) => {
      const items = state.entries.filter((e) => e.meal === key);
      const s = sum(items);
      const card = document.createElement('section');
      card.className = 'card';
      card.innerHTML = `
        <div class="meal-head"><h2></h2><span class="meal-kcal"></span></div>
        <div class="meal-macros"></div>
        <ul class="items"></ul>`;
      card.querySelector('h2').textContent = label;
      card.querySelector('.meal-kcal').textContent = `${fmt(s.calories)} kcal`;
      card.querySelector('.meal-macros').textContent = `P ${fmt(s.protein)}g · C ${fmt(s.carbs)}g · F ${fmt(s.fat)}g`;
      const ul = card.querySelector('.items');
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Nothing logged';
        ul.append(li);
      }
      for (const e of items) {
        const li = document.createElement('li');
        li.className = 'item';
        li.innerHTML = `
          <div><div class="item-name"></div><div class="item-macros"></div></div>
          <span class="item-kcal"></span>
          <button class="del" aria-label="Remove">×</button>`;
        li.querySelector('.item-name').textContent = e.name;
        li.querySelector('.item-macros').textContent = `P ${fmt(e.protein)}g · C ${fmt(e.carbs)}g · F ${fmt(e.fat)}g`;
        li.querySelector('.item-kcal').textContent = `${fmt(e.calories)} kcal`;
        li.querySelector('.del').onclick = async () => {
          if (!confirm(`Remove "${e.name}"?`)) return;
          await api(`/entries/${e.id}`, { method: 'DELETE' });
          loadDay();
        };
        ul.append(li);
      }
      return card;
    }),
  );
}

// Guess the meal from the time of day so the default is usually right.
function defaultMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks';
}

const form = $('#add-form');

// Picking a previously logged food fills in its macros.
form.name.addEventListener('input', () => {
  const f = state.foods.find((x) => x.name.toLowerCase() === form.name.value.trim().toLowerCase());
  if (f) for (const k of ['calories', 'protein', 'carbs', 'fat']) form[k].value = f[k];
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    await api('/entries', { method: 'POST', body: { ...data, date: state.date } });
  } catch (e) {
    return alert(e.message);
  }
  const meal = form.meal.value;
  form.reset();
  form.meal.value = meal;
  form.name.focus();
  loadDay();
  loadFoods();
});

$('#prev').onclick = () => { state.date = shiftDate(state.date, -1); loadDay(); };
$('#next').onclick = () => { if (state.date < state.today) { state.date = shiftDate(state.date, 1); loadDay(); } };
$('#go-today').onclick = () => { state.date = state.today; loadDay(); };

// Goals dialog
const dlg = $('#goals-dialog');
const gform = $('#goals-form');
$('#open-goals').onclick = () => {
  for (const k of ['calories', 'protein', 'carbs', 'fat']) gform[k].value = state.goals[k] ?? '';
  dlg.showModal();
};
dlg.addEventListener('close', async () => {
  if (dlg.returnValue !== 'save') return;
  state.goals = await api('/goals', { method: 'PUT', body: Object.fromEntries(new FormData(gform)) });
  render();
});

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
  form.meal.value = defaultMeal();
  state.goals = await api('/goals');
  await Promise.all([loadDay(), loadFoods()]);
})();
