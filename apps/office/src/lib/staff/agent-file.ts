import { fileHeader, type FileSettings } from './file-settings.ts';
import { MODELS, type AgentSource } from '@oddboro/ledger/agents';
import { LIMITS } from './roster.ts';

function names(value: unknown): string[] | undefined {
  const items =
    typeof value === 'string' ? (value.includes('(') ? [value] : value.split(',')) : value;
  if (!Array.isArray(items) || !items.every((item) => typeof item === 'string')) return undefined;
  return [...new Set(items.map((item: string) => item.trim()).filter(Boolean))];
}

export async function readAgentFile(file: File, format: AgentSource['format']) {
  if (format === 'hermes') {
    const { readHermesProfile } = await import('./hermes-profile.ts');
    const { name, description, instructions } = await readHermesProfile(file);
    return {
      ...agentDraft({ format, name }, description, instructions),
      model: null,
      settings: { skipped: [] } as FileSettings
    };
  }
  if (file.size > 256 * 1024) throw new Error('Choose an agent file smaller than 256 KB.');
  return readAgentMarkdown(await file.text(), format);
}

/** Read a Claude Code or Grok Build agent file for the hire form. Only the owner grants tools. */
export function readAgentMarkdown(file: string, format: 'claude' | 'grok') {
  const result = fileHeader(file);
  if (!result) throw new Error('Choose an agent Markdown file with a header between --- lines.');
  const { fields, instructions } = result;
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const description = typeof fields.description === 'string' ? fields.description.trim() : '';
  if (!name || !description) throw new Error('The agent header needs a name and a description.');
  if (format === 'grok' && fields.promptMode === 'full' && /\$\{(?:\{|%)/.test(instructions))
    throw new Error('Replace Grok template expressions with plain instructions before importing.');
  const model =
    MODELS[format].find(
      (m) =>
        m.id === fields.model || (format === 'claude' && m.id.startsWith(`claude-${fields.model}-`))
    )?.id ?? null;
  const reviewed = new Set(['name', 'description']);
  if (model || (format === 'claude' && fields.model === 'inherit')) reviewed.add('model');
  const tools = names(fields.tools);
  const skills = names(fields.skills);
  const excluded = names(fields.disallowedTools);
  if (tools) reviewed.add('tools');
  if (excluded) reviewed.add('disallowedTools');
  if (skills) reviewed.add('skills');
  return {
    ...agentDraft({ format, name }, description, instructions),
    model,
    settings: {
      tools,
      skills,
      excluded,
      skipped: Object.keys(fields).filter((key) => !reviewed.has(key))
    }
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
