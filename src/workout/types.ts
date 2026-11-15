export interface Exercise {
  id: string;
  name: string;
  /** Shows a lb box */
  weighted: boolean;
  /** Shows a seconds box */
  timed: boolean;
  /** Each set logs the reps reached instead of a checkbox */
  toFailure: boolean;
}

/** One exercise's slot in a sequence. Targets are shown as text, e.g. "2 × 25". */
export interface SequenceItem {
  exerciseId: string;
  sets?: number;
  reps?: number;
  /** Per set, e.g. a 60s hold */
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

/** A sequence item joined with its exercise, as the API returns it */
export interface ResolvedSequenceItem extends SequenceItem {
  name: string;
  weighted: boolean;
  timed: boolean;
  toFailure: boolean;
}

export interface ResolvedSequence {
  id: string;
  name: string;
  items: ResolvedSequenceItem[];
}
