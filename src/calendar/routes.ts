import { Router } from "express";
import { getAllEntries, updateEntryNote } from "./db.js";

export const calendarRouter = Router();

calendarRouter.get("/api/entries", (_req, res) => {
  const entries = getAllEntries();
  res.json({ entries });
});

calendarRouter.put("/api/entries/:id", (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  if (typeof note !== "string") {
    res.status(400).json({ error: "note must be a string" });
    return;
  }
  updateEntryNote(id, note);
  res.json({ success: true });
});
