<script lang="ts">
  // Everything a page says about itself in <head>. Every page renders one.
  import { SITE } from '#lib/site.ts';

  let {
    title = SITE.title,
    description = SITE.description,
    ogTitle = title,
    ogDescription = description,
    path = '/',
    image = SITE.ogImage,
    imageAlt = 'A glowing pixel O over the name Oddboro on a lawn, two pixel-art Odds to each side'
  }: {
    title?: string;
    description?: string;
    /** What a link preview shows, when it should differ from the tab. */
    ogTitle?: string;
    ogDescription?: string;
    path?: string;
    /** The link preview's picture, 1200 by 630, from the site's root. */
    image?: string;
    imageAlt?: string;
  } = $props();

  const canonical = $derived(`${SITE.url}${path}`);
  const imageUrl = $derived(`${SITE.url}${image}`);
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={SITE.name} />
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDescription} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={imageUrl} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={imageAlt} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={ogTitle} />
  <meta name="twitter:description" content={ogDescription} />
  <meta name="twitter:image" content={imageUrl} />
  <meta name="twitter:image:alt" content={imageAlt} />
</svelte:head>
