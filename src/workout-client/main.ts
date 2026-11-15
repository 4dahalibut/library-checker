import "./style.css";

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
}

interface Session {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  notes: string;
  finished_at: string | null;
  items: SessionItem[];
}

interface WeekItem {
  sequenceId: string;
  name: string;
  optional: boolean;
  session: { id: number; finished: boolean; done: number; total: number } | null;
}

interface WeekDay {
  date: string;
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  changed: boolean;
  items: WeekItem[];
  extras: { id: number; sequenceId: string; sequenceName: string; finished: boolean; done: number; total: number }[];
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

// Saves are fire-and-forget from the UI's point of view; the status pill reports failures
let pendingSaves = 0;

function setSaveStatus(text: string, failed = false): void {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("failed", failed);
}

async function save(path: string, body: Record<string, unknown>, method = "PATCH"): Promise<boolean> {
  pendingSaves++;
  setSaveStatus("Saving…");
  try {
    await api(path, { method, body: JSON.stringify(body) });
    pendingSaves--;
    if (pendingSaves === 0) setSaveStatus("Saved");
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
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
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

let selectedDate = localToday();

function itemStatus(item: { optional?: boolean; session: WeekItem["session"] }, isPast: boolean): string {
  if (item.session?.finished) return `<span class="pill done">Finished ✓</span>`;
  if (item.session) return `<span class="pill started">${item.session.done}/${item.session.total} done</span>`;
  if (isPast) return `<span class="pill missed">Missed</span>`;
  return item.optional ? `<span class="pill">Optional</span>` : "";
}

function dotClass(item: WeekItem, isPast: boolean): string {
  if (item.session?.finished) return "dot done";
  if (item.session) return "dot started";
  if (item.optional) return "dot optional";
  return isPast ? "dot missed" : "dot";
}

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
  if (!week.days.some((d) => d.date === selectedDate)) selectedDate = today;
  const day = week.days.find((d) => d.date === selectedDate)!;

  const strip = week.days
    .map((d) => {
      const dots = d.items.map((i) => `<span class="${dotClass(i, d.isPast)}"></span>`).join("");
      const classes = ["day", d.isToday ? "today" : "", d.date === selectedDate ? "selected" : "", d.isPast ? "past" : ""];
      return `
        <button class="${classes.join(" ")}" data-date="${d.date}" aria-label="${formatDate(d.date)}">
          <span class="day-letter">${WEEKDAY_LETTERS[d.weekday]}</span>
          <span class="day-number">${dayNumber(d.date)}</span>
          <span class="dots">${dots}</span>
        </button>`;
    })
    .join("");

  const progress = week.progress
    .map((p) => {
      const met = p.done >= p.target;
      return `<span class="goal${met ? " met" : ""}">${escapeHtml(p.name)} <b>${p.done}/${p.target}</b></span>`;
    })
    .join("");

  const short = week.progress
    .filter((p) => p.minimum !== null && p.done < p.minimum)
    .map((p) => `${p.minimum! - p.done} more ${escapeHtml(p.name)}`);
  const minimumLine =
    week.minimumMet === null
      ? ""
      : `<p class="minimum${week.minimumMet ? " met" : ""}">Busy-week minimum ${
          week.minimumMet ? "met ✓" : `· ${short.join(", ")}`
        }</p>`;

  // A day's sessions: tap to open (or start, if it's today), ⇄ to move or remove
  const canChange = !day.isPast;
  const dayRows = [
    ...day.items.map((item) => ({ ...item, extra: false })),
    ...day.extras.map((e) => ({
      sequenceId: e.sequenceId,
      name: e.sequenceName,
      optional: false,
      session: { id: e.id, finished: e.finished, done: e.done, total: e.total },
      extra: true,
    })),
  ];
  const rows = dayRows.length
    ? dayRows
        .map((item) => {
          const href = item.session
            ? `#session-${item.session.id}`
            : `#sequence-${encodeURIComponent(item.sequenceId)}`;
          const movable = canChange && !item.extra && !item.session;
          return `
        <div class="plan-row sticker${item.session?.finished ? " finished" : ""}${item.optional ? " optional" : ""}">
          <a class="plan-main" href="${href}">
            <span class="plan-name">${escapeHtml(item.name)}</span>
            ${item.extra ? `<span class="pill">Extra</span>` : itemStatus(item, day.isPast)}
          </a>
          ${movable ? `<button class="plan-move" data-sequence="${escapeHtml(item.sequenceId)}" aria-label="Move or remove">⇄</button>` : ""}
        </div>`;
        })
        .join("")
    : `<p class="empty">${day.isPast ? "Nothing on this day." : "Rest day. Enjoy it."}</p>`;

  const dayActions = canChange
    ? `<div class="day-actions"><button id="add-session" class="link-button">+ Add a session</button></div>`
    : "";
  // Undo works on the whole week, so a session moved between two days can't get lost
  const changedDays = week.days.filter((d) => d.changed);

  const sequenceCards = sequences.length
    ? sequences
        .map((seq) => {
          const started = sessions.find((s) => s.sequence_id === seq.id && s.date === today);
          const meta = started
            ? started.finished_at
              ? "Finished ✓"
              : `${started.done}/${started.total} done`
            : exerciseCount(seq.items.length);
          const href = started ? `#session-${started.id}` : `#sequence-${encodeURIComponent(seq.id)}`;
          return `
        <a class="sequence sticker${started ? " started" : ""}" href="${href}">
          <span class="sequence-name">${escapeHtml(seq.name)}</span>
          <span class="sequence-meta">${meta}</span>
        </a>`;
        })
        .join("")
    : `<p class="empty">No sequences yet. Ask Claude to cook one up.</p>`;

  const history = sessions.length
    ? sessions
        .map((s) => {
          const skipped = s.skipped ? `, ${s.skipped} skipped` : "";
          return `
        <div class="log-row">
          <a class="history-row${s.finished_at ? " complete" : ""}" href="#session-${s.id}">
            <span class="history-date">${formatDate(s.date)}</span>
            <span class="history-name">${escapeHtml(s.sequence_name)}</span>
            <span class="history-count">${s.done}/${s.total}${skipped}</span>
          </a>
          <button class="log-trash" data-delete="${s.id}" aria-label="Delete ${escapeHtml(s.sequence_name)} on ${formatDate(s.date)}">${TRASH_ICON}</button>
        </div>`;
        })
        .join("")
    : `<p class="empty">Nothing yet. Your first workout will land here.</p>`;

  app.innerHTML = `
    <header class="home-header">
      <h1>Workouts</h1>
      <p class="greeting">${greeting()}</p>
    </header>
    <section>
      <h2>This week</h2>
      <div class="week sticker">${strip}</div>
      <div class="goals">${progress}</div>
      ${minimumLine}
      ${changedDays.length ? `<button id="reset-week" class="link-button">Undo this week's changes</button>` : ""}
    </section>
    <section>
      <h2>${day.isToday ? "Today" : formatDate(day.date)}</h2>
      <div class="plan">${rows}</div>
      ${dayActions}
    </section>
    <section>
      <h2>All sessions</h2>
      <div class="sequences">${sequenceCards}</div>
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

  app.querySelectorAll<HTMLButtonElement>(".day").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDate = btn.dataset.date!;
      renderHome();
    });
  });

  const later = week.days.filter((d) => !d.isPast);

  app.querySelectorAll<HTMLButtonElement>(".plan-move").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sequenceId = btn.dataset.sequence!;
      const name = day.items.find((i) => i.sequenceId === sequenceId)!.name;
      const chips = later
        .filter((d) => d.date !== day.date)
        .map(
          (d) =>
            `<button class="chip" data-to="${d.date}">${d.isToday ? "Today" : `${DAYS[(d.weekday + 1) % 7]} ${dayNumber(d.date)}`}</button>`
        )
        .join("");
      openSheet(
        name,
        `<p class="sheet-label">Move to</p>
         <div class="chips">${chips || `<span class="empty">No days left this week.</span>`}</div>
         <button class="remove-session">Remove from ${day.isToday ? "today" : formatDate(day.date)}</button>`,
        (sheet, close) => {
          sheet.querySelectorAll<HTMLButtonElement>("[data-to]").forEach((chip) => {
            chip.addEventListener("click", async () => {
              chip.disabled = true;
              try {
                await api("/days/move", {
                  method: "POST",
                  body: JSON.stringify({ from: day.date, to: chip.dataset.to, sequenceId }),
                });
                close();
                renderHome();
              } catch {
                chip.disabled = false;
                alert("Couldn't move it. Check your connection.");
              }
            });
          });
          sheet.querySelector(".remove-session")!.addEventListener("click", async () => {
            const items: PlanItem[] = day.items.map((i) => ({ sequenceId: i.sequenceId, optional: i.optional }));
            items.splice(
              items.findIndex((i) => i.sequenceId === sequenceId),
              1
            );
            try {
              await api(`/days/${day.date}`, { method: "PUT", body: JSON.stringify({ items }) });
              close();
              renderHome();
            } catch {
              alert("Couldn't remove it. Check your connection.");
            }
          });
        }
      );
    });
  });

  document.getElementById("add-session")?.addEventListener("click", () => {
    const options = sequences
      .map((s) => `<button class="sheet-option" data-add="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`)
      .join("");
    openSheet(`Add to ${day.isToday ? "today" : formatDate(day.date)}`, `<div class="sheet-options">${options}</div>`, (sheet, close) => {
      sheet.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((opt) => {
        opt.addEventListener("click", async () => {
          const items: PlanItem[] = [
            ...day.items.map((i) => ({ sequenceId: i.sequenceId, optional: i.optional })),
            { sequenceId: opt.dataset.add! },
          ];
          try {
            await api(`/days/${day.date}`, { method: "PUT", body: JSON.stringify({ items }) });
            close();
            renderHome();
          } catch {
            alert("Couldn't add it. Check your connection.");
          }
        });
      });
    });
  });

  document.getElementById("reset-week")?.addEventListener("click", async () => {
    try {
      await Promise.all(changedDays.map((d) => api(`/days/${d.date}`, { method: "DELETE" })));
    } catch {
      alert("Couldn't undo everything. Check your connection.");
    }
    renderHome();
  });
}

// --- Sequence preview ---

function rungChip(rung: number, count: number): string {
  return count > 1 ? `<span class="rung-chip">Rung ${rung}/${count}</span>` : "";
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
        ${rungChip(item.rung, item.rungCount)}
        ${item.cue ? `<span class="cue">${escapeHtml(item.cue)}</span>` : ""}
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
               aria-label="Reps in set ${labelFor(i)}" /><span>reps</span></label>`
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

function ladderChip(item: SessionItem, ladders: Map<string, Ladder>): string {
  const ladder = item.ladder_id ? ladders.get(item.ladder_id) : undefined;
  if (!ladder || ladder.rungs.length < 2 || item.rung === null) return "";
  const next = ladder.currentRung !== item.rung ? ` · next: ${ladder.currentRung}` : "";
  return `<button class="rung-chip ladder-open">Rung ${item.rung}/${ladder.rungs.length}${next} ▸</button>`;
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
          ${item.cue ? `<p class="cue">${escapeHtml(item.cue)}</p>` : ""}
        </div>
        <button class="skip">${item.skipped ? "Unskip" : "Skip"}</button>
      </div>
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
            ? `<label class="field"><input type="text" inputmode="numeric" id="seconds-${item.id}" data-field="seconds"
                 value="${item.seconds ?? ""}" placeholder="${item.target_seconds ?? ""}" /><span>sec</span></label>`
            : ""
        }
      </div>
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
    ? `<div class="finished-row"><span class="finished-stamp">Finished!</span>
         <button id="reopen" class="link-button">Reopen</button></div>`
    : `<button id="finish" class="start finish sticker">Finish</button>`;
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function openLadderSheet(item: SessionItem, ladder: Ladder, onChange: () => void): void {
  const rows = ladder.rungs
    .map((r, i) => {
      const n = i + 1;
      const notes = [n === ladder.currentRung ? "current" : "", n === item.rung ? "this workout" : ""]
        .filter(Boolean)
        .join(" · ");
      return `
      <button class="rung-option${n === ladder.currentRung ? " current" : ""}" data-rung="${n}">
        <span class="rung-number">${n}</span>
        <span class="rung-body">
          <span class="rung-name" data-exercise="${escapeHtml(r.exerciseId)}">${escapeHtml(r.exerciseId)}</span>
          <span class="rung-target">${rungTarget(r, { extraSide: ladder.extraSide })}</span>
          ${notes ? `<span class="rung-note">${notes}</span>` : ""}
        </span>
      </button>`;
    })
    .join("");
  openSheet(
    `${ladder.name} ladder`,
    `<p class="sheet-label">Move up when you hit the top of the range two sessions in a row with good
       position. Changes apply from your next session.</p>
     <div class="rungs">${rows}</div>`,
    (sheet, close) => {
      // Fill in exercise names
      api<{ exercises: Exercise[] }>("/exercises")
        .then(({ exercises }) => {
          sheet.querySelectorAll<HTMLElement>("[data-exercise]").forEach((el) => {
            el.textContent = exercises.find((e) => e.id === el.dataset.exercise)?.name ?? el.textContent;
          });
        })
        .catch(() => {});
      sheet.querySelectorAll<HTMLButtonElement>("[data-rung]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const rung = Number(btn.dataset.rung);
          if (rung === ladder.currentRung) return close();
          btn.disabled = true;
          if (await save(`/ladders/${ladder.id}/rung`, { rung }, "PUT")) {
            ladder.currentRung = rung;
            close();
            onChange();
          } else {
            btn.disabled = false;
          }
        });
      });
    }
  );
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
      <textarea id="session-notes" rows="3" placeholder="How it felt, anything else you did">${escapeHtml(session.notes)}</textarea>
    </section>
    <div id="finish-area">${renderFinish(session)}</div>
    <button id="delete-session" class="delete">Delete this workout</button>
  `;
  updateProgress(session);

  const bindFinish = () => {
    document.getElementById("finish")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      if (await save(`/sessions/${session.id}`, { finished: true })) {
        session.finished_at = new Date().toISOString();
        confetti(btn, 60);
        document.getElementById("finish-area")!.innerHTML = renderFinish(session);
        updateProgress(session);
        bindFinish();
      } else {
        btn.disabled = false;
      }
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

    // The chip opens the ladder; picking a rung updates the chip's "next" note
    card.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".ladder-open")) return;
      const ladder = ladders.get(item.ladder_id!)!;
      openLadderSheet(item, ladder, () => {
        card.querySelector(".ladder-open")!.outerHTML = ladderChip(item, ladders);
      });
    });

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
        const value = parseNumber(input.value);
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
