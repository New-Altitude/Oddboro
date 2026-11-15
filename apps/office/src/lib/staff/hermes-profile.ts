import { parseTar } from '@remix-run/tar-parser';
import { parse } from 'yaml';

/** An export has one profile directory. Read its instructions in the browser, without extracting files. */
export async function readHermesProfile(file: File) {
  let name = '';
  let instructions: string | undefined;
  let metadata: string | undefined;
  try {
    const tar = file.stream().pipeThrough(new DecompressionStream('gzip'));
    await parseTar(tar, async (entry) => {
      const [root, member, ...nested] = entry.name.split('/');
      if (!root || (name && root !== name)) throw new Error();
      name = root;
      if (nested.length || entry.header.type !== 'file') return;
      if (member === 'SOUL.md') {
        if (instructions !== undefined) throw new Error();
        instructions = (await entry.text()).trim();
      }
      if (member === 'profile.yaml') {
        if (metadata !== undefined) throw new Error();
        metadata = await entry.text();
      }
    });
  } catch {
    throw new Error(
      'Choose a readable Hermes profile export under 20 MiB unpacked, with one profile directory and files under 2 MiB.'
    );
  }
  if (!instructions) throw new Error('The Hermes profile needs a nonempty SOUL.md.');
  const profile = metadata ? parse(metadata, { maxAliasCount: 0, prettyErrors: false }) : undefined;
  const description = typeof profile?.description === 'string' ? profile.description.trim() : '';
  return { name, description, instructions };
}
