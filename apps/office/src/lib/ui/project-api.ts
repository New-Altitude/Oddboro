export async function projectApi<T = unknown>(
  action: string,
  fields: Record<string, unknown> = {}
): Promise<T> {
  const r = await fetch('/api/project-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.message || 'The office could not reach the session.');
  return body as T;
}
