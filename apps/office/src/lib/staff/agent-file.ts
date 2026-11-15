import { parse } from 'yaml';
import { MODELS, type AgentSource } from '@oddboro/ledger/agents';
import { LIMITS } from './roster.ts';

export async function readAgentFile(file: File, format: AgentSource['format']) {
  if (format === 'hermes') {
    const { readHermesProfile } = await import('./hermes-profile.ts');
    const { name, description, instructions } = await readHermesProfile(file);
    return { ...agentDraft({ format, name }, description, instructions), model: null, skipped: [] };
  }
  if (file.size > 256 * 1024) throw new Error('Choose an agent file smaller than 256 KB.');
  return readAgentMarkdown(await file.text(), format);
}

/** Read a Claude Code or Grok Build agent file for the hire form. Only the owner grants tools. */
export function readAgentMarkdown(file: string, format: 'claude' | 'grok') {
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
  if (format === 'grok' && fields.promptMode === 'full' && /\$\{(?:\{|%)/.test(instructions))
    throw new Error('Replace Grok template expressions with plain instructions before importing.');
  const model =
    MODELS[format].find(
      (m) =>
        m.id === fields.model || (format === 'claude' && m.id.startsWith(`claude-${fields.model}-`))
    )?.id ?? null;
  const imported = new Set(['name', 'description']);
  if (model || (format === 'claude' && fields.model === 'inherit')) imported.add('model');
  return {
    ...agentDraft({ format, name }, description, instructions),
    model,
    skipped: Object.keys(fields).filter((key) => !imported.has(key))
  };
}

function agentDraft(source: AgentSource, description: string, instructions: string) {
  const desk = [description, instructions].filter(Boolean).join('\n\n');
  if (desk.length > LIMITS.desk)
    throw new Error(`Shorten the agent description and instructions to ${LIMITS.desk} characters.`);
  return {
    source,
    name: source.name.slice(0, LIMITS.name),
    role: source.name.replaceAll('-', ' ').slice(0, LIMITS.role),
    remit: (description || instructions.split('\n', 1)[0]).slice(0, LIMITS.remit),
    desk
  };
}
