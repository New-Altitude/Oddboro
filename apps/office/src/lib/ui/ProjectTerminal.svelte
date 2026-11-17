<script module lang="ts">
  /**
   * Whether this terminal asks the session to draw again for it when the owner
   * comes back to it. Claude Code's background service draws a session for the
   * window that sized it last, so another window of a different width shows it
   * garbled. Oddboro cannot see another window take the size, so the terminal or
   * the browser window losing focus is the sign. Off, the terminal sends its
   * size only when that changes. It can go once Claude Code draws each window
   * at its own size.
   */
  export const REDRAW_ON_RETURN = true;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { projectApi } from './project-api.ts';
  import '@xterm/xterm/css/xterm.css';
  // The native terminal, filling the space its parent gives it and refitting
  // as that changes. The parent shows Take control, for this view's ID.
  let {
    id,
    view,
    writable = $bindable(false),
    onerror,
    onstream
  }: {
    onstream: (stream: EventSource, id: string) => void;
    id: string;
    /** This window's terminal view: one view at a time takes the typing. */
    view: string;
    /** Whether this view takes the typing now. */
    writable?: boolean;
    onerror: (text: string) => void;
  } = $props();
  let host: HTMLDivElement;

  onMount(() => {
    let disposed = false,
      cleanup = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit')
      ]);
      if (disposed) return;
      // The terminal's own colours come from the office tokens.
      const token = (name: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const term = new Terminal({
        theme: {
          background: token('--color-night'),
          foreground: token('--color-ink'),
          cursor: token('--color-ink'),
          selectionBackground: token('--color-sea-deep')
        },
        cursorBlink: false,
        scrollback: 2000,
        allowProposedApi: false,
        disableStdin: true
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      term.parser.registerOscHandler(52, () => true);
      const stream = new EventSource(
        '/api/project-sessions/' + id + '/events?terminal=1&view=' + view
      );
      onstream(stream, id);
      stream.addEventListener('screen', (e) => {
        term.reset();
        term.write(JSON.parse(e.data));
      });
      stream.addEventListener('control', (e) => {
        writable = JSON.parse(e.data);
        term.options.disableStdin = !writable;
        // Another view may have sized the terminal while this one watched.
        sent = '';
        if (writable) resize();
      });
      stream.addEventListener('output', (e) => term.write(JSON.parse(e.data)));
      stream.addEventListener('end', () => {
        term.options.disableStdin = true;
        stream.close();
      });
      stream.onerror = () => {
        writable = false;
        term.options.disableStdin = true;
      };
      let chain = Promise.resolve();
      const input = term.onData((data) => {
        chain = chain
          .then(async () => {
            if (!disposed && writable) await projectApi('keys', { id, view, data });
          })
          .catch((e) => onerror(e.message));
      });
      // The terminal refits at once as its box changes, and tells the session
      // its new size once the box settles, and only when it differs, so a
      // panel sliding wider or narrower sends one size, not one per frame.
      let sent = '',
        /** Whether another window may have sized the session since this one last did. */
        stale = false,
        settle: ReturnType<typeof setTimeout> | undefined;
      /** Sends this terminal's size. A new size redraws the session for it, so it clears `stale`. */
      const post = (redraw?: true) => {
        sent = `${term.cols}x${term.rows}`;
        stale = false;
        void projectApi('size', { id, view, cols: term.cols, rows: term.rows, redraw }).catch((e) =>
          onerror(e.message)
        );
      };
      const send = () => {
        if (writable && `${term.cols}x${term.rows}` !== sent) post();
      };
      /** The same size, with `redraw`: the server nudges it, since an equal size redraws nothing. */
      const redraw = () => {
        if (writable && stale) post(true);
      };
      const lost = () => (stale = true);
      const resize = () => {
        if (!host.clientWidth || !host.clientHeight) return;
        fit.fit();
        clearTimeout(settle);
        settle = setTimeout(send, 150);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      if (REDRAW_ON_RETURN) {
        host.addEventListener('focusout', lost);
        window.addEventListener('blur', lost);
        host.addEventListener('focusin', redraw);
        // In the capture phase: xterm stops every key it sends to the terminal
        // from going further, so a listener waiting for it to bubble never hears one.
        host.addEventListener('keydown', redraw, { capture: true });
      }
      resize();
      term.focus();
      cleanup = () => {
        window.removeEventListener('blur', lost);
        clearTimeout(settle);
        stream.close();
        observer.disconnect();
        input.dispose();
        term.dispose();
      };
    })().catch((e) => onerror(e.message));
    return () => {
      disposed = true;
      cleanup();
    };
  });
</script>

<div class="min-h-0 w-full flex-1 overflow-hidden bg-night p-1" bind:this={host}></div>
