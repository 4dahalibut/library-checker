import './style.css';

const API_URL = '/plank/api';

interface User {
  id: number;
  name: string;
  avatar: string | null;
}

interface LeaderboardEntry {
  id: number;
  name: string;
  avatar: string | null;
  best_time: number | null;
}

interface HistoryEntry {
  id: number;
  name: string;
  avatar: string | null;
  seconds: number;
  recorded_at: string;
}

let capturedAvatar: string | null = null;
let cameraStream: MediaStream | null = null;
let modalStream: MediaStream | null = null;
let editingUserId: number | null = null;

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function renderAvatar(name: string, avatar: string | null, size: number = 32, userId?: number): string {
  const clickable = userId ? `avatar-clickable" data-user-id="${userId}` : '';
  if (avatar) {
    return `<img src="${avatar}" class="avatar ${clickable}" style="width:${size}px;height:${size}px;" alt="${name}" />`;
  }
  return `<div class="avatar avatar-initials ${clickable}" style="width:${size}px;height:${size}px;font-size:${size/2.5}px;">${getInitials(name)}</div>`;
}

async function startCamera(): Promise<void> {
  const video = document.getElementById('camera-preview') as HTMLVideoElement;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 256, height: 256 }
    });
    video.srcObject = cameraStream;
  } catch (err) {
    console.error('Camera error:', err);
  }
}

function stopCamera(): void {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

function capturePhoto(): void {
  const video = document.getElementById('camera-preview') as HTMLVideoElement;
  const canvas = document.getElementById('camera-canvas') as HTMLCanvasElement;
  const preview = document.getElementById('avatar-preview') as HTMLImageElement;
  const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
  const retakeBtn = document.getElementById('retake-btn') as HTMLButtonElement;

  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // Draw cropped square from center of video
  const size = Math.min(video.videoWidth, video.videoHeight);
  const x = (video.videoWidth - size) / 2;
  const y = (video.videoHeight - size) / 2;
  ctx.drawImage(video, x, y, size, size, 0, 0, 128, 128);

  capturedAvatar = canvas.toDataURL('image/jpeg', 0.7);
  preview.src = capturedAvatar;

  video.style.display = 'none';
  preview.style.display = 'block';
  captureBtn.style.display = 'none';
  retakeBtn.style.display = 'inline-block';

  stopCamera();
}

function retakePhoto(): void {
  const video = document.getElementById('camera-preview') as HTMLVideoElement;
  const preview = document.getElementById('avatar-preview') as HTMLImageElement;
  const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
  const retakeBtn = document.getElementById('retake-btn') as HTMLButtonElement;

  capturedAvatar = null;
  video.style.display = 'block';
  preview.style.display = 'none';
  captureBtn.style.display = 'inline-block';
  retakeBtn.style.display = 'none';

  startCamera();
}

async function loadUsers(): Promise<void> {
  const select = document.getElementById('user-select') as HTMLSelectElement;
  const newNameInput = document.getElementById('new-name-input') as HTMLInputElement;
  const cameraContainer = document.getElementById('camera-container') as HTMLDivElement;
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
  select.onchange = async () => {
    if (select.value === 'new') {
      newNameInput.style.display = 'block';
      newNameInput.required = true;
      cameraContainer.style.display = 'block';
      select.required = false;
      await startCamera();
    } else {
      newNameInput.style.display = 'none';
      newNameInput.required = false;
      cameraContainer.style.display = 'none';
      select.required = true;
      stopCamera();
      capturedAvatar = null;
    }
  };
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
            <td class="name-cell">${renderAvatar(entry.name, entry.avatar, 32, entry.id)} ${entry.name}</td>
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
          <td class="name-cell">${renderAvatar(entry.name, entry.avatar, 24)} ${entry.name}</td>
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
  const cameraContainer = document.getElementById('camera-container') as HTMLDivElement;
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
        body: JSON.stringify({ name, avatar: capturedAvatar }),
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
    cameraContainer.style.display = 'none';
    userSelect.value = '';
    minutesInput.value = '';
    secondsInput.value = '';
    capturedAvatar = null;
    stopCamera();

    await Promise.all([loadUsers(), loadLeaderboard(), loadHistory()]);
  } catch (err) {
    showMessage('Failed to connect to server', true);
  }
}

// Modal functions
async function openAvatarModal(userId: number): Promise<void> {
  editingUserId = userId;
  const modal = document.getElementById('avatar-modal')!;
  const video = document.getElementById('modal-camera') as HTMLVideoElement;
  const preview = document.getElementById('modal-preview') as HTMLImageElement;
  const captureBtn = document.getElementById('modal-capture') as HTMLButtonElement;
  const retakeBtn = document.getElementById('modal-retake') as HTMLButtonElement;
  const saveBtn = document.getElementById('modal-save') as HTMLButtonElement;

  // Reset state
  video.style.display = 'block';
  preview.style.display = 'none';
  captureBtn.style.display = 'inline-block';
  retakeBtn.style.display = 'none';
  saveBtn.style.display = 'none';
  capturedAvatar = null;

  modal.style.display = 'flex';

  try {
    modalStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 256, height: 256 }
    });
    video.srcObject = modalStream;
  } catch (err) {
    console.error('Camera error:', err);
  }
}

function closeAvatarModal(): void {
  const modal = document.getElementById('avatar-modal')!;
  modal.style.display = 'none';
  if (modalStream) {
    modalStream.getTracks().forEach(track => track.stop());
    modalStream = null;
  }
  editingUserId = null;
  capturedAvatar = null;
}

function modalCapturePhoto(): void {
  const video = document.getElementById('modal-camera') as HTMLVideoElement;
  const canvas = document.getElementById('modal-canvas') as HTMLCanvasElement;
  const preview = document.getElementById('modal-preview') as HTMLImageElement;
  const captureBtn = document.getElementById('modal-capture') as HTMLButtonElement;
  const retakeBtn = document.getElementById('modal-retake') as HTMLButtonElement;
  const saveBtn = document.getElementById('modal-save') as HTMLButtonElement;

  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const size = Math.min(video.videoWidth, video.videoHeight);
  const x = (video.videoWidth - size) / 2;
  const y = (video.videoHeight - size) / 2;
  ctx.drawImage(video, x, y, size, size, 0, 0, 128, 128);

  capturedAvatar = canvas.toDataURL('image/jpeg', 0.7);
  preview.src = capturedAvatar;

  video.style.display = 'none';
  preview.style.display = 'block';
  captureBtn.style.display = 'none';
  retakeBtn.style.display = 'inline-block';
  saveBtn.style.display = 'inline-block';

  if (modalStream) {
    modalStream.getTracks().forEach(track => track.stop());
    modalStream = null;
  }
}

async function modalRetakePhoto(): Promise<void> {
  const video = document.getElementById('modal-camera') as HTMLVideoElement;
  const preview = document.getElementById('modal-preview') as HTMLImageElement;
  const captureBtn = document.getElementById('modal-capture') as HTMLButtonElement;
  const retakeBtn = document.getElementById('modal-retake') as HTMLButtonElement;
  const saveBtn = document.getElementById('modal-save') as HTMLButtonElement;

  capturedAvatar = null;
  video.style.display = 'block';
  preview.style.display = 'none';
  captureBtn.style.display = 'inline-block';
  retakeBtn.style.display = 'none';
  saveBtn.style.display = 'none';

  try {
    modalStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 256, height: 256 }
    });
    video.srcObject = modalStream;
  } catch (err) {
    console.error('Camera error:', err);
  }
}

async function saveAvatar(): Promise<void> {
  if (!editingUserId || !capturedAvatar) return;

  try {
    const response = await fetch(`${API_URL}/users/${editingUserId}/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: capturedAvatar }),
    });

    if (response.ok) {
      showMessage('Photo updated!');
      closeAvatarModal();
      await Promise.all([loadLeaderboard(), loadHistory()]);
    } else {
      showMessage('Failed to update photo', true);
    }
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
  document.getElementById('capture-btn')!.addEventListener('click', capturePhoto);
  document.getElementById('retake-btn')!.addEventListener('click', retakePhoto);

  // Modal event listeners
  document.getElementById('modal-capture')!.addEventListener('click', modalCapturePhoto);
  document.getElementById('modal-retake')!.addEventListener('click', modalRetakePhoto);
  document.getElementById('modal-save')!.addEventListener('click', saveAvatar);
  document.getElementById('modal-cancel')!.addEventListener('click', closeAvatarModal);

  // Click on avatar to edit
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('avatar-clickable')) {
      const userId = parseInt(target.dataset.userId || '0');
      if (userId) openAvatarModal(userId);
    }
  });
});
