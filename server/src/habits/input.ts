import { z } from 'zod';
import { HABIT_DEFAULTS } from '../core/defaults.ts';
import { describeAmountLimit, maxAmount } from './cadence.ts';

// Postgres `text` has no length, so nothing but the request body cap stood
// between a caller and a megabyte-long habit name. These say how long is long.

const note = z
  .string()
  .max(HABIT_DEFAULTS.maxNoteLength, `A note is at most ${HABIT_DEFAULTS.maxNoteLength} characters.`)
  .nullish();

/** A whole number from 1 to the cap: what a habit asks of one day, or what one day recorded. */
export const amount = z
  .int(describeAmountLimit())
  .min(1, describeAmountLimit())
  .max(maxAmount(), describeAmountLimit());

/** What a caller may write onto a habit. Every key is optional: an update states only what changes. */
export const habitInput = z.object({
  name: z
    .string()
    .max(HABIT_DEFAULTS.maxNameLength, `A habit name is at most ${HABIT_DEFAULTS.maxNameLength} characters.`)
    .optional(),
  notes: note,
  cue: z
    .string()
    .max(HABIT_DEFAULTS.maxCueLength, `A cue is at most ${HABIT_DEFAULTS.maxCueLength} characters.`)
    .nullish(),
  dailyAmount: amount.optional(),
});

/** The note on one day, as `markHabit` takes it. */
export const entryNote = note;
