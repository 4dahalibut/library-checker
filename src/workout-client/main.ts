import "./style.css";
import { heroOfTheDay } from "./heroes.js";

const API_URL = "/workout/api";

type Unit = "reps" | "breaths" | "steps" | "m";
type Side = "left" | "right";

/** A sequence slot at its ladder's current rung */
interface SequenceItem {
  ladderId: string;
  ladderName: string;
  label?: string;
  rung: number;
  rungCount: number;
  extraSide?: Side;
  exerciseId: string;
  name: string;
  weighted: boolean;
  timed: boolean;
  toFailure: boolean;
  sets?: number;
  reps?: number;
  repsMax?: number;
  seconds?: number;
  secondsMax?: number;
  unit?: Unit;
  perSide?: boolean;
  weight?: number;
  cue?: string;
}

interface Sequence {
  id: string;
  name: string;
  items: SequenceItem[];
}

interface Rung {
  exerciseId: string;
  sets?: number;
  reps?: number;
  repsMax?: number;
  seconds?: number;
  secondsMax?: number;
  unit?: Unit;
  perSide?: boolean;
  weight?: number;
  cue?: string;
}

interface Ladder {
  id: string;
  name: string;
  extraSide?: Side;
  currentRung: number;
  rungs: Rung[];
}

interface Exercise {
  id: string;
  name: string;
}

interface SessionSummary {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  finished_at: string | null;
  word: string | null;
  effort: number | null;
  conscientiousness: number | null;
  total: number;
  done: number;
  skipped: number;
}

interface SessionItem {
  id: number;
  name: string;
  cue: string;
  label: string;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_seconds: number | null;
  target_seconds_max: number | null;
  target_weight: number | null;
  unit: Unit;
  per_side: number;
  extra_side: Side | null;
  sets_done: number;
  skipped: number;
  weight: number | null;
  seconds: number | null;
  notes: string;
  ladder_id: string | null;
  rung: number | null;
  weighted: number;
  timed: number;
  to_failure: number;
  set_reps: (number | null)[];
  last_set_reps: (number | null)[];
  last_note: LatestNote | null;
  description: string;
  cues: string[];
}

interface PastNote {
  date: string;
  text: string;
}

interface LatestNote extends PastNote {
  count: number;
}

interface Session {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  notes: string;
  finished_at: string | null;
  word: string | null;
  effort: number | null;
  conscientiousness: number | null;
  last_session_note: LatestNote | null;
  items: SessionItem[];
}

interface WeekItem {
  sequenceId: string;
  name: string;
  optional: boolean;
  session: { id: number; finished: boolean; word: string | null; done: number; total: number } | null;
}

interface WeekDay {
  date: string;
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  changed: boolean;
  items: WeekItem[];
  extras: {
    id: number;
    sequenceId: string;
    sequenceName: string;
    finished: boolean;
    word: string | null;
    done: number;
    total: number;
  }[];
}

interface Week {
  days: WeekDay[];
  progress: { sequenceId: string; name: string; target: number; done: number; minimum: number | null }[];
  minimumMet: boolean | null;
}

interface PlanItem {
  sequenceId: string;
  optional?: boolean;
}

const app = document.getElementById("app")!;

// --- API ---

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// Saves are fire-and-forget from the UI's point of view; the status spot only speaks up
// when one fails, and clears once saving works again
let pendingSaves = 0;

function setSaveStatus(text: string, failed = false): void {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("failed", failed);
}

async function save(path: string, body: Record<string, unknown>, method = "PATCH"): Promise<boolean> {
  pendingSaves++;
  try {
    await api(path, { method, body: JSON.stringify(body) });
    pendingSaves--;
    if (pendingSaves === 0) setSaveStatus("");
    return true;
  } catch {
    pendingSaves--;
    setSaveStatus("Not saved — check signal", true);
    return false;
  }
}

const debounceTimers = new Map<string, number>();

function saveLater(key: string, path: string, body: Record<string, unknown>, method = "PATCH"): void {
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(
    key,
    window.setTimeout(() => {
      debounceTimers.delete(key);
      save(path, body, method);
    }, 600)
  );
}

// --- Formatting ---

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (dateStr === localToday()) return "Today";
  return `${DAYS[date.getDay()]} ${MONTHS[m - 1]} ${d}`;
}

function dayNumber(dateStr: string): number {
  return Number(dateStr.slice(8));
}

function formatDuration(from: number, to: number | null): string {
  const minutes = from >= 60 && from % 60 === 0 && (to === null || to % 60 === 0);
  if (minutes) return `${from / 60}${to ? `–${to / 60}` : ""} min`;
  return `${from}${to ? `–${to}` : ""}s`;
}

interface Target {
  sets: number | null;
  reps: number | null;
  repsMax: number | null;
  seconds: number | null;
  secondsMax: number | null;
  weight: number | null;
  unit: Unit;
  perSide: boolean;
  extraSide: Side | null;
  toFailure: boolean;
}

const UNIT_SUFFIX: Record<Unit, string> = { reps: "", breaths: " breaths", steps: " steps", m: "m" };

/** e.g. "3 × 8–12", "2 × 20–30s/side (+1 R)", "4 × 5 breaths", "2 sets to failure" */
function targetText(t: Target): string {
  let each = "";
  if (t.reps) each = `${t.reps}${t.repsMax ? `–${t.repsMax}` : ""}${UNIT_SUFFIX[t.unit]}`;
  else if (t.seconds) each = formatDuration(t.seconds, t.secondsMax);
  if (each && t.perSide) each += t.unit === "steps" ? " each way" : "/side";

  let text = "";
  if (t.sets && each) text = `${t.sets} × ${each}`;
  else if (t.sets === 1 && t.toFailure) text = "1 set";
  else if (t.sets) text = `${t.sets} sets`;
  else text = t.reps && t.unit === "reps" ? `${each} reps` : each;
  if (t.extraSide) text += ` (+1 ${t.extraSide === "left" ? "L" : "R"})`;
  if (t.weight) text += ` @ ${t.weight} lb`;
  if (t.toFailure) text = `${text ? `${text} ` : ""}to failure`;
  return text;
}

function rungTarget(r: Rung, extras: { extraSide?: Side; toFailure?: boolean }): string {
  return targetText({
    sets: r.sets ?? null,
    reps: r.reps ?? null,
    repsMax: r.repsMax ?? null,
    seconds: r.seconds ?? null,
    secondsMax: r.secondsMax ?? null,
    weight: r.weight ?? null,
    unit: r.unit ?? "reps",
    perSide: !!r.perSide,
    extraSide: extras.extraSide ?? null,
    toFailure: !!extras.toFailure,
  });
}

function sessionTarget(item: SessionItem): string {
  return targetText({
    sets: item.target_sets,
    reps: item.target_reps,
    repsMax: item.target_reps_max,
    seconds: item.target_seconds,
    secondsMax: item.target_seconds_max,
    weight: item.target_weight,
    unit: item.unit,
    perSide: !!item.per_side,
    extraSide: item.extra_side,
    toFailure: !!item.to_failure,
  });
}

function exerciseCount(n: number): string {
  return `${n} exercise${n === 1 ? "" : "s"}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function parseNumber(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Sets to tick: the target (a single check if none), plus the extra set on a biased side */
function totalSets(item: SessionItem): number {
  return Math.max(item.target_sets ?? 1, 1) + (item.extra_side ? 1 : 0);
}

function isDone(item: SessionItem): boolean {
  return !item.skipped && item.sets_done >= totalSets(item);
}

// --- Whimsy ---

const CHEERS = ["Nice!", "Crushed it", "Yesss", "Done!", "Beast", "Smooth", "Hot dog!", "Boom"];

function cheerFor(item: SessionItem): string {
  return CHEERS[item.id % CHEERS.length];
}

function stampText(item: SessionItem): string {
  if (item.skipped) return "Not today";
  return isDone(item) ? cheerFor(item) : "";
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late, night owl?";
  if (hour < 11) return "Morning, sunshine.";
  if (hour < 14) return "Lunchtime lift?";
  if (hour < 18) return "Afternoon, champ.";
  return "Evening, legend.";
}

const CONFETTI_COLORS = ["#ff6f4f", "#ffd84a", "#7be0a0", "#8f7bff", "#4fc3ff"];

function confetti(from: HTMLElement, count = 18): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = from.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.left = `${rect.left + rect.width / 2}px`;
    bit.style.top = `${rect.top + rect.height / 2}px`;
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 110;
    bit.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * distance - 40}px`);
    bit.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
    document.body.appendChild(bit);
    bit.addEventListener("animationend", () => bit.remove());
  }
}

// --- Self-ratings out of 5 ---

const RATINGS = [
  { field: "effort", label: "Effort" },
  { field: "conscientiousness", label: "Conscientiousness" },
] as const;
type RatingField = (typeof RATINGS)[number]["field"];

/** e.g. "Effort ★4 · Conscientiousness ★5" as HTML, leaving out ones not given; each pair stays on one line */
function ratingsText(r: { effort: number | null; conscientiousness: number | null }): string {
  return RATINGS.filter(({ field }) => r[field] !== null)
    .map(({ field, label }) => `<span class="rating-pair">${label} ★${r[field]}</span>`)
    .join(" · ");
}

// --- Words for how a session went ---
// A dozen are drawn each time from across the range, so there's always one that fits

const WORD_GROUPS: string[][] = [
  // Flying
  ["Electric", "Unstoppable", "Rocket-fuelled", "Thunderous", "Supernova", "Turbo", "Main character", "Volcanic", "Legendary", "Lightning in a bottle"],
  // Solid
  ["Crisp", "Dialed", "Clockwork", "Shipshape", "Sturdy", "Buttoned-up", "Even-keeled", "No-drama", "Workmanlike", "Squared away"],
  // Smooth
  ["Buttery", "Silky", "Floaty", "Velvet", "Gliding", "Liquid", "Swan-like", "Frictionless", "Effortless", "Flowy"],
  // Meh
  ["Meh", "Lukewarm", "Beige", "Foggy", "Clunky", "Half-baked", "Off-key", "Static-y", "Bleh", "Unremarkable"],
  // Tough
  ["Spicy", "Gritty", "Gnarly", "Character-building", "Molten", "Uphill", "Grindy", "Swampy", "Hard-won", "Sweaty"],
  // Tired
  ["Noodly", "Running on fumes", "Zombie", "Jelly-legged", "Potato", "Molasses", "Low battery", "Snoozy", "Sluggish", "Creaky"],
  // Short
  ["Snack-sized", "Espresso shot", "Speedrun", "Drive-by", "Pocket-sized", "Tiny but mighty", "Zip-zap", "Express", "Bite-sized", "Blink-and-done"],
  // Careful
  ["Tender", "Bubble-wrapped", "Tiptoe", "Kid gloves", "Rusty", "Stiff", "Easy does it", "Gentle", "Babying it", "Achy"],
  // Fun
  ["Groovy", "Disco", "Giggly", "Jazzy", "Sunny", "Puppyish", "Confetti", "Bouncy", "Cha-cha", "Sparkly"],
  // Out there
  ["Cosmic", "Feral", "Gremlin", "Haunted", "Unhinged", "Wonky", "Kaleidoscope", "Spaghetti", "Squirrelly", "Interpretive dance"],
  // Focused
  ["Laser", "Monk mode", "Surgical", "Meditative", "Deliberate", "Precise", "Quiet", "Locked-in", "Intentional", "Zen"],
];

function pickWords(count = 12): string[] {
  const shuffle = <T,>(list: T[]) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const groups = WORD_GROUPS.map(shuffle);
  const picked: string[] = [];
  // Round-robin across the groups so every kind of day is represented
  for (let round = 0; picked.length < count; round++) {
    for (const group of shuffle(groups)) {
      if (picked.length < count && group[round]) picked.push(group[round]);
    }
  }
  return shuffle(picked);
}

// --- Sheet (a sticker that slides up for picking things) ---

function openSheet(title: string, body: string, onOpen: (sheet: HTMLElement, close: () => void) => void): void {
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `
    <div class="sheet sticker" role="dialog" aria-label="${escapeHtml(title)}">
      <div class="sheet-head">
        <h2 class="sheet-title">${escapeHtml(title)}</h2>
        <button class="sheet-close" aria-label="Close">×</button>
      </div>
      ${body}
    </div>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector(".sheet-close")!.addEventListener("click", close);
  document.body.appendChild(backdrop);
  onOpen(backdrop.querySelector(".sheet")!, close);
}

// --- Home ---

const TRASH_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

const EDIT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>`;

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type PillItem = { sequenceId: string; name: string; optional: boolean; session: WeekItem["session"]; extra?: boolean };

/** One session on a day of the week: tap to start it, or to reopen it once begun */
function sessionPill(item: PillItem, day: WeekDay): string {
  const s = item.session;
  const state = s?.finished
    ? "done"
    : s
      ? "started"
      : day.isPast
        ? "missed"
        : item.optional
          ? "optional"
          : "";
  const status = s?.finished
    ? `<span class="pill-status">✓</span>`
    : s
      ? `<span class="pill-status">${s.done}/${s.total}</span>`
      : "";
  const body = `<span class="pill-name">${escapeHtml(item.name)}</span>${status}`;
  // Nothing to open for a past day that was skipped
  if (state === "missed") return `<span class="session-pill missed">${body}</span>`;
  const href = s ? `#session-${s.id}` : `#sequence-${encodeURIComponent(item.sequenceId)}`;
  // Planned sessions not yet begun can be dragged to another day
  const drag = !s && !item.extra ? ` data-drag-from="${day.date}" data-sequence="${escapeHtml(item.sequenceId)}" draggable="false"` : "";
  return `<a class="session-pill ${state}${item.extra ? " extra" : ""}" href="${href}"${drag}>${body}</a>`;
}

function dayTitle(day: WeekDay): string {
  return day.isToday ? "Today" : formatDate(day.date);
}

function heroCard(): string {
  const hero = heroOfTheDay();
  if (!hero) return "";
  return `
    <figure class="hero">
      <img class="hero-face" src="${hero.face}" alt="${escapeHtml(hero.name)}" width="96" height="96" />
      <figcaption class="hero-name">${escapeHtml(hero.name)}</figcaption>
    </figure>`;
}

// Home opens on just today; tapping it shows the whole week (kept while the app is open)
let weekOpen = false;

async function renderHome(): Promise<void> {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  const today = localToday();
  let sequences: Sequence[];
  let sessions: SessionSummary[];
  let week: Week;
  try {
    [{ sequences }, { sessions }, { week }] = await Promise.all([
      api<{ sequences: Sequence[] }>("/sequences"),
      api<{ sessions: SessionSummary[] }>("/sessions"),
      api<{ week: Week }>(`/week?today=${today}`),
    ]);
  } catch {
    app.innerHTML = `<p class="loading">Couldn't load workouts. Check your connection and reopen.</p>`;
    return;
  }

  const rows = week.days
    .map((d) => {
      const pills: PillItem[] = [
        ...d.items,
        ...d.extras.map((e) => ({
          sequenceId: e.sequenceId,
          name: e.sequenceName,
          optional: false,
          session: { id: e.id, finished: e.finished, word: e.word, done: e.done, total: e.total },
          extra: true,
        })),
      ];
      const content = pills.length
        ? pills.map((p) => sessionPill(p, d)).join("")
        : `<span class="rest">${d.isPast ? "Nothing" : "Rest"}</span>`;
      return `
        <div class="week-row${d.isToday ? " today" : ""}${d.isPast ? " past" : ""}"${d.isPast ? "" : ` data-drop="${d.date}"`}>
          <button class="week-day" aria-label="${d.isToday ? "Show or hide the rest of the week" : formatDate(d.date)}">
            <span class="week-dow">${d.isToday ? "Today" : SHORT_DAYS[d.weekday]}</span>
            <span class="week-date">${dayNumber(d.date)}${d.isToday ? `<span class="week-chevron" aria-hidden="true">▾</span>` : ""}</span>
          </button>
          <div class="week-sessions">${content}</div>
          ${d.isPast ? "" : `<button class="week-edit" data-date="${d.date}" aria-label="Change ${dayTitle(d)}">${EDIT_ICON}</button>`}
        </div>`;
    })
    .join("");

  const history = sessions.length
    ? sessions
        .map((s) => {
          const skipped = s.skipped ? `, ${s.skipped} skipped` : "";
          return `
        <div class="log-row">
          <a class="history-row${s.finished_at ? " complete" : ""}" href="#session-${s.id}">
            <span class="history-date">${formatDate(s.date)}</span>
            <span class="history-name">${escapeHtml(s.sequence_name)}${
              s.finished_at && s.word ? `<span class="history-word">${escapeHtml(s.word)}</span>` : ""
            }${ratingsText(s) ? `<span class="history-ratings">${ratingsText(s)}</span>` : ""}</span>
            ${s.finished_at && s.word ? "" : `<span class="history-count">${s.done}/${s.total}${skipped}</span>`}
          </a>
          <button class="log-trash" data-delete="${s.id}" aria-label="Delete ${escapeHtml(s.sequence_name)} on ${formatDate(s.date)}">${TRASH_ICON}</button>
        </div>`;
        })
        .join("")
    : `<p class="empty">Nothing yet. Your first workout will land here.</p>`;

  app.innerHTML = `
    <header class="home-header">
      <div>
        <h1>Workouts</h1>
        <p class="greeting">${greeting()}</p>
      </div>
      ${heroCard()}
    </header>
    <section>
      <h2 id="week-heading">${weekOpen ? "This week" : "Today"}</h2>
      <div class="week-list sticker${weekOpen ? "" : " collapsed"}">${rows}</div>
    </section>
    <section>
      <h2>Log</h2>
      ${sessions.length ? `<div class="history sticker">${history}</div>` : history}
    </section>
  `;

  // Two taps to delete, like inside a session
  app.querySelectorAll<HTMLButtonElement>(".log-trash").forEach((btn) => {
    let timer = 0;
    btn.addEventListener("click", async () => {
      if (!btn.classList.contains("armed")) {
        btn.classList.add("armed");
        btn.textContent = "Delete?";
        timer = window.setTimeout(() => {
          btn.classList.remove("armed");
          btn.innerHTML = TRASH_ICON;
        }, 3000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      try {
        await api(`/sessions/${btn.dataset.delete}`, { method: "DELETE" });
        renderHome();
      } catch {
        btn.disabled = false;
        alert("Couldn't delete it. Check your connection.");
      }
    });
  });


  // Tapping a day's blank space opens or folds the rest of the week;
  // sessions still open and the pencil still edits
  const weekList = app.querySelector<HTMLElement>(".week-list")!;
  weekList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".week-row") || target.closest(".session-pill, .week-edit")) return;
    weekOpen = !weekOpen;
    weekList.classList.toggle("collapsed", !weekOpen);
    document.getElementById("week-heading")!.textContent = weekOpen ? "This week" : "Today";
  });

  app.querySelectorAll<HTMLButtonElement>(".week-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = week.days.find((d) => d.date === btn.dataset.date)!;
      openDaySheet(day, sequences);
    });
  });

  app.querySelectorAll<HTMLElement>("[data-drag-from]").forEach(bindDrag);
}

// --- Dragging sessions between days ---
// Press and hold a session to pick it up, then drop it on another day. A quick tap
// still opens it, and a swipe still scrolls, since only a held press starts a drag.

const HOLD_MS = 350;
const MOVE_TOLERANCE = 8;

let press: { pill: HTMLElement; x: number; y: number; timer: number } | null = null;
let drag: {
  pill: HTMLElement;
  ghost: HTMLElement;
  dx: number;
  dy: number;
  x: number;
  y: number;
  target: HTMLElement | null;
  frame: number;
} | null = null;
let suppressClick = false;

function bindDrag(pill: HTMLElement): void {
  pill.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    const x = e.clientX;
    const y = e.clientY;
    press = { pill, x, y, timer: window.setTimeout(() => startDrag(pill, x, y), HOLD_MS) };
  });
  // No long-press menu, link preview or the browser's own link dragging
  pill.addEventListener("contextmenu", (e) => e.preventDefault());
  pill.addEventListener("dragstart", (e) => e.preventDefault());
  pill.addEventListener("click", (e) => {
    if (suppressClick) {
      e.preventDefault();
      suppressClick = false;
    }
  });
}

function cancelPress(): void {
  if (press) clearTimeout(press.timer);
  press = null;
}

function startDrag(pill: HTMLElement, x: number, y: number): void {
  press = null;
  const rect = pill.getBoundingClientRect();
  const ghost = pill.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  pill.classList.add("drag-source");
  document.body.classList.add("dragging");
  navigator.vibrate?.(12);
  drag = { pill, ghost, dx: x - rect.left, dy: y - rect.top, x, y, target: null, frame: 0 };
  updateDrag();
  drag.frame = requestAnimationFrame(autoScroll);
}

function dropTargetAt(x: number, y: number): HTMLElement | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]") ?? null;
  return row && row.dataset.drop !== drag?.pill.dataset.dragFrom ? row : null;
}

function updateDrag(): void {
  if (!drag) return;
  drag.ghost.style.left = `${drag.x - drag.dx}px`;
  drag.ghost.style.top = `${drag.y - drag.dy}px`;
  const target = dropTargetAt(drag.x, drag.y);
  if (target !== drag.target) {
    drag.target?.classList.remove("drop-target");
    target?.classList.add("drop-target");
    drag.target = target;
  }
}

// Scroll the page when dragging near the top or bottom edge
function autoScroll(): void {
  if (!drag) return;
  const edge = 70;
  const speed = drag.y < edge ? -(edge - drag.y) / 5 : drag.y > innerHeight - edge ? (drag.y - (innerHeight - edge)) / 5 : 0;
  if (speed) {
    scrollBy(0, speed);
    updateDrag();
  }
  drag.frame = requestAnimationFrame(autoScroll);
}

async function endDrag(drop: boolean): Promise<void> {
  if (!drag) return;
  const { pill, ghost, target, frame } = drag;
  drag = null;
  cancelAnimationFrame(frame);
  ghost.remove();
  pill.classList.remove("drag-source");
  target?.classList.remove("drop-target");
  document.body.classList.remove("dragging");
  // The pointerup that ends a drag would otherwise also count as a tap
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 400);
  if (!drop || !target) return;
  try {
    await api("/days/move", {
      method: "POST",
      body: JSON.stringify({ from: pill.dataset.dragFrom, to: target.dataset.drop, sequenceId: pill.dataset.sequence }),
    });
  } catch {
    alert("Couldn't move it. Check your connection.");
  }
  renderHome();
}

document.addEventListener("pointermove", (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  if (drag) {
    drag.x = e.clientX;
    drag.y = e.clientY;
    updateDrag();
  }
});
document.addEventListener("pointerup", () => {
  cancelPress();
  endDrag(true);
});
document.addEventListener("pointercancel", () => {
  cancelPress();
  endDrag(false);
});
// While dragging, a finger moving shouldn't scroll the page
document.addEventListener(
  "touchmove",
  (e) => {
    if (drag) e.preventDefault();
  },
  { passive: false }
);

/**
 * Remove or add sessions on one day (moving is done by dragging). The sheet stays
 * open and updates in place, with the week refreshing behind it.
 */
function openDaySheet(day: WeekDay, sequences: Sequence[]): void {
  // The day's plan, kept here so several changes in a row build on each other
  const items = day.items.map((i) => ({
    sequenceId: i.sequenceId,
    optional: i.optional,
    name: i.name,
    started: !!i.session,
  }));
  const options = sequences
    .map((s) => `<button class="sheet-option" data-add="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`)
    .join("");

  openSheet(
    dayTitle(day),
    `<div class="edit-items"></div>
     <p class="sheet-label">To move a session, hold it in the week and drag it to another day.</p>
     <p class="sheet-label add-label">Add a session</p>
     <div class="sheet-options">${options}</div>`,
    (sheet) => {
      const list = sheet.querySelector<HTMLElement>(".edit-items")!;
      let busy = false;

      const save = async (next: typeof items, failure: string): Promise<boolean> => {
        if (busy) return false;
        busy = true;
        try {
          const plan: PlanItem[] = next.map(({ sequenceId, optional }) => ({ sequenceId, optional }));
          await api(`/days/${day.date}`, { method: "PUT", body: JSON.stringify({ items: plan }) });
          items.splice(0, items.length, ...next);
          renderList();
          renderHome();
          return true;
        } catch {
          alert(failure);
          return false;
        } finally {
          busy = false;
        }
      };

      const renderList = () => {
        // Sessions already begun stay put
        const editable = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.started);
        list.innerHTML = editable.length
          ? editable
              .map(
                ({ item, index }) => `
            <div class="edit-item">
              <span class="edit-name">${escapeHtml(item.name)}</span>
              <button class="remove-session" data-remove="${index}">Remove</button>
            </div>`
              )
              .join("")
          : `<p class="sheet-label">Nothing planned to remove.</p>`;
        list.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
          btn.addEventListener("click", () => {
            btn.disabled = true;
            save(
              items.filter((_, i) => i !== Number(btn.dataset.remove)),
              "Couldn't remove it. Check your connection."
            ).then((ok) => {
              if (!ok) btn.disabled = false;
            });
          });
        });
      };
      renderList();

      sheet.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((opt) => {
        opt.addEventListener("click", () => {
          const seq = sequences.find((s) => s.id === opt.dataset.add)!;
          save(
            [...items, { sequenceId: seq.id, optional: false, name: seq.name, started: false }],
            "Couldn't add it. Check your connection."
          );
        });
      });
    }
  );
}

// --- Sequence preview ---

/** On the preview, the rung chip opens the ladder so you can pick today's rung */
function rungChip(item: SequenceItem): string {
  if (item.rungCount < 2) return "";
  return `<button class="rung-chip ladder-open" data-ladder="${escapeHtml(item.ladderId)}">Rung ${item.rung}/${item.rungCount} ▸</button>`;
}

function openLadderSheet(ladder: Ladder, exercises: Exercise[], onChange: () => void): void {
  const nameOf = (id: string) => exercises.find((e) => e.id === id)?.name ?? id;
  const rows = ladder.rungs
    .map((r, i) => {
      const n = i + 1;
      return `
      <button class="rung-option${n === ladder.currentRung ? " current" : ""}" data-rung="${n}">
        <span class="rung-number">${n}</span>
        <span class="rung-body">
          <span class="rung-name">${escapeHtml(nameOf(r.exerciseId))}</span>
          <span class="rung-target">${rungTarget(r, { extraSide: ladder.extraSide })}</span>
          ${n === ladder.currentRung ? `<span class="rung-note">current</span>` : ""}
        </span>
      </button>`;
    })
    .join("");
  openSheet(
    `${ladder.name} ladder`,
    `<p class="sheet-label">Move up when you hit the top of the range two sessions in a row with good position.</p>
     <div class="rungs">${rows}</div>`,
    (sheet, close) => {
      sheet.querySelectorAll<HTMLButtonElement>("[data-rung]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const rung = Number(btn.dataset.rung);
          if (rung === ladder.currentRung) return close();
          btn.disabled = true;
          try {
            await api(`/ladders/${ladder.id}/rung`, { method: "PUT", body: JSON.stringify({ rung }) });
            close();
            onChange();
          } catch {
            btn.disabled = false;
            alert("Couldn't change the rung. Check your connection.");
          }
        });
      });
    }
  );
}

async function renderPreview(sequenceId: string): Promise<void> {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let sequence: Sequence | undefined;
  try {
    const { sequences } = await api<{ sequences: Sequence[] }>("/sequences");
    sequence = sequences.find((s) => s.id === sequenceId);
  } catch {
    app.innerHTML = `<p class="loading">Couldn't load this workout. <a href="#">Back</a></p>`;
    return;
  }
  if (!sequence) {
    app.innerHTML = `<p class="loading">That workout isn't around anymore. <a href="#">Back</a></p>`;
    return;
  }

  const rows = sequence.items
    .map((item) => {
      const target = rungTarget(item, item);
      return `
      <li class="preview-item">
        ${item.label ? `<span class="label-tag">${escapeHtml(item.label)}</span>` : ""}
        <span class="preview-name">${escapeHtml(item.name)}</span>
        ${target ? `<span class="target">${target}</span>` : ""}
        ${rungChip(item)}
      </li>`;
    })
    .join("");

  app.innerHTML = `
    <header class="session-header">
      <a class="back" href="#" aria-label="Back">‹</a>
      <div class="session-title">
        <h1>${escapeHtml(sequence.name)}</h1>
        <p>${exerciseCount(sequence.items.length)}</p>
      </div>
    </header>
    <ol class="preview sticker">${rows}</ol>
    <button id="start" class="start sticker">Start</button>
  `;

  // Picking a rung updates the preview, so Start gives exactly what's shown
  app.querySelectorAll<HTMLButtonElement>(".ladder-open").forEach((chip) => {
    chip.addEventListener("click", async () => {
      chip.disabled = true;
      try {
        const [{ ladders }, { exercises }] = await Promise.all([
          api<{ ladders: Ladder[] }>("/ladders"),
          api<{ exercises: Exercise[] }>("/exercises"),
        ]);
        const ladder = ladders.find((l) => l.id === chip.dataset.ladder);
        if (ladder) {
          openLadderSheet(ladder, exercises, async () => {
            const y = scrollY;
            await renderPreview(sequenceId);
            scrollTo(0, y);
          });
        }
      } catch {
        alert("Couldn't load the ladder. Check your connection.");
      }
      chip.disabled = false;
    });
  });

  const startBtn = document.getElementById("start") as HTMLButtonElement;
  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    try {
      const { session } = await api<{ session: Session }>("/sessions", {
        method: "POST",
        body: JSON.stringify({ sequenceId: sequence!.id, date: localToday() }),
      });
      // Replace so Back from the session goes home, not to the preview
      location.replace(`#session-${session.id}`);
    } catch {
      startBtn.disabled = false;
      alert("Couldn't start that workout. Check your connection.");
    }
  });
}

// --- Session ---

function renderSetButtons(item: SessionItem): string {
  const sets = totalSets(item);
  const extraLabel = item.extra_side === "left" ? "+L" : "+R";
  const labelFor = (i: number) => (item.extra_side && i === sets - 1 ? extraLabel : `${i + 1}`);
  if (item.to_failure) {
    return item.set_reps
      .map(
        (reps, i) =>
          `<label class="field rep-set${reps !== null ? " on" : ""}"><span>Set ${labelFor(i)}</span>
             <input type="text" inputmode="numeric" data-set-reps="${i + 1}" value="${reps ?? ""}"
               placeholder="${item.last_set_reps[i] ?? ""}" aria-label="Reps in set ${labelFor(i)}" /><span>reps</span></label>`
      )
      .join("");
  }
  if (sets === 1 && !item.target_sets) {
    return `<button class="set single${item.sets_done ? " on" : ""}" data-set="1" aria-label="Mark done">✓</button>`;
  }
  return Array.from(
    { length: sets },
    (_, i) =>
      `<button class="set${i < item.sets_done ? " on" : ""}${item.extra_side && i === sets - 1 ? " extra" : ""}"
         data-set="${i + 1}" aria-label="Set ${labelFor(i)}">${labelFor(i)}</button>`
  ).join("");
}

function pastNoteEntry(note: PastNote, label?: string): string {
  return `
    <span class="past-note-label">${label ? `${escapeHtml(label)} · ` : ""}${formatDate(note.date)}</span>
    <p class="past-note-text">${escapeHtml(note.text)}</p>`;
}

/**
 * The latest note from an earlier session, shown above where today's goes. When there
 * are more, tapping it lists them all (item = the exercise's id in this session, or
 * omitted for session notes).
 */
function pastNote(label: string, note: LatestNote | null, item?: number): string {
  if (!note) return "";
  if (note.count < 2) return `<div class="past-note">${pastNoteEntry(note, label)}</div>`;
  return `
    <button class="past-note expandable" data-label="${escapeHtml(label)}" ${item === undefined ? "" : `data-item="${item}"`}
      aria-expanded="false">
      <span class="past-note-more">${note.count} notes ▾</span>
      <span class="past-note-body">${pastNoteEntry(note, label)}</span>
    </button>`;
}

function bindPastNotes(session: Session): void {
  app.querySelectorAll<HTMLButtonElement>(".past-note.expandable").forEach((panel) => {
    const latest = panel.querySelector(".past-note-body")!.innerHTML;
    const more = panel.querySelector(".past-note-more")!;
    const count = more.textContent!.split(" ")[0];
    let all: PastNote[] | null = null;
    panel.addEventListener("click", async () => {
      const body = panel.querySelector(".past-note-body")!;
      if (panel.getAttribute("aria-expanded") === "true") {
        panel.setAttribute("aria-expanded", "false");
        body.innerHTML = latest;
        more.textContent = `${count} notes ▾`;
        return;
      }
      if (!all) {
        more.textContent = "Loading…";
        try {
          const query = panel.dataset.item ? `?item=${panel.dataset.item}` : "";
          ({ notes: all } = await api<{ notes: PastNote[] }>(`/sessions/${session.id}/past-notes${query}`));
        } catch {
          more.textContent = `${count} notes ▾`;
          alert("Couldn't load the older notes. Check your connection.");
          return;
        }
      }
      panel.setAttribute("aria-expanded", "true");
      body.innerHTML = all.map((n, i) => `<div class="past-note-entry">${pastNoteEntry(n, i === 0 ? panel.dataset.label : undefined)}</div>`).join("");
      more.textContent = "Show less ▴";
    });
  });
}

/** Long or open-ended times (a dance session, a 10 min warm-up) are entered in minutes */
function inMinutes(item: SessionItem): boolean {
  return item.target_seconds === null || item.target_seconds >= 60;
}

/** A cue that starts with a short label ("Setup:", "Lift-off (hold 2–3s):") gets the label in bold */
function cueHtml(cue: string): string {
  const match = cue.match(/^([^:.;]{1,32}):\s+(.+)$/);
  return match
    ? `<strong>${escapeHtml(match[1])}:</strong> ${escapeHtml(match[2])}`
    : escapeHtml(cue);
}

/**
 * Everything about how to do it, folded away until wanted: the rung's own note
 * (e.g. "Knee on bench"), then the exercise's description and cues
 */
function renderGuide(item: SessionItem): string {
  if (!item.cue && !item.description && !item.cues.length) return "";
  return `
    <details class="guide">
      <summary><span>Cues</span></summary>
      ${item.cue ? `<p class="guide-rung">${escapeHtml(item.cue)}</p>` : ""}
      ${item.description ? `<p class="guide-description">${escapeHtml(item.description)}</p>` : ""}
      ${item.cues.length ? `<ul class="guide-cues">${item.cues.map((c) => `<li>${cueHtml(c)}</li>`).join("")}</ul>` : ""}
    </details>`;
}

/** Which rung this workout uses; rungs are picked on the preview before starting */
function ladderChip(item: SessionItem, ladders: Map<string, Ladder>): string {
  const ladder = item.ladder_id ? ladders.get(item.ladder_id) : undefined;
  if (!ladder || ladder.rungs.length < 2 || item.rung === null) return "";
  return `<span class="rung-chip">Rung ${item.rung}/${ladder.rungs.length}</span>`;
}

function renderItem(item: SessionItem, ladders: Map<string, Ladder>): string {
  const target = sessionTarget(item);
  const state = item.skipped ? "skipped" : isDone(item) ? "done" : "";

  return `
    <article class="exercise sticker ${state}" data-item="${item.id}">
      <div class="exercise-head">
        <div>
          ${item.label ? `<span class="label-tag">${escapeHtml(item.label)}</span>` : ""}
          <h3>${escapeHtml(item.name)}</h3>
          <div class="target-row">
            ${target ? `<p class="target">${target}</p>` : ""}
            <span class="stamp">${stampText(item)}</span>
          </div>
          ${ladderChip(item, ladders)}
        </div>
        <button class="skip">${item.skipped ? "Unskip" : "Skip"}</button>
      </div>
      ${renderGuide(item)}
      <div class="sets">${renderSetButtons(item)}</div>
      <div class="inputs">
        ${
          item.weighted
            ? `<label class="field"><input type="text" inputmode="decimal" id="weight-${item.id}" data-field="weight"
                 value="${item.weight ?? ""}" placeholder="${item.target_weight ?? ""}" /><span>lb</span></label>`
            : ""
        }
        ${
          item.timed
            ? inMinutes(item)
              ? `<label class="field"><input type="text" inputmode="decimal" id="seconds-${item.id}" data-field="seconds"
                   data-minutes="1" value="${item.seconds === null ? "" : +(item.seconds / 60).toFixed(1)}"
                   placeholder="${item.target_seconds === null ? "" : item.target_seconds / 60}" /><span>min</span></label>`
              : `<label class="field"><input type="text" inputmode="numeric" id="seconds-${item.id}" data-field="seconds"
                   value="${item.seconds ?? ""}" placeholder="${item.target_seconds ?? ""}" /><span>sec</span></label>`
            : ""
        }
      </div>
      ${pastNote("Last time", item.last_note, item.id)}
      <textarea id="notes-${item.id}" data-field="notes" rows="1" placeholder="Notes">${escapeHtml(item.notes)}</textarea>
    </article>`;
}

function isWrapped(session: Session): boolean {
  return session.items.length > 0 && session.items.every((i) => isDone(i) || i.skipped);
}

function updateProgress(session: Session): void {
  const done = session.items.filter(isDone).length;
  const skipped = session.items.filter((i) => i.skipped).length;
  const total = session.items.length;
  const bar = document.getElementById("progress-fill");
  const label = document.getElementById("progress-label");
  const banner = document.getElementById("wrap-banner");
  if (bar) bar.style.width = `${total ? ((done + skipped) / total) * 100 : 0}%`;
  if (label) label.textContent = `${done}/${total} done${skipped ? ` · ${skipped} skipped` : ""}`;
  if (banner) banner.hidden = !isWrapped(session) || !!session.finished_at;
}

function renderFinish(session: Session): string {
  return session.finished_at
    ? `${ratingsText(session) ? `<p class="finished-ratings">${ratingsText(session)}</p>` : ""}
       <div class="finished-row"><span class="finished-stamp">Finished!</span>
         <button id="reopen" class="link-button">Reopen</button></div>`
    : `<button id="finish" class="start finish sticker">Finish</button>`;
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

async function renderSession(id: number): Promise<void> {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let session: Session;
  let ladders: Map<string, Ladder>;
  try {
    const [s, l] = await Promise.all([
      api<{ session: Session }>(`/sessions/${id}`),
      api<{ ladders: Ladder[] }>("/ladders"),
    ]);
    session = s.session;
    ladders = new Map(l.ladders.map((ladder) => [ladder.id, ladder]));
  } catch {
    app.innerHTML = `<p class="loading">Couldn't load this workout. <a href="#">Back</a></p>`;
    return;
  }

  app.innerHTML = `
    <header class="session-header">
      <a class="back" href="#" aria-label="Back">‹</a>
      <div class="session-title">
        <h1>${escapeHtml(session.sequence_name)}</h1>
        <p>${formatDate(session.date)} · <span id="progress-label"></span></p>
      </div>
      <span id="save-status" class="save-status"></span>
      <div class="progress"><div id="progress-fill"></div></div>
    </header>
    <div id="wrap-banner" class="wrap-banner sticker" hidden>
      <strong>That's a wrap!</strong>
      Jot down how it went, then hit Finish.
    </div>
    <div class="exercises">${session.items.map((i) => renderItem(i, ladders)).join("")}</div>
    <section class="session-notes">
      <h2>Session notes</h2>
      ${pastNote(`Last ${session.sequence_name}`, session.last_session_note)}
      <textarea id="session-notes" rows="3" placeholder="How it felt, anything else you did">${escapeHtml(session.notes)}</textarea>
    </section>
    <div id="finish-area">${renderFinish(session)}</div>
    <button id="delete-session" class="delete">Delete this workout</button>
  `;
  updateProgress(session);
  bindPastNotes(session);

  const bindFinish = () => {
    // Finish asks for a word to sum the session up, then heads home
    document.getElementById("finish")?.addEventListener("click", () => {
      const chips = pickWords()
        .map((w) => `<button class="chip word-chip" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`)
        .join("");
      openSheet(
        "How'd it go?",
        `${RATINGS.map(
          ({ field, label }) => `
          <div class="rating" data-rating="${field}">
            <span class="rating-label">${label}</span>
            <span class="rating-stars">${[1, 2, 3, 4, 5]
              .map((n) => `<button class="rating-star" data-value="${n}" aria-label="${label} ${n} of 5">★</button>`)
              .join("")}</span>
          </div>`
        ).join("")}
         <p class="sheet-label">Pick a word for this one.</p>
         <div class="chips word-chips">${chips}</div>
         <button class="link-button skip-word">Skip</button>`,
        (sheet, close) => {
          // Optional: tap a star to rate, tap the same star again to clear
          const ratings: Record<RatingField, number | null> = { effort: null, conscientiousness: null };
          sheet.querySelectorAll<HTMLElement>("[data-rating]").forEach((row) => {
            const field = row.dataset.rating as RatingField;
            const stars = row.querySelectorAll<HTMLButtonElement>(".rating-star");
            stars.forEach((star) =>
              star.addEventListener("click", () => {
                const value = Number(star.dataset.value);
                ratings[field] = ratings[field] === value ? null : value;
                stars.forEach((s) => s.classList.toggle("on", Number(s.dataset.value) <= (ratings[field] ?? 0)));
              })
            );
          });
          const finish = async (word: string | null, from: HTMLElement) => {
            sheet.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = true));
            const body: Record<string, unknown> = { finished: true, ...ratings };
            if (word) body.word = word;
            if (await save(`/sessions/${session.id}`, body)) {
              session.finished_at = new Date().toISOString();
              session.word = word;
              Object.assign(session, ratings);
              confetti(from, 60);
              document.getElementById("finish-area")!.innerHTML = renderFinish(session);
              updateProgress(session);
              bindFinish();
              // A beat to see the confetti, then home
              setTimeout(() => {
                close();
                if (location.hash === `#session-${session.id}`) location.hash = "";
              }, 900);
            } else {
              sheet.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = false));
            }
          };
          sheet.querySelectorAll<HTMLButtonElement>("[data-word]").forEach((chip) =>
            chip.addEventListener("click", () => finish(chip.dataset.word!, chip))
          );
          sheet.querySelector<HTMLButtonElement>(".skip-word")!.addEventListener("click", (e) =>
            finish(null, e.currentTarget as HTMLElement)
          );
        }
      );
    });
    document.getElementById("reopen")?.addEventListener("click", async () => {
      if (await save(`/sessions/${session.id}`, { finished: false })) {
        session.finished_at = null;
        document.getElementById("finish-area")!.innerHTML = renderFinish(session);
        updateProgress(session);
        bindFinish();
      }
    });
  };
  bindFinish();

  // For the big confetti burst when the last exercise gets ticked off
  let wrapped = isWrapped(session);

  app.querySelectorAll<HTMLElement>(".exercise").forEach((card) => {
    const item = session.items.find((i) => i.id === Number(card.dataset.item))!;
    const path = `/sessions/${session.id}/items/${item.id}`;

    const refreshCard = () => {
      const wasDone = card.classList.contains("done");
      card.classList.toggle("done", isDone(item));
      card.classList.toggle("skipped", !!item.skipped);
      card.querySelector(".skip")!.textContent = item.skipped ? "Unskip" : "Skip";
      card.querySelector(".stamp")!.textContent = stampText(item);
      card.querySelectorAll<HTMLButtonElement>(".set").forEach((btn) => {
        btn.classList.toggle("on", Number(btn.dataset.set) <= item.sets_done);
      });
      card.querySelectorAll<HTMLInputElement>("[data-set-reps]").forEach((input) => {
        const reps = item.set_reps[Number(input.dataset.setReps) - 1];
        input.closest(".rep-set")!.classList.toggle("on", reps !== null);
      });
      updateProgress(session);
      const nowWrapped = isWrapped(session);
      if (!wrapped && nowWrapped && !session.finished_at) confetti(card, 48);
      else if (!wasDone && isDone(item)) confetti(card);
      wrapped = nowWrapped;
    };

    // Tapping the last finished set undoes it; tapping any other set fills up to it
    card.querySelectorAll<HTMLButtonElement>(".set").forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.set);
        item.sets_done = item.sets_done === n ? n - 1 : n;
        const body: Record<string, unknown> = { sets_done: item.sets_done };
        if (item.skipped) {
          item.skipped = 0;
          body.skipped = false;
        }
        refreshCard();
        save(path, body);
      });
    });

    // To-failure sets: typing the reps reached logs the set, clearing it un-logs it
    card.querySelectorAll<HTMLInputElement>("[data-set-reps]").forEach((input) => {
      const n = Number(input.dataset.setReps);
      input.addEventListener("input", () => {
        const value = parseNumber(input.value);
        const reps = value === null ? null : Math.round(value);
        item.set_reps[n - 1] = reps;
        item.sets_done = item.set_reps.filter((r) => r !== null).length;
        if (item.skipped && reps !== null) {
          item.skipped = 0;
          save(path, { skipped: false });
        }
        refreshCard();
        saveLater(`${item.id}-set-${n}`, `${path}/sets/${n}`, { reps }, "PUT");
      });
    });

    card.querySelector(".skip")!.addEventListener("click", () => {
      item.skipped = item.skipped ? 0 : 1;
      refreshCard();
      save(path, { skipped: !!item.skipped });
    });

    card.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
      const field = input.dataset.field as "weight" | "seconds";
      input.addEventListener("input", () => {
        const entered = parseNumber(input.value);
        // Minutes boxes still store seconds
        const value = entered !== null && input.dataset.minutes ? Math.round(entered * 60) : entered;
        item[field] = value;
        saveLater(`${item.id}-${field}`, path, { [field]: value });
      });
    });

    const notes = card.querySelector<HTMLTextAreaElement>("textarea")!;
    autoGrow(notes);
    notes.addEventListener("input", () => {
      autoGrow(notes);
      item.notes = notes.value;
      saveLater(`${item.id}-notes`, path, { notes: notes.value });
    });
  });

  const sessionNotes = document.getElementById("session-notes") as HTMLTextAreaElement;
  autoGrow(sessionNotes);
  sessionNotes.addEventListener("input", () => {
    autoGrow(sessionNotes);
    saveLater("session-notes", `/sessions/${session.id}`, { notes: sessionNotes.value });
  });

  // Two taps to delete, since confirm() dialogs are awkward in a home screen app
  const deleteBtn = document.getElementById("delete-session") as HTMLButtonElement;
  let armed = false;
  deleteBtn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      deleteBtn.textContent = "Tap again to delete";
      deleteBtn.classList.add("armed");
      setTimeout(() => {
        armed = false;
        deleteBtn.textContent = "Delete this workout";
        deleteBtn.classList.remove("armed");
      }, 3000);
      return;
    }
    await api(`/sessions/${session.id}`, { method: "DELETE" });
    location.hash = "";
  });
}

// --- Routing ---

function route(): void {
  window.scrollTo(0, 0);
  const session = location.hash.match(/^#session-(\d+)$/);
  const preview = location.hash.match(/^#sequence-(.+)$/);
  if (session) renderSession(Number(session[1]));
  else if (preview) renderPreview(decodeURIComponent(preview[1]));
  else renderHome();
}

window.addEventListener("hashchange", route);
route();
