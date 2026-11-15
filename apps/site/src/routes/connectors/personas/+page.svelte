<script lang="ts">
  import Guide from '#lib/components/Guide.svelte';
  import Meta from '#lib/components/Meta.svelte';
  import type { Part, Trouble } from '#lib/guides/types.ts';

  const parts: Part[] = [
    {
      title: 'Use a persona in Oddboro',
      steps: [
        {
          text: 'Open Setup, then Account. Sign in with the email you use for your New Altitude membership.'
        },
        {
          text: 'Find the persona your account can use. Choose Add and finish its sign-in in the browser.'
        },
        {
          text: 'Open that Odd’s chat. Ask a question about the creator’s work and ask for a source you can open.'
        }
      ]
    },
    {
      title: 'Use a persona in another AI app',
      steps: [
        {
          text: 'Sign in to the member site with your membership email and open the connector instructions.',
          link: 'https://members.newaltitude.ai/'
        },
        {
          text: 'Add the persona picker if you want help choosing a persona. Connect each persona you want to ask using its own connector and finish its sign-in.'
        },
        {
          text: 'Ask your app to use that specific persona. Open the tool activity to check which connector answered, then open a source from the reply.'
        }
      ]
    }
  ];
  const trouble: Trouble[] = [
    {
      q: 'The picker works, but the person I chose never answers.',
      a: 'Check the connector address against the individual persona in your member account. Giving the picker the person’s name in your app still calls the picker.'
    },
    {
      q: 'My persona used to work. Now the app asks me to connect again.',
      a: 'Sign in to the member site with the same email. If it asks you to review updated beta terms, read them and decide whether to accept. Return to your app and reconnect the persona. In Oddboro, use Reconnect under Setup, Account.'
    },
    {
      q: 'I am on the creator sign-in page.',
      a: 'Use the member site linked above to ask an existing persona. The creator site at personas.newaltitude.ai is for people making a persona from their own work.'
    }
  ];
</script>

<Meta
  title="Connect a New Altitude persona · Oddboro"
  description="Connect the persona you want in Oddboro or another AI app, and recover a disconnected persona."
  path="/connectors/personas/"
/>

<Guide
  title="Connect a New Altitude persona"
  lede="Choose the steps for the app where you want the answer. In Oddboro, the Odd works in your office and New Altitude provides its replies."
  {parts}
  {trouble}
/>
