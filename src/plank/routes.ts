import { Router } from "express";
import { getUsers, addUser, recordTime, getLeaderboard, getHistory, updateUserName, updateUserAvatar, deleteUser } from "./db.js";

export const plankRouter = Router();

// Get all users
plankRouter.get("/api/users", (_req, res) => {
  const users = getUsers();
  res.json(users);
});

// Add new user
plankRouter.post("/api/users", (req, res) => {
  const { name, avatar } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const user = addUser(name, avatar);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: "Name already exists" });
  }
});

// Record time
plankRouter.post("/api/times", (req, res) => {
  const { userId, seconds } = req.body;

  if (!userId || !seconds) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const result = recordTime(userId, seconds);
  res.json({ success: true, id: result.id });
});

// Get leaderboard
plankRouter.get("/api/leaderboard", (_req, res) => {
  const leaderboard = getLeaderboard();
  res.json(leaderboard);
});

// Get history
plankRouter.get("/api/history", (_req, res) => {
  const history = getHistory();
  res.json(history);
});

// Update user name
plankRouter.put("/api/users/:id", (req, res) => {
  const userId = parseInt(req.params.id);
  const { name } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    updateUserName(userId, name);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "Failed to update name" });
  }
});

// Update user avatar
plankRouter.put("/api/users/:id/avatar", (req, res) => {
  const userId = parseInt(req.params.id);
  const { avatar } = req.body;

  updateUserAvatar(userId, avatar || null);
  res.json({ success: true });
});

// Delete user and their times
plankRouter.delete("/api/users/:id", (req, res) => {
  const userId = parseInt(req.params.id);
  deleteUser(userId);
  res.json({ success: true });
});
