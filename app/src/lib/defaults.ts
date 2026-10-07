// Every number a maintainer might want to change, in one place. This file
// imports nothing, computes nothing and reads no environment.

export interface TodaySettings {
  /** How often the open app asks the clock whether the day has turned. */
  pollSeconds: number;
}

export const TODAY_DEFAULTS: Readonly<TodaySettings> = Object.freeze({
  pollSeconds: 60,
});

export interface HistorySettings {
  /** How many periods the grid draws. `HabitHistoryFields` asks for the same number. */
  periods: number;
  /**
   * How many days of entries the detail screen holds.
   *
   * Twelve months is the widest window the grid ever draws, and 400 days covers
   * it with room for the part-month at either end. Bounded because a habit kept
   * for years would otherwise send every day of it to draw one screen.
   */
  entryWindowDays: number;
  /** How many weeks of squares a daily habit shows. Four rows of seven reads as a month. */
  dailyWeeks: number;
}

export const HISTORY_DEFAULTS: Readonly<HistorySettings> = Object.freeze({
  periods: 12,
  entryWindowDays: 400,
  dailyWeeks: 4,
});
