import type { Exercise, Sequence } from "./types.js";

// Frozen: this is the data migration 1 put into workout.db. Sequences and exercises
// are edited through the API now (see routes.ts), so changing this file does nothing
// for an existing database.

export const seedExercises: Exercise[] = [
  { id: "sled-warm-up", name: "Sled Warm Up", weighted: true, timed: false, toFailure: false },
  { id: "tibialis-raise", name: "Tibialis Raise", weighted: false, timed: false, toFailure: false },
  { id: "deep-calf-raise", name: "Deep Calf Raise", weighted: true, timed: false, toFailure: false },
  { id: "reverse-step-up", name: "Reverse Step Up", weighted: true, timed: false, toFailure: false },
  { id: "full-range-split-squats", name: "Full Range Split Squats", weighted: true, timed: false, toFailure: false },
  { id: "external-rotation", name: "External Rotation", weighted: true, timed: false, toFailure: false },
  { id: "pullover", name: "Pullover", weighted: true, timed: false, toFailure: false },
  { id: "trap-3-raise", name: "Trap 3 Raise", weighted: true, timed: false, toFailure: false },
  { id: "back-extensions", name: "Back Extensions", weighted: false, timed: false, toFailure: true },
  { id: "hip-flexor-kick-out", name: "Hip Flexor Kick Out", weighted: false, timed: false, toFailure: false },
  { id: "side-bend", name: "Side Bend", weighted: true, timed: false, toFailure: false },
  { id: "couch-stretch", name: "Couch Stretch", weighted: false, timed: false, toFailure: false },
  { id: "fire-hydrants", name: "Fire Hydrants", weighted: false, timed: false, toFailure: false },
  { id: "hip-abduction", name: "Hip Abduction", weighted: false, timed: false, toFailure: false },
  { id: "90-90-rotation", name: "90/90 Rotation", weighted: false, timed: false, toFailure: false },
  { id: "outer-hip-dropset", name: "Outer Hip Dropset", weighted: false, timed: false, toFailure: false },
  { id: "pigeon-strength", name: "Pigeon Strength", weighted: false, timed: false, toFailure: false },
  { id: "deep-squats", name: "Deep Squats", weighted: false, timed: false, toFailure: false },
  { id: "loaded-butterfly", name: "Loaded Butterfly", weighted: true, timed: false, toFailure: false },
  { id: "active-hangs", name: "Active Hangs", weighted: false, timed: false, toFailure: false },
];

export const seedSequences: Sequence[] = [
  {
    id: "main",
    name: "Main Day",
    items: [
      { exerciseId: "sled-warm-up", sets: 1, seconds: 600 },
      { exerciseId: "tibialis-raise", sets: 2, reps: 25 },
      { exerciseId: "deep-calf-raise", sets: 2, reps: 25 },
      { exerciseId: "reverse-step-up", sets: 2, reps: 25 },
      { exerciseId: "full-range-split-squats", sets: 2, reps: 10 },
      { exerciseId: "external-rotation", sets: 1, reps: 15 },
      { exerciseId: "pullover", sets: 2, reps: 15 },
      { exerciseId: "trap-3-raise", sets: 2, reps: 10 },
      { exerciseId: "back-extensions", sets: 2 },
      { exerciseId: "hip-flexor-kick-out", sets: 2, reps: 5 },
      { exerciseId: "side-bend", sets: 2, reps: 12 },
    ],
  },
  {
    id: "mobility",
    name: "Mobility Day",
    items: [
      { exerciseId: "couch-stretch", sets: 2, seconds: 60 },
      { exerciseId: "fire-hydrants", sets: 1, reps: 10 },
      { exerciseId: "hip-abduction", sets: 1, reps: 10 },
      { exerciseId: "90-90-rotation", sets: 1, reps: 10 },
      { exerciseId: "outer-hip-dropset", sets: 1, reps: 1 },
      { exerciseId: "pigeon-strength", sets: 1, reps: 20 },
      { exerciseId: "deep-squats", sets: 2, seconds: 120 },
      { exerciseId: "loaded-butterfly", sets: 2, seconds: 60 },
      { exerciseId: "active-hangs", sets: 1, seconds: 60 },
    ],
  },
];
