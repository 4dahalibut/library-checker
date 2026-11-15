// Workout sequences, edited by hand (or by Claude). Starting a session copies
// its exercises and targets, so changing a sequence here never changes past days.
//
// Example:
//   {
//     id: "upper-a",            // stable; sessions remember it
//     name: "Upper A",
//     items: [
//       { name: "Bench press", sets: 3, reps: 8, weight: 135 },
//       { name: "Plank", sets: 3, seconds: 60, cue: "Squeeze glutes" },
//     ],
//   },

export interface SequenceItem {
  name: string;
  sets?: number;
  reps?: number;
  /** Per set, for timed exercises */
  seconds?: number;
  /** Pounds */
  weight?: number;
  /** Form reminder shown under the name */
  cue?: string;
}

export interface Sequence {
  id: string;
  name: string;
  items: SequenceItem[];
}

export const sequences: Sequence[] = [
  {
    id: "main",
    name: "Main Day",
    items: [
      { name: "Sled Warm Up", sets: 1, seconds: 600 },
      { name: "Tibialis Raise", sets: 2, reps: 25 },
      { name: "Deep Calf Raise", sets: 2, reps: 25 },
      { name: "Reverse Step Up", sets: 2, reps: 25 },
      { name: "Full Range Split Squats", sets: 2, reps: 10 },
      { name: "External Rotation", sets: 1, reps: 15 },
      { name: "Pullover", sets: 2, reps: 15 },
      { name: "Trap 3 Raise", sets: 2, reps: 10 },
      { name: "Back Extensions", sets: 1, seconds: 120, cue: "Lvl 1 - Iso Holds" },
      { name: "Hip Flexor Kick Out", sets: 2, reps: 5 },
      { name: "Side Bend", sets: 2, reps: 12 },
    ],
  },
  {
    id: "mobility",
    name: "Mobility Day",
    items: [
      { name: "Couch Stretch", sets: 2, seconds: 60 },
      { name: "Fire Hydrants", sets: 1, reps: 10 },
      { name: "Hip Abduction", sets: 1, reps: 10 },
      { name: "90/90 Rotation", sets: 1, reps: 10 },
      { name: "Outer Hip Dropset", sets: 1, reps: 1 },
      { name: "Pigeon Strength", sets: 1, reps: 20 },
      { name: "Deep Squats", sets: 2, seconds: 120 },
      { name: "Loaded Butterfly", sets: 2, seconds: 60 },
      { name: "Active Hangs", sets: 1, seconds: 60 },
    ],
  },
];
