<script lang="ts" module>
  /** A starter as the card shows it (`STARTERS` in the ledger, less its job description). */
  export type StarterOffer = {
    id: string;
    says: string;
    ticked: boolean;
    proposal: { name: string; role: string };
  };
</script>

<script lang="ts">
  // The first visit's Your team card: the Odds most new owners want, ticked,
  // which the manager proposes to hire as the office opens. Each lands on the
  // desk as a hire the owner finishes in the hire window, at Draft. Under them,
  // the Odds New Altitude recommends: personas, added from Setup once the owner
  // signs in there, so this card names nobody.
  type Props = {
    starters: StarterOffer[];
    team: string[];
    onback: () => void;
    onnext: () => void;
  };
  let { starters, team = $bindable(), onback, onnext }: Props = $props();

  function toggle(id: string, on: boolean) {
    team = on ? [...team.filter((t) => t !== id), id] : team.filter((t) => t !== id);
  }
</script>

<p class="text-sm text-muted">
  Who else starts with you. Your manager puts each one you keep on your desk to hire, and they start
  by drafting. Nothing leaves the office without your yes.
</p>
<ul class="mt-3 flex flex-col gap-2">
  {#each starters as s (s.id)}
    <li>
      <label class="flex items-start gap-3 rounded-xl bg-raise px-3 py-2.5">
        <input
          type="checkbox"
          class="mt-1 accent-sea"
          checked={team.includes(s.id)}
          onchange={(e) => toggle(s.id, e.currentTarget.checked)}
        />
        <span class="min-w-0 flex-1">
          <span class="block text-sm text-ink"
            >{s.proposal.name} <span class="text-muted">· {s.proposal.role}</span></span
          >
          <span class="block text-xs text-muted">{s.says}</span>
        </span>
      </label>
    </li>
  {/each}
</ul>
<h3 class="mt-4 text-[10px] tracking-[0.16em] text-muted uppercase">Recommended</h3>
<p class="mt-1 text-xs text-muted">
  New Altitude offers Odds that work in a real person's voice. Sign in to New Altitude in Setup once
  the office is open to see who is on offer and add them.
</p>
<div class="mt-4 flex flex-wrap items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1"></span>
  <button class="btn primary" onclick={onnext}>Next</button>
</div>
