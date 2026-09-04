/*!
 * What this build is, and what shape its saves are in.
 *
 * VERSION is the game's own version, shown on the start screen and written
 * into every save so a save can say which build made it. It is checked
 * against package.json by a test, so the two cannot drift.
 *
 * SAVE_VERSION is the *manifest* version: the shape of a saved run. Bump it
 * whenever the saved shape changes in a way an older reader would get wrong.
 * A save from a newer manifest version is refused rather than guessed at; a
 * save from an older one is migrated if there is a path, and refused if not.
 *
 * Pure module. No DOM, no clock, no randomness.
 */

export const VERSION = "1.1.0";

/** The saved-run manifest version. See save.js for what each version means. */
export const SAVE_VERSION = 1;

/** What a save must call itself to be one of ours. */
export const SAVE_GAME_ID = "buster-whack";
