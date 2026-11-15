import "./style.css";

const API_URL = "/workout/api";

interface SequenceItem {
  name: string;
  sets?: number;
  reps?: number;
  seconds?: number;
  weight?: number;
  cue?: string;
}

interface Sequence {
  id: string;
  name: string;
  items: SequenceItem[];
}

interface SessionSummary {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  total: number;
  done: number;
  skipped: number;
}

interface SessionItem {
  id: number;
  name: string;
  cue: string;
  target_sets: number | null;
  target_reps: number | null;
  target_seconds: number | null;
  target_weight: number | null;
  sets_done: number;
  skipped: number;
  weight: number | null;
  seconds: number | null;
  notes: string;
}

interface Session {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  notes: string;
  items: SessionItem[];
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

async function save(path: string, body: Record<string, unknown>): Promise<void> {
  pendingSaves++;
  setSaveStatus("Saving…");
  try {
    await api(path, { method: "PATCH", body: JSON.stringify(body) });
    pendingSaves--;
    if (pendingSaves === 0) setSaveStatus("Saved");
  } catch {
    pendingSaves--;
    setSaveStatus("Not saved — check signal", true);
  }
}

const debounceTimers = new Map<string, number>();

function saveLater(key: string, path: string, body: Record<string, unknown>): void {
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(
    key,
    window.setTimeout(() => {
      debounceTimers.delete(key);
      save(path, body);
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

function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}:${String(s).padStart(2, "0")}` : `${m} min`;
}

function targetText(t: {
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  weight: number | null;
}): string {
  const parts: string[] = [];
  const each = t.reps ? `${t.reps}` : t.seconds ? formatSeconds(t.seconds) : "";
  if (t.sets && each) parts.push(`${t.sets} × ${each}`);
  else if (t.sets) parts.push(`${t.sets} sets`);
  else if (each) parts.push(t.reps ? `${each} reps` : each);
  if (t.weight) parts.push(`${t.weight} lb`);
  return parts.join(" @ ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function parseNumber(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isDone(item: SessionItem): boolean {
  return !item.skipped && item.sets_done >= Math.max(item.target_sets ?? 1, 1);
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

// --- Home ---

let selectedDate = localToday();

async function renderHome(): Promise<void> {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let sequences: Sequence[];
  let sessions: SessionSummary[];
  try {
    [{ sequences }, { sessions }] = await Promise.all([
      api<{ sequences: Sequence[] }>("/sequences"),
      api<{ sessions: SessionSummary[] }>("/sessions"),
    ]);
  } catch {
    app.innerHTML = `<p class="loading">Couldn't load workouts. Check your connection and reopen.</p>`;
    return;
  }

  // A day can hold several sequences (a morning routine and a full workout, say)
  const sequenceCards = sequences.length
    ? sequences
        .map((seq) => {
          const started = sessions.find((s) => s.sequence_id === seq.id && s.date === selectedDate);
          const meta = started
            ? `${started.done}/${started.total} done`
            : `${seq.items.length} exercises`;
          return `
        <button class="sequence sticker${started ? " started" : ""}" data-sequence="${escapeHtml(seq.id)}">
          <span class="sequence-name">${escapeHtml(seq.name)}</span>
          <span class="sequence-meta">${meta}</span>
          <span class="sequence-items">${seq.items.map((i) => escapeHtml(i.name)).join(" · ")}</span>
        </button>`;
        })
        .join("")
    : `<p class="empty">No sequences yet. Ask Claude to cook one up.</p>`;

  const history = sessions.length
    ? sessions
        .map((s) => {
          const skipped = s.skipped ? `, ${s.skipped} skipped` : "";
          const complete = s.total > 0 && s.done + s.skipped >= s.total;
          return `
        <a class="history-row${complete ? " complete" : ""}" href="#session-${s.id}">
          <span class="history-date">${formatDate(s.date)}</span>
          <span class="history-name">${escapeHtml(s.sequence_name)}</span>
          <span class="history-count">${s.done}/${s.total}${skipped}</span>
        </a>`;
        })
        .join("")
    : `<p class="empty">Nothing yet. Your first workout will land here.</p>`;

  app.innerHTML = `
    <header class="home-header">
      <div>
        <h1>Workouts</h1>
        <p class="greeting">${greeting()}</p>
      </div>
      <label class="date-picker">
        <span>Day</span>
        <input type="date" id="session-date" value="${selectedDate}" />
      </label>
    </header>
    <section>
      <h2>Pick your adventure</h2>
      <div class="sequences">${sequenceCards}</div>
    </section>
    <section>
      <h2>Recent</h2>
      ${sessions.length ? `<div class="history sticker">${history}</div>` : history}
    </section>
  `;

  const dateInput = document.getElementById("session-date") as HTMLInputElement;
  dateInput.addEventListener("change", () => {
    if (dateInput.value) {
      selectedDate = dateInput.value;
      renderHome();
    }
  });

  app.querySelectorAll<HTMLButtonElement>("[data-sequence]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const { session } = await api<{ session: Session }>("/sessions", {
          method: "POST",
          body: JSON.stringify({ sequenceId: btn.dataset.sequence, date: selectedDate }),
        });
        location.hash = `session-${session.id}`;
      } catch {
        btn.disabled = false;
        alert("Couldn't start that workout. Check your connection.");
      }
    });
  });
}

// --- Session ---

function renderSetButtons(item: SessionItem): string {
  const sets = Math.max(item.target_sets ?? 1, 1);
  if (sets === 1 && !item.target_sets) {
    return `<button class="set single${item.sets_done ? " on" : ""}" data-set="1" aria-label="Mark done">✓</button>`;
  }
  return Array.from(
    { length: sets },
    (_, i) =>
      `<button class="set${i < item.sets_done ? " on" : ""}" data-set="${i + 1}" aria-label="Set ${i + 1}">${i + 1}</button>`
  ).join("");
}

function renderItem(item: SessionItem): string {
  const target = targetText({
    sets: item.target_sets,
    reps: item.target_reps,
    seconds: item.target_seconds,
    weight: item.target_weight,
  });
  const timed = item.target_seconds !== null;
  const weighted = item.target_weight !== null || !timed;
  const state = item.skipped ? "skipped" : isDone(item) ? "done" : "";

  return `
    <article class="exercise sticker ${state}" data-item="${item.id}">
      <div class="exercise-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <div class="target-row">
            ${target ? `<p class="target">${target}</p>` : ""}
            <span class="stamp">${stampText(item)}</span>
          </div>
          ${item.cue ? `<p class="cue">${escapeHtml(item.cue)}</p>` : ""}
        </div>
        <button class="skip">${item.skipped ? "Unskip" : "Skip"}</button>
      </div>
      <div class="sets">${renderSetButtons(item)}</div>
      <div class="inputs">
        ${
          weighted
            ? `<label class="field"><input type="text" inputmode="decimal" id="weight-${item.id}" data-field="weight"
                 value="${item.weight ?? ""}" placeholder="${item.target_weight ?? ""}" /><span>lb</span></label>`
            : ""
        }
        ${
          timed
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
  if (banner) banner.hidden = !isWrapped(session);
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

async function renderSession(id: number): Promise<void> {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let session: Session;
  try {
    ({ session } = await api<{ session: Session }>(`/sessions/${id}`));
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
      Jot down how it went below.
    </div>
    <div class="exercises">${session.items.map(renderItem).join("")}</div>
    <section class="session-notes">
      <h2>Session notes</h2>
      <textarea id="session-notes" rows="3" placeholder="How it felt, anything else you did">${escapeHtml(session.notes)}</textarea>
    </section>
    <button id="delete-session" class="delete">Delete this workout</button>
  `;
  updateProgress(session);

  app.querySelectorAll<HTMLElement>(".exercise").forEach((card) => {
    const item = session.items.find((i) => i.id === Number(card.dataset.item))!;
    const path = `/sessions/${session.id}/items/${item.id}`;

    const refreshCard = () => {
      const wasDone = card.classList.contains("done");
      const banner = document.getElementById("wrap-banner")!;
      const wasWrapped = !banner.hidden;
      card.classList.toggle("done", isDone(item));
      card.classList.toggle("skipped", !!item.skipped);
      card.querySelector(".skip")!.textContent = item.skipped ? "Unskip" : "Skip";
      card.querySelector(".stamp")!.textContent = stampText(item);
      card.querySelectorAll<HTMLButtonElement>(".set").forEach((btn) => {
        btn.classList.toggle("on", Number(btn.dataset.set) <= item.sets_done);
      });
      updateProgress(session);
      if (!wasWrapped && !banner.hidden) confetti(card, 48);
      else if (!wasDone && isDone(item)) confetti(card);
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
  const match = location.hash.match(/^#session-(\d+)$/);
  if (match) renderSession(Number(match[1]));
  else renderHome();
}

window.addEventListener("hashchange", route);
route();
