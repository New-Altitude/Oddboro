import { workspace } from '#lib/server/workspace.ts';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ cookies, url }) => {
  cookies.set('oddboro-view', 'workspace', {
    path: '/',
    maxAge: 31536000,
    secure: url.protocol === 'https:'
  });
  return workspace();
};
