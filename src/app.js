const storageKey = "lakitchen.basic.state";

const initialState = {
  meals: [
    { id: "desayuno", name: "Avena, yogur y fruta", calories: 420, protein: 28 },
    { id: "almuerzo", name: "Bowl de pollo y arroz", calories: 610, protein: 46 },
  ],
  pantry: [
    { id: "huevos", name: "Huevos", quantity: 8, unit: "uds", minimum: 6 },
    { id: "arroz", name: "Arroz jazmín", quantity: 1.4, unit: "kg", minimum: 1 },
    { id: "yogur", name: "Yogur griego", quantity: 2, unit: "tarrinas", minimum: 3 },
  ],
};

const selectors = {
  mealForm: document.querySelector("[data-meal-form]"),
  pantryForm: document.querySelector("[data-pantry-form]"),
  mealList: document.querySelector("[data-meal-list]"),
  pantryList: document.querySelector("[data-pantry-list]"),
  totalCalories: document.querySelector("[data-total-calories]"),
  totalProtein: document.querySelector("[data-total-protein]"),
  calorieProgress: document.querySelector("[data-calorie-progress]"),
  mealCount: document.querySelector("[data-meal-count]"),
  pantryCount: document.querySelector("[data-pantry-count]"),
  alertCount: document.querySelector("[data-alert-count]"),
};

let state = readState();

function readState() {
  try {
    const savedState = window.localStorage.getItem(storageKey);
    return savedState ? { ...initialState, ...JSON.parse(savedState) } : initialState;
  } catch {
    return initialState;
  }
}

function save(nextState) {
  state = nextState;
  window.localStorage.setItem(storageKey, JSON.stringify(state));
  render();
}

function formatNumber(value) {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function render() {
  const totals = state.meals.reduce(
    (summary, meal) => ({
      calories: summary.calories + meal.calories,
      protein: summary.protein + meal.protein,
    }),
    { calories: 0, protein: 0 },
  );
  const lowStock = state.pantry.filter((item) => item.quantity <= item.minimum);

  selectors.totalCalories.textContent = formatNumber(totals.calories);
  selectors.totalProtein.textContent = formatNumber(totals.protein);
  selectors.calorieProgress.style.width = `${Math.min(100, (totals.calories / 2200) * 100)}%`;
  selectors.mealCount.textContent = state.meals.length;
  selectors.pantryCount.textContent = state.pantry.length;
  selectors.alertCount.textContent = lowStock.length;

  selectors.mealList.innerHTML = state.meals
    .map(
      (meal) => `
        <article class="list-item">
          <div>
            <strong>${escapeHtml(meal.name)}</strong>
            <span>${formatNumber(meal.calories)} kcal · ${formatNumber(meal.protein)} g proteína</span>
          </div>
          <button aria-label="Eliminar ${escapeHtml(meal.name)}" data-remove-meal="${meal.id}">×</button>
        </article>
      `,
    )
    .join("");

  selectors.pantryList.innerHTML = state.pantry
    .map(
      (item) => `
        <article class="list-item ${item.quantity <= item.minimum ? "list-item--low" : ""}">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${formatNumber(item.quantity)} ${item.unit} · mínimo ${formatNumber(item.minimum)}</span>
          </div>
          <div class="stepper" aria-label="Cantidad de ${escapeHtml(item.name)}">
            <button type="button" data-step-item="${item.id}" data-direction="-1">−</button>
            <button type="button" data-step-item="${item.id}" data-direction="1">+</button>
          </div>
        </article>
      `,
    )
    .join("");
}

selectors.mealForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") ?? "").trim();
  const calories = Number(form.get("calories"));
  const protein = Number(form.get("protein"));

  if (!name || calories <= 0 || protein < 0) return;

  save({ ...state, meals: [...state.meals, { id: makeId(), name, calories, protein }] });
  event.currentTarget.reset();
});

selectors.pantryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") ?? "").trim();

  if (!name) return;

  save({
    ...state,
    pantry: [...state.pantry, { id: makeId(), name, quantity: 1, unit: "ud", minimum: 1 }],
  });
  event.currentTarget.reset();
});

selectors.mealList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-meal]");
  if (!button) return;

  save({ ...state, meals: state.meals.filter((meal) => meal.id !== button.dataset.removeMeal) });
});

selectors.pantryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-step-item]");
  if (!button) return;

  const direction = Number(button.dataset.direction);
  save({
    ...state,
    pantry: state.pantry.map((item) =>
      item.id === button.dataset.stepItem
        ? { ...item, quantity: Math.max(0, Number((item.quantity + direction).toFixed(1))) }
        : item,
    ),
  });
});

render();
