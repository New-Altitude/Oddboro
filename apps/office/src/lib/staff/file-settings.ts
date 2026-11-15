import { parse } from 'yaml';

/** Declarations from the file only. Grants and attached skills belong to the office. */
export type FileSettings = {
  tools?: string[];
  skills?: string[];
  excluded?: string[];
  skipped?: string[];
  compatibility?: string;
};

/** The YAML header and instruction text shared by agent and skill files. */
export function fileHeader(file: string) {
  const source = file.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const parts = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  if (!parts) return undefined;
  const fields: unknown = parse(parts[1], { maxAliasCount: 0, prettyErrors: false });
  if (!fields || typeof fields !== 'object' || Array.isArray(fields))
    throw new Error('The file header needs named fields.');
  return {
    fields: fields as Record<string, unknown>,
    instructions: source.slice(parts[0].length).trim()
  };
}

/** Read only declarations. Plain Markdown remains usable as skill instructions. */
export function skillSettings(file: string): FileSettings {
  const header = fileHeader(file);
  if (!header) return {};
  const declared = header.fields['allowed-tools'];
  // A provider restriction can contain spaces, as in Bash(git status:*).
  const tools =
    typeof declared === 'string'
      ? [...new Set(declared.match(/[^()\s]+(?:\([^()]*\))?/g) ?? [])]
      : undefined;
  const compatibility =
    typeof header.fields.compatibility === 'string'
      ? header.fields.compatibility.trim()
      : undefined;
  return { tools, compatibility };
}
