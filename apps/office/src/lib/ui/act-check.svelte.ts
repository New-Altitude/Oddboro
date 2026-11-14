// Whether the owner passed the Act check, and the check while it is open. Each
// owner action that puts an Odd at Act goes through `withActCheck`: the
// Settings tab's level, a level ask's Raise to Act, and a hire at Act. The page
// loads `passed` (`actChecked`), so the check shows before the raise; a
// refusal from the office (409, `ACT_CHECK_NEEDED`) shows it too, in case the
// page was out of date. The office checks the answers and keeps the pass.
import { ACT_CHECK_NEEDED } from '@oddboro/ledger/act-check';

export const actCheck = $state({ passed: false, asking: false });

let settle: ((passed: boolean) => void) | undefined;

/** Open the check, or go straight on when it was passed. True once passed, false on Cancel. */
function checkFirst(): Promise<boolean> {
  if (actCheck.passed) return Promise.resolve(true);
  settle?.(false);
  actCheck.asking = true;
  return new Promise((resolve) => (settle = resolve));
}

/** The check closed: passed, or cancelled with nothing changed. */
export function actCheckClosed(passed: boolean): void {
  if (passed) actCheck.passed = true;
  actCheck.asking = false;
  settle?.(passed);
  settle = undefined;
}

/**
 * Put an Odd at Act with `raise`, after the check when it was never passed.
 * Cancel leaves everything as it was and returns undefined.
 */
export async function withActCheck<T>(raise: () => Promise<T>): Promise<T | undefined> {
  if (!(await checkFirst())) return;
  try {
    return await raise();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ACT_CHECK_NEEDED) throw e;
    actCheck.passed = false;
    if (!(await checkFirst())) return;
    return raise();
  }
}
