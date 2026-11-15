<script lang="ts">
  import {
    bindingProblem,
    chord,
    commands,
    defaultKeys,
    HUD_KEYS,
    keyLabel,
    type HudCommand,
    type HudKeys
  } from './hud-keys.ts';
  let { keys, onchange }: { keys: HudKeys; onchange: (keys: HudKeys) => void } = $props();
  let capture = $state<HudCommand>(),
    note = $state('');
  function record(e: KeyboardEvent, id: HudCommand) {
    if (capture !== id) return;
    if (e.key === 'Tab') {
      capture = undefined;
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      capture = undefined;
      note = '';
      return;
    }
    const value = chord(e);
    if (!value) return;
    note = bindingProblem(keys, id, value);
    if (note) return;
    onchange({ ...keys, [id]: value });
    capture = undefined;
    note = HUD_KEYS[id].name + ' now uses ' + keyLabel(value) + '.';
  }
</script>

<details
  class="settings"
  ontoggle={(e) => {
    if (!e.currentTarget.open) {
      capture = undefined;
      note = '';
    }
  }}
>
  <summary>Keyboard shortcuts</summary>
  <p>
    Choose a shortcut, then press its new keys. Tab moves between controls. Escape cancels
    recording.
  </p>
  {#each commands as id}
    <div class="binding">
      <span>{HUD_KEYS[id].name}</span>
      <button
        aria-label={'Change shortcut for ' + HUD_KEYS[id].name}
        aria-pressed={capture === id}
        onblur={() => {
          if (capture === id) capture = undefined;
        }}
        onkeydown={(e) => record(e, id)}
        onclick={() => {
          capture = capture === id ? undefined : id;
          note = '';
        }}>{capture === id ? 'Press keys…' : keyLabel(keys[id])}</button
      >
      <button
        disabled={!keys[id]}
        aria-label={'Disable shortcut for ' + HUD_KEYS[id].name}
        onclick={() => {
          onchange({ ...keys, [id]: '' });
          note = HUD_KEYS[id].name + ' shortcut off.';
        }}>Off</button
      >
    </div>
  {/each}
  <button
    onclick={() => {
      capture = undefined;
      onchange(defaultKeys());
      note = 'Default shortcuts restored.';
    }}>Restore defaults</button
  >
  <p role="status">{note}</p>
</details>

<style>
  summary,
  button {
    cursor: pointer;
  }
  summary {
    font-size: 0.8rem;
    color: var(--color-sea);
  }
  .settings[open] {
    border-block-start: 1px solid var(--color-hairline);
    padding-block: 0.65rem;
  }
  p,
  .binding {
    font-size: 0.8rem;
  }
  .binding {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    padding-block: 0.2rem;
  }
  .binding span {
    flex: 1;
  }
  .binding button,
  button {
    padding: 0.25rem 0.5rem;
    background: var(--color-raise);
    border-radius: 0.25rem;
  }
  p {
    color: var(--color-muted);
    margin-block: 0.4rem;
  }
  button:disabled {
    opacity: 0.5;
  }
</style>
