// The loading window's words. The shell sets `window.oddboroUpdating` to the
// version it is installing, or to an empty string while the office opens,
// and calls `oddboroShow` again when that changes.
window.oddboroShow = () => {
  if (window.oddboroPairing) {
    document.getElementById('title').textContent = 'Pair with your office';
    document.getElementById('detail').textContent =
      'Enter the code you saved when this office started.';
    document.getElementById('pair').hidden = false;
    document.getElementById('code').focus();
    return;
  }
  const version = window.oddboroUpdating;
  document.getElementById('title').textContent = version
    ? `Updating Oddboro to ${version}`
    : 'Opening the office';
  document.getElementById('detail').textContent = version
    ? 'Oddboro opens again in a moment.'
    : 'The first start can take a minute.';
};
window.oddboroShow();

document.getElementById('pair').addEventListener('submit', async (event) => {
  event.preventDefault();
  const field = document.getElementById('code');
  const credential = field.value.trim();
  field.value = '';
  try {
    await window.__TAURI_INTERNALS__.invoke('unlock_office', { credential });
  } catch {
    document.getElementById('detail').textContent = 'Check the code and try again.';
    field.focus();
  }
});
