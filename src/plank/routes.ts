import { Router } from "express";
import { getUsers, addUser, recordTime, getLeaderboard, getHistory } from "./db.js";

export const plankRouter = Router();

// Get all users
plankRouter.get("/api/users", (_req, res) => {
  const users = getUsers();
  res.json(users);
});

// Add new user
plankRouter.post("/api/users", (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const user = addUser(name);
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
