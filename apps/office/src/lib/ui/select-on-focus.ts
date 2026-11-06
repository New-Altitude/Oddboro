// A field that arrives filled in with a suggestion, like the owner's name, has
// it selected when the field takes focus, so typing replaces it instead of
// adding to it. A click that brings the focus would otherwise drop the
// selection on mouseup, so that one mouseup is held back. Later clicks place
// the caret as usual. Use with `{@attach selectOnFocus}`.
export function selectOnFocus(node: HTMLInputElement): () => void {
  let focusedByClick = false;
  const onfocus = () => {
    node.select();
    focusedByClick = true;
  };
  const onmouseup = (e: Event) => {
    if (focusedByClick) e.preventDefault();
    focusedByClick = false;
  };
  const onkeydown = () => (focusedByClick = false);
  node.addEventListener('focus', onfocus);
  node.addEventListener('mouseup', onmouseup);
  node.addEventListener('keydown', onkeydown);
  return () => {
    node.removeEventListener('focus', onfocus);
    node.removeEventListener('mouseup', onmouseup);
    node.removeEventListener('keydown', onkeydown);
  };
}
