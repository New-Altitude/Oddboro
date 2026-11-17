// Whether the owner wants the Projects window to fold its title row and session
// list away while a session's terminal shows (its Focus button). The choice is
// kept on this computer, in the browser's storage, like the page's other
// per-viewer choices.

/** The music player keeps a focus choice of its own, a different feature. */
const KEY = 'oddboro.projects.focus';

/** The owner's last Focus choice here. Off when nothing is kept, or storage is blocked or absent. */
export function focusRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Storage the browser blocks (a private window, a site setting) starts Focus off.
    return false;
  }
}

/** Keeps the owner's Focus choice for the next time the window opens. */
export function rememberFocus(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Storage the browser blocks keeps nothing: the choice holds until the page
    // reloads, then Focus starts off, which loses nothing the owner made.
  }
}
