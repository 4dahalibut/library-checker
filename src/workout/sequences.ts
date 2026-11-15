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

export const sequences: Sequence[] = [];
