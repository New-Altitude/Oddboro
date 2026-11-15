import { parse } from 'yaml';
import { MODELS } from '@oddboro/ledger/agents';
import { LIMITS } from './roster.ts';

export async function readClaudeAgentFile(file: File) {
  if (file.size > 256 * 1024) throw new Error('Choose an agent file smaller than 256 KB.');
  return readClaudeAgent(await file.text());
}

/** Read a Claude Code subagent file for the hire form. Only the owner grants tools. */
export function readClaudeAgent(file: string) {
  const source = file.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const parts = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  if (!parts) throw new Error('Choose an agent Markdown file with a header between --- lines.');
  const header: unknown = parse(parts[1], { maxAliasCount: 0 });
  if (!header || typeof header !== 'object' || Array.isArray(header))
    throw new Error('The agent header needs a name and a description.');
  const fields = header as Record<string, unknown>;
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const description = typeof fields.description === 'string' ? fields.description.trim() : '';
  if (!name || !description) throw new Error('The agent header needs a name and a description.');
  const instructions = source.slice(parts[0].length).trim();
  const desk = [description, instructions].filter(Boolean).join('\n\n');
  if (desk.length > LIMITS.desk)
    throw new Error(`Shorten the agent description and instructions to ${LIMITS.desk} characters.`);
  const model =
    MODELS.claude.find((m) => m.id === fields.model || m.id.startsWith(`claude-${fields.model}-`))
      ?.id ?? null;
  const imported = new Set(['name', 'description']);
  if (model || fields.model === 'inherit') imported.add('model');
  return {
    sourceName: name,
    name: name.slice(0, LIMITS.name),
    role: name.replaceAll('-', ' ').slice(0, LIMITS.role),
    remit: description.slice(0, LIMITS.remit),
    desk,
    model,
    skipped: Object.keys(fields).filter((key) => !imported.has(key))
  };
}
