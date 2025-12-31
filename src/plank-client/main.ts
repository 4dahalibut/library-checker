import './style.css';

const API_URL = '/plank/api';

interface User {
  id: number;
  name: string;
}

interface LeaderboardEntry {
  name: string;
  best_time: number | null;
}

interface HistoryEntry {
  id: number;
  name: string;
  seconds: number;
  recorded_at: string;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadUsers(): Promise<void> {
  const select = document.getElementById('user-select') as HTMLSelectElement;
  const newNameInput = document.getElementById('new-name-input') as HTMLInputElement;
  const users: User[] = await fetch(`${API_URL}/users`).then(r => r.json());

  // Clear existing options except the first one
  select.innerHTML = '<option value="">Select your name...</option>';

  users.forEach(user => {
    const option = document.createElement('option');
    option.value = user.id.toString();
    option.textContent = user.name;
    select.appendChild(option);
  });

  // Add "new person" option
  const newOption = document.createElement('option');
  newOption.value = 'new';
  newOption.textContent = '+ Add new person';
  select.appendChild(newOption);

  // Toggle input visibility
  select.addEventListener('change', () => {
    if (select.value === 'new') {
      newNameInput.style.display = 'block';
      newNameInput.required = true;
      select.required = false;
    } else {
      newNameInput.style.display = 'none';
      newNameInput.required = false;
      select.required = true;
    }
  });
}

async function loadLeaderboard(): Promise<void> {
  const container = document.getElementById('leaderboard')!;
  const entries: LeaderboardEntry[] = await fetch(`${API_URL}/leaderboard`).then(r => r.json());

  if (entries.length === 0 || entries.every(e => e.best_time === null)) {
    container.innerHTML = '<p class="empty">No times recorded yet. Be the first!</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Rank</th>
        <th>Name</th>
        <th>Best Time</th>
      </tr>
    </thead>
    <tbody>
      ${entries
        .filter(e => e.best_time !== null)
        .map((entry, i) => `
          <tr class="${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">
            <td>${i + 1}</td>
            <td>${entry.name}</td>
            <td>${formatTime(entry.best_time!)}</td>
          </tr>
        `).join('')}
    </tbody>
  `;
  container.innerHTML = '';
  container.appendChild(table);
}

async function loadHistory(): Promise<void> {
  const container = document.getElementById('history')!;
  const entries: HistoryEntry[] = await fetch(`${API_URL}/history`).then(r => r.json());

  if (entries.length === 0) {
    container.innerHTML = '<p class="empty">No history yet.</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Time</th>
        <th>Recorded</th>
      </tr>
    </thead>
    <tbody>
      ${entries.map(entry => `
        <tr>
          <td>${entry.name}</td>
          <td>${formatTime(entry.seconds)}</td>
          <td>${formatDate(entry.recorded_at)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  container.innerHTML = '';
  container.appendChild(table);
}

function showMessage(text: string, isError: boolean = false): void {
  const messageDiv = document.getElementById('message')!;
  messageDiv.textContent = text;
  messageDiv.className = isError ? 'error' : 'success';
  setTimeout(() => {
    messageDiv.textContent = '';
    messageDiv.className = '';
  }, 3000);
}

async function handleSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const userSelect = document.getElementById('user-select') as HTMLSelectElement;
  const newNameInput = document.getElementById('new-name-input') as HTMLInputElement;
  const minutesInput = document.getElementById('minutes-input') as HTMLInputElement;
  const secondsInput = document.getElementById('seconds-input') as HTMLInputElement;

  let userId: number;

  // Handle new user creation
  if (userSelect.value === 'new') {
    const name = newNameInput.value.trim();
    if (!name) {
      showMessage('Please enter a name', true);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const error = await response.json();
        showMessage(error.error || 'Failed to add user', true);
        return;
      }

      const newUser = await response.json();
      userId = newUser.id;
    } catch (err) {
      showMessage('Failed to connect to server', true);
      return;
    }
  } else {
    userId = parseInt(userSelect.value);
  }

  const minutes = parseInt(minutesInput.value) || 0;
  const seconds = parseInt(secondsInput.value) || 0;
  const totalSeconds = minutes * 60 + seconds;

  if (totalSeconds === 0) {
    showMessage('Please enter a valid time', true);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/times`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, seconds: totalSeconds }),
    });

    if (!response.ok) {
      const error = await response.json();
      showMessage(error.error || 'Failed to record time', true);
      return;
    }

    showMessage(`Recorded ${formatTime(totalSeconds)}!`);
    newNameInput.value = '';
    newNameInput.style.display = 'none';
    userSelect.value = '';
    minutesInput.value = '';
    secondsInput.value = '';

    await Promise.all([loadUsers(), loadLeaderboard(), loadHistory()]);
  } catch (err) {
    showMessage('Failed to connect to server', true);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadUsers();
  loadLeaderboard();
  loadHistory();

  document.getElementById('record-form')!.addEventListener('submit', handleSubmit);
});
