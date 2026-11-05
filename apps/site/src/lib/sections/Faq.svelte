<script lang="ts">
  // Ten questions as native disclosures. Each answer fades in once when
  // opened; the chevron turns. Code in an answer is marked in the text with
  // backticks and rendered as <code>.
  import SectionHeader from '#lib/components/SectionHeader.svelte';
  import { stagger } from '#lib/motion/index.ts';

  const faqs = [
    {
      q: 'What is an Odd?',
      a: 'An AI worker in your office. Each Odd runs on Claude Code, with one job description, a place on the floor, and the tools you connected for it.'
    },
    {
      q: 'What does it cost?',
      a: 'Oddboro itself is free under Apache 2.0. Claude costs what it already costs you, on your Claude plan or your API key.'
    },
    {
      q: 'Which Claude plan do I need?',
      a: 'Any plan that signs in to Claude Code. Or skip the plan and use an Anthropic API key.'
    },
    {
      q: 'Does it run on Windows or Linux?',
      a: 'Yes, both. Windows: an installer for Windows 10 and 11, on x64 and arm64. Linux: an AppImage for x86_64 and arm64, on a desktop with systemd, a keyring and notifications.'
    },
    {
      q: 'What leaves my computer?',
      a: 'Only what the work needs. Odds send their work to Claude under your own account, and an Odd talks to the tools you connected for it. The app checks GitHub for new versions of itself. Error reports go to New Altitude only if you say yes.'
    },
    {
      q: 'Can an Odd act without asking me?',
      a: 'Yes, within the limits you set. At the act level an Odd does housekeeping inside the office on its own, and uses any tool you gave it write access to. Everything else waits on your desk.'
    },
    {
      q: 'Can I pick the model?',
      a: 'Yes, between Claude Opus and Claude Sonnet. Opus is the default. Claude is the only provider today.'
    },
    {
      q: 'What is the Office Manager?',
      a: 'Your first Odd. It runs the floor, puts your daily report on your desk at 7 each morning, and helps you hire the rest. Pick one of the four ready-made managers, or describe your own.'
    },
    {
      q: 'How do I start over, or remove it?',
      a: 'On a Mac, turn off Open at login in the menu bar, quit Oddboro, and move it to the Trash. On Windows, turn off Open at login in the tray, quit Oddboro, and uninstall it in Settings, Apps. On Linux, turn off Open at login in the tray (or delete `~/.config/autostart/Oddboro.desktop`), quit Oddboro, and delete the AppImage. Every way, your office stays in the `.oddboro` folder in your home folder until you delete it. From source, `npm run reset` starts the office over: it moves the old one into `~/.oddboro/backups/` and deletes nothing. To remove a source install, run `npm run service:uninstall -w apps/office`, then delete the folder.'
    },
    {
      q: 'Who makes it?',
      a: 'New Altitude, Inc. The code is open, but the license grants no rights to the Oddboro name.'
    }
  ];

  /** Split an answer at its backticks: every second part is code. */
  const parts = (a: string) => a.split('`').map((text, i) => ({ text, code: i % 2 === 1 }));
</script>

<SectionHeader eyebrow="FAQ" title="Questions" align="center" />

<div use:stagger={{ step: 50 }} class="mx-auto mt-10 max-w-3xl">
  {#each faqs as f (f.q)}
    <details class="border-hairline group border-b">
      <summary
        class="text-ink hover:text-sea flex cursor-pointer list-none items-center justify-between gap-6 rounded-md py-5 text-lg font-semibold [&::-webkit-details-marker]:hidden"
      >
        {f.q}
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          class="faq-chevron text-faint shrink-0"
          aria-hidden="true"
        >
          <path
            d="M5 8l5 5 5-5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </summary>
      <p class="faq-answer text-muted pb-6 text-[15px] leading-relaxed">
        {#each parts(f.a) as p, i (i)}
          {#if p.code}<code class="bg-raise text-ink rounded px-1.5 py-0.5 font-mono text-[13px]"
              >{p.text}</code
            >{:else}{p.text}{/if}
        {/each}
      </p>
    </details>
  {/each}
</div>
