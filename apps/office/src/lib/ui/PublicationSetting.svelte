<script lang="ts">
  import { publicationSettings } from './persona-offers.svelte.ts';
  import { call } from './api.ts';
  import type { PublicationMode } from '@oddboro/ledger';
  let { slug }: { slug: string } = $props();
  type Setting = { available: boolean; mode: PublicationMode; problem: string };
  let setting = $state<Setting>();
  let problem = $state('');
  let saving = $state(false);
  const url = (id: string) => `/api/personas/${id}/publications` as const;
  $effect(() => {
    void publicationSettings.version;
    const id = slug;
    let live = true;
    problem = '';
    void call<Setting>(url(id))
      .then((s) => {
        if (live) setting = s;
      })
      .catch(() => {
        if (live) problem = 'Publication settings did not load.';
      });
    return () => {
      live = false;
    };
  });
  async function change(el: HTMLSelectElement) {
    const id = slug;
    saving = true;
    problem = '';
    try {
      const next = await call<Setting>(url(id), { mode: el.value }, 'PUT');
      if (id === slug) setting = next;
    } catch (e) {
      if (id === slug) {
        el.value = setting?.mode ?? 'off';
        problem = e instanceof Error ? e.message : 'Could not change updates.';
      }
    } finally {
      saving = false;
    }
  }
</script>

{#if setting?.available || (setting && setting.mode !== 'off')}
  <label
    >Publication updates <select
      class="rounded bg-raise p-1 text-ink"
      value={setting.mode}
      disabled={saving}
      onchange={(e) => change(e.currentTarget)}
      ><option value="off">Off</option><option value="chat">In chat</option><option value="desktop"
        >In chat and desktop</option
      ></select
    ></label
  >
  <p class="text-muted">
    Follow new articles and videos through New Altitude. Desktop alerts need a running office and
    notification permission.
  </p>
{:else if setting}<p class="text-muted">This persona does not offer publication updates.</p>{/if}
{#if problem || setting?.problem}<p role="status">{problem || setting?.problem}</p>{/if}
