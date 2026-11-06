<script lang="ts">
  // What the owner has taught an Odd, and every Odd: the guesses waiting for the
  // owner's Keep first, then each lesson it follows in every run, with how often
  // it changed the work.
  import type { TaughtLesson } from '@oddboro/ledger';
  import Lesson from './Lesson.svelte';
  import { call } from './api.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = { profile: StaffProfile; version: number };
  let { profile, version }: Props = $props();

  let lessons = $state<(TaughtLesson & { heardByName: string })[]>([]);
  let loaded = $state(false);

  $effect(() => {
    void version;
    call<typeof lessons>(`/api/staff/${profile.id}/lessons`)
      .then((l) => (lessons = l))
      .catch(() => {})
      .finally(() => (loaded = true));
  });
</script>

<div class="flex h-full flex-col gap-3 overflow-y-auto p-3">
  {#if loaded && !lessons.length}
    <p class="m-auto max-w-[260px] text-center text-sm text-muted">
      Correct {profile.name} once, in chat or in a reason on an ask, and it keeps the lesson here. Every
      run after follows it.
    </p>
  {/if}
  {#each lessons as l (l.id)}
    <Lesson lesson={l} name={l.heardByName} />
  {/each}
</div>
