import { actCheckPassed } from '@oddboro/ledger';
import { workspace } from '#lib/server/workspace.ts';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ cookies, url }) => {
  // A visit to the HUD from the floor keeps the owner's starting view.
  if (!['office', 'strip'].includes(url.searchParams.get('from') ?? '')) {
    cookies.set('oddboro-view', 'workspace', {
      path: '/',
      maxAge: 31536000,
      secure: url.protocol === 'https:'
    });
  }
  return { ...(await workspace()), actChecked: await actCheckPassed() };
};
