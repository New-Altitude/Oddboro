// The strip can request a HUD view by name or one concrete decision by its stable ID.
export function reviewTarget(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:hud|cpu|memory|(?:ask|proposal|uncertain|question|claude|codex)-[a-zA-Z0-9_.:-]{1,180})$/.test(
      value
    )
  );
}
export const reviewUrl = (target: string) =>
  '/workspace?from=strip&review=' + encodeURIComponent(target);
export const RETURN_TO_STRIP = 'oddboro:return-to-strip';
export function leaveStripReview(target: string) {
  if (window.parent !== window) window.parent.postMessage(RETURN_TO_STRIP, location.origin);
  else window.location.replace('/strip#review-' + encodeURIComponent(target));
}
