export type Unit = "reps" | "breaths" | "steps" | "m";
export type Side = "left" | "right";

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

/** One step of a ladder: an exercise with its targets, e.g. "3 × 8–12" */
export interface Rung {
  exerciseId: string;
  sets?: number;
  /** Reps, breaths, steps or metres per set, depending on unit */
  reps?: number;
  /** Top of a range like 8–12 */
  repsMax?: number;
  /** Per set, e.g. a 20–30s hold */
  seconds?: number;
  secondsMax?: number;
  unit?: Unit;
  /** Targets are per side */
  perSide?: boolean;
  /** Pounds */
  weight?: number;
  /** Form reminder shown under the name */
  cue?: string;
}

/** An exercise progression. A plain exercise is a ladder with one rung. */
export interface Ladder {
  id: string;
  name: string;
  /** Bias: one extra set on this side */
  extraSide?: Side;
  rungs: Rung[];
}

export interface LadderState extends Ladder {
  /** 1-based */
  currentRung: number;
}

/** One slot in a sequence, e.g. "A1: hip extension ladder" */
export interface SequenceItem {
  ladderId: string;
  /** Superset label like "A1", or "Finisher" */
  label?: string;
}

export interface Sequence {
  id: string;
  name: string;
  items: SequenceItem[];
}

/** A sequence slot resolved to its ladder's current rung, as the API returns it */
export interface ResolvedSequenceItem extends Rung {
  ladderId: string;
  ladderName: string;
  label?: string;
  rung: number;
  rungCount: number;
  extraSide?: Side;
  name: string;
  weighted: boolean;
  timed: boolean;
  toFailure: boolean;
}

export interface ResolvedSequence {
  id: string;
  name: string;
  /** Seconds of rest after a set (0 = no rest timer) */
  restSeconds: number;
  /** Usual minutes from Start to Finish, from recent sessions; null until there are some */
  typicalMinutes: number | null;
  items: ResolvedSequenceItem[];
}

/** A planned session on a weekday or date */
export interface PlanItem {
  sequenceId: string;
  optional?: boolean;
}
