// Public data only. Every link is opened by its reader.
import { z } from 'zod';

const line = z.string().trim().min(1).max(800);
const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,100}$/)
  .refine((value) => !(value in Object.prototype));
const instant = z.iso.datetime({ offset: true });
const link = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine((s) => {
    const u = new URL(s);
    return !u.username && !u.password;
  });
export const topics = ['building', 'work', 'research', 'business'] as const;
export const channels = ['article', 'video', 'post'] as const;
export const topicNames = {
  building: 'Building with AI',
  work: 'AI at work',
  research: 'Research and models',
  business: 'Business and policy'
};
export const channelNames = { article: 'Substack', video: 'YouTube', post: 'X' };
const story = z.object({
  id,
  title: line,
  summary: line,
  consequence: z.string().max(800),
  changed: instant,
  topic: z.enum(topics),
  sources: z
    .array(z.object({ label: line, url: link }))
    .min(1)
    .max(6),
  spread: z.string().max(800).default(''),
  placement: z.enum(['brief', 'wire']),
  revision: z.number().int().positive(),
  alert: z.enum(['action', 'conversation', 'correction']).nullable(),
  alertText: z.string().max(500).default(''),
  history: z
    .array(z.object({ at: instant, text: line }))
    .max(20)
    .optional(),
  withdrawn: z.boolean().default(false)
});
const publication = z.object({
  id,
  title: line,
  published: instant,
  group: id,
  channel: z.enum(channels),
  url: link,
  storyId: id.optional(),
  withdrawn: z.boolean().default(false)
});
export const editionSchema = z
  .object({
    version: z.literal(1),
    byline: line.optional(),
    name: line,
    persona: id,
    day: z.iso.date(),
    updated: instant,
    checked: instant,
    coverage: z.array(line).max(30),
    stories: z.array(story).max(150),
    publications: z.array(publication).max(100)
  })
  .refine(
    (e) =>
      new Set(e.stories.map((s) => s.id)).size === e.stories.length &&
      new Set(e.publications.map((p) => p.id)).size === e.publications.length
  );
export type Edition = z.infer<typeof editionSchema>;
export type Story = Edition['stories'][number];
export type Publication = Edition['publications'][number];
const hour = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const preferences = z.object({
  topic: z.enum(['balanced', ...topics]).default('balanced'),
  delivery: z.enum(['read', 'brief', 'alerts']).default('brief'),
  desktop: z.boolean().default(false),
  briefTime: hour.default('07:00'),
  quietStart: hour.default('22:00'),
  quietEnd: hour.default('07:00'),
  channels: z
    .array(z.enum(channels))
    .max(channels.length)
    .default([...channels]),
  creator: z.enum(['brief', 'chat', 'shelf']).default('brief')
});
export type Preferences = z.infer<typeof preferences>;
export type Marks = Record<string, { saved?: boolean; followed?: boolean; muted?: boolean }>;
export function todayStories(edition: Edition, prefs: Preferences, marks: Marks) {
  return edition.stories
    .filter((s) => !s.withdrawn && !marks[s.id]?.muted && s.placement === 'brief')
    .sort((a, b) => Number(b.topic === prefs.topic) - Number(a.topic === prefs.topic));
}
export function publicationGroups(edition: Edition, prefs: Preferences) {
  return Object.values(
    Object.groupBy(
      edition.publications
        .filter((p) => !p.withdrawn && prefs.channels.includes(p.channel))
        .sort((a, b) => Date.parse(b.published) - Date.parse(a.published)),
      (p) => p.group
    )
  ).filter((g) => g !== undefined);
}

export const markNames = ['saved', 'followed', 'muted'] as const;
export const command = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add') }),
  z.object({ op: z.literal('remove') }),
  z.object({ op: z.literal('refresh') }),
  z.object({ op: z.literal('visit') }),
  z.object({ op: z.literal('preferences'), prefs: preferences }),
  z.object({ op: z.literal('mark'), id, mark: z.enum(markNames), on: z.boolean() }),
  z.object({ op: z.literal('pause'), on: z.boolean() })
]);
export type Command = z.infer<typeof command>;
export type NewsroomView = {
  edition?: Edition;
  prefs: Preferences;
  marks: Marks;
  kept: Story[];
  paused: boolean;
  notices: { key: string; text: string; at: string }[];
  lastVisit?: string;
  problem?: string;
  staff?: string;
};
