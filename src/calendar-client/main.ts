import "./style.css";

const API_URL = "/calendar/api";

interface CalendarEntry {
  id: string;
  type: "week" | "weekend";
  start_date: string;
  end_date: string;
  note: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${MONTHS[parseInt(m) - 1]} ${parseInt(d)}`;
}

function formatRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

async function loadEntries(): Promise<CalendarEntry[]> {
  const res = await fetch(`${API_URL}/entries`);
  const data = await res.json();
  return data.entries;
}

async function saveNote(id: string, note: string): Promise<void> {
  await fetch(`${API_URL}/entries/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

function render(entries: CalendarEntry[]): void {
  const app = document.getElementById("app")!;

  const header = document.createElement("h1");
  header.textContent = "2026 Year Calendar";
  app.appendChild(header);

  let currentMonth = -1;

  for (const entry of entries) {
    const startMonth = parseInt(entry.start_date.split("-")[1]) - 1;

    // Insert month divider when month changes
    if (startMonth !== currentMonth) {
      currentMonth = startMonth;
      const divider = document.createElement("div");
      divider.className = "month-divider";
      divider.textContent = MONTHS[currentMonth];
      app.appendChild(divider);
    }

    const block = document.createElement("div");
    block.className = `entry ${entry.type}`;

    const label = document.createElement("div");
    label.className = "entry-label";

    const typeTag = document.createElement("span");
    typeTag.className = `type-tag ${entry.type}`;
    typeTag.textContent = entry.type === "week" ? "Week" : "Weekend";

    const dateRange = document.createElement("span");
    dateRange.className = "date-range";
    dateRange.textContent = formatRange(entry.start_date, entry.end_date);

    label.appendChild(typeTag);
    label.appendChild(dateRange);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "note-input";
    input.value = entry.note;
    input.placeholder = entry.type === "week" ? "Week plans..." : "Weekend plans...";

    let lastSaved = entry.note;
    input.addEventListener("blur", () => {
      if (input.value !== lastSaved) {
        lastSaved = input.value;
        saveNote(entry.id, input.value);
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        input.blur();
      }
    });

    block.appendChild(label);
    block.appendChild(input);
    app.appendChild(block);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const entries = await loadEntries();
  render(entries);
});
