import Database from "better-sqlite3";

const dbPath = process.env.PLANK_DATABASE_PATH || "data/plank.db";
export const plankDb = new Database(dbPath);

// Create tables
plankDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    avatar TEXT
  );

  CREATE TABLE IF NOT EXISTS times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Add avatar column if it doesn't exist (migration for existing db)
try {
  plankDb.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
} catch (e) {
  // Column already exists
}

// Seed initial users if they don't exist
const seedUsers = ["Josh Z", "Rachel", "Stu", "Manny"];
const insertUser = plankDb.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)");
for (const name of seedUsers) {
  insertUser.run(name);
}

// Seed initial times if table is empty
const timeCount = plankDb.prepare("SELECT COUNT(*) as count FROM times").get() as { count: number };
if (timeCount.count === 0) {
  const getUser = plankDb.prepare("SELECT id FROM users WHERE name = ?");
  const insertTime = plankDb.prepare("INSERT INTO times (user_id, seconds) VALUES (?, ?)");

  const initialTimes = [
    { name: "Josh Z", seconds: 240 },    // 4:00
    { name: "Rachel", seconds: 195 },    // 3:15
    { name: "Stu", seconds: 285 },       // 4:45
    { name: "Manny", seconds: 249 },     // 4:09
  ];

  for (const { name, seconds } of initialTimes) {
    const user = getUser.get(name) as { id: number } | undefined;
    if (user) {
      insertTime.run(user.id, seconds);
    }
  }
}

export function getUsers() {
  return plankDb.prepare("SELECT id, name, avatar FROM users ORDER BY name").all();
}

export function addUser(name: string, avatar?: string) {
  const result = plankDb.prepare("INSERT INTO users (name, avatar) VALUES (?, ?)").run(name.trim(), avatar || null);
  return { id: result.lastInsertRowid, name: name.trim(), avatar: avatar || null };
}

export function recordTime(userId: number, seconds: number) {
  const result = plankDb.prepare("INSERT INTO times (user_id, seconds) VALUES (?, ?)").run(userId, seconds);
  return { id: result.lastInsertRowid };
}

export function getLeaderboard() {
  return plankDb.prepare(`
    SELECT u.id, u.name, u.avatar, MAX(t.seconds) as best_time
    FROM users u
    LEFT JOIN times t ON u.id = t.user_id
    GROUP BY u.id
    ORDER BY best_time DESC NULLS LAST
  `).all();
}

export function getHistory() {
  return plankDb.prepare(`
    SELECT t.id, u.name, u.avatar, t.seconds, t.recorded_at
    FROM times t
    JOIN users u ON t.user_id = u.id
    ORDER BY t.recorded_at DESC
  `).all();
}

export function updateUserName(userId: number, name: string) {
  plankDb.prepare("UPDATE users SET name = ? WHERE id = ?").run(name.trim(), userId);
}

export function updateUserAvatar(userId: number, avatar: string | null) {
  plankDb.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, userId);
}

export function deleteUser(userId: number) {
  plankDb.prepare("DELETE FROM times WHERE user_id = ?").run(userId);
  plankDb.prepare("DELETE FROM users WHERE id = ?").run(userId);
}
