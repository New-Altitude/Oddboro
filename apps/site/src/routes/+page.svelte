<script lang="ts">
  import Hero from '#lib/hero/Hero.svelte';
  import Meta from '#lib/components/Meta.svelte';
  import Hire from '#lib/sections/Hire.svelte';
  import HowItWorks from '#lib/sections/HowItWorks.svelte';
  import Managers from '#lib/sections/Managers.svelte';
  import Access from '#lib/sections/Access.svelte';
  import Goals from '#lib/sections/Goals.svelte';
  import OnYourMac from '#lib/sections/OnYourMac.svelte';
  import OpenSource from '#lib/sections/OpenSource.svelte';
  import GetStarted from '#lib/sections/GetStarted.svelte';
  import Faq from '#lib/sections/Faq.svelte';
  import Cta from '#lib/sections/Cta.svelte';
  import { SECTIONS, SITE } from '#lib/site.ts';

  // One component per section, in SECTIONS order. The header's nav links to
  // these ids, and each component carries its own composition and motion.
  const sections = {
    hire: Hire,
    'how-it-works': HowItWorks,
    managers: Managers,
    access: Access,
    goals: Goals,
    'on-your-mac': OnYourMac,
    'open-source': OpenSource,
    'get-started': GetStarted,
    faq: Faq
  } as const;
  const section = 'mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28';
  // Every other section sits on a slightly raised band, so the page has a rhythm.
  const band = new Set(['how-it-works', 'goals', 'open-source']);

  // Tells Google the site's name, so search results say Oddboro, not oddboro.com.
  const website = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: `${SITE.url}/`
  });
</script>

<Meta path="/" ogTitle={SITE.ogTitle} ogDescription={SITE.ogDescription} />
<svelte:head>
  {@html `<script type="application/ld+json">${website}</script>`}
</svelte:head>

<Hero />

{#each SECTIONS as s (s.id)}
  {@const Section = sections[s.id]}
  <div class={band.has(s.id) ? 'band' : ''}>
    <section id={s.id} class={section} aria-label={s.label}>
      <Section />
    </section>
  </div>
{/each}

<Cta />

<style>
  .band {
    background:
      linear-gradient(
        to bottom,
        var(--color-night),
        transparent 12%,
        transparent 88%,
        var(--color-night)
      ),
      var(--color-panel-solid);
  }
</style>
