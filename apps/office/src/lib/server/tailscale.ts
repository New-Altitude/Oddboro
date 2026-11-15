// The home computer's Tailscale name, for the phone desk (`/desk`). Setup asks
// Tailscale on this computer for its name and whether `tailscale serve`
// already points that name at the phone's door (`phone-door.ts`), and with one
// click lists the name in ODDBORO_EXTRA_HOSTS, so the owner never edits `.env`. The office never
// runs `tailscale serve` itself: that changes what the tailnet reaches, so the
// owner runs the command Setup shows. Mac, Linux and Windows each find
// Tailscale their own way (`tailscaleCommand`).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { writeEnv } from '@oddboro/ledger/env';
import { currentPlatform } from '@oddboro/ledger/platform';
import { onPath } from './on-path.ts';
import { DOOR_PORT, DOOR_URL, listedNames } from './phone-door.ts';

/**
 * Where each system's Tailscale keeps its command when it is not on PATH: the
 * Mac app's own binary, which answers as the CLI, and the Windows installer's
 * folder. Linux installs it on PATH.
 */
function installedAt(): string[] {
  const p = currentPlatform();
  if (p === 'darwin') return ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  if (p === 'win32')
    return [
      win32.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
    ];
  return [];
}

/** The Tailscale command on this computer, or undefined when it has none. */
export function tailscaleCommand(): string | undefined {
  return onPath('tailscale') ?? installedAt().find((f) => existsSync(f));
}

/** Runs Tailscale with these arguments and gives back what it printed. Tests stand in for it. */
export type Run = (command: string, args: string[]) => Promise<string>;

const run: Run = (command, args) =>
  new Promise((done, fail) =>
    execFile(command, args, { timeout: 5_000, windowsHide: true }, (e, out) =>
      e ? fail(e) : done(out)
    )
  );

/** Where the phone desk stands on this computer, as Setup shows it. */
export type PhoneDesk =
  /** No Tailscale here. */
  | { tailscale: 'missing' }
  /** Tailscale is here but not running, or not signed in. */
  | { tailscale: 'off' }
  | {
      tailscale: 'on';
      /** This computer's name on the tailnet, such as `home-pc.tail1234.ts.net`. */
      name: string;
      /** Whether `tailscale serve` sends that name's https to the phone's door. */
      serving: boolean;
      /** The command that makes it so, for the owner to run. */
      serveCommand: string;
      /** Whether the door answers that name (ODDBORO_EXTRA_HOSTS). */
      allowed: boolean;
      /** The desk's address for the phone. */
      link: string;
    };

/** The serve command as the owner types it: with sudo on Linux, and the full path when it is not on PATH. */
function serveCommand(command: string): string {
  const name = onPath('tailscale') ? 'tailscale' : `"${command}"`;
  const sudo = currentPlatform() === 'linux' ? 'sudo ' : '';
  return `${sudo}${name} serve --bg ${DOOR_URL}`;
}

/** Whether `tailscale serve status --json` sends the name's port 443, at `/`, to the phone's door. */
export function servesOffice(status: unknown, name: string): boolean {
  const web = (
    status as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }
  )?.Web;
  const proxy = web?.[`${name}:443`]?.Handlers?.['/']?.Proxy ?? '';
  const port = String(DOOR_PORT);
  return [
    DOOR_URL,
    `http://localhost:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    port
  ].includes(proxy.replace(/\/$/, ''));
}

/** The names the door answers, as the environment or `.env` gives them. */
const listed = listedNames;

/** Ask Tailscale where things stand. Never throws: a Tailscale that fails to answer reads as off. */
export async function phoneDesk(exec: Run = run): Promise<PhoneDesk> {
  const command = tailscaleCommand();
  if (!command) return { tailscale: 'missing' };
  let name = '';
  try {
    const status = JSON.parse(await exec(command, ['status', '--json'])) as {
      BackendState?: string;
      Self?: { DNSName?: string };
    };
    if (status.BackendState !== 'Running') return { tailscale: 'off' };
    name = (status.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase();
  } catch {
    return { tailscale: 'off' };
  }
  if (!name) return { tailscale: 'off' };
  let serving = false;
  try {
    serving = servesOffice(JSON.parse(await exec(command, ['serve', 'status', '--json'])), name);
  } catch {
    // An older Tailscale, or none set: the owner runs the command shown.
  }
  return {
    tailscale: 'on',
    name,
    serving,
    serveCommand: serveCommand(command),
    allowed: listed().includes(name),
    link: `https://${name}/desk`
  };
}

/**
 * List this computer's Tailscale name in ODDBORO_EXTRA_HOSTS, in `.env` and in
 * this process. The door reads the list on every request, so it answers the
 * name at once, under the dev server too.
 */
export async function allowPhoneDesk(exec: Run = run): Promise<{ desk: PhoneDesk }> {
  const desk = await phoneDesk(exec);
  if (desk.tailscale !== 'on') return { desk };
  if (!desk.allowed) {
    const names = [...listed(), desk.name];
    writeEnv({ ODDBORO_EXTRA_HOSTS: names.join(',') });
    process.env.ODDBORO_EXTRA_HOSTS = names.join(',');
  }
  return { desk: { ...desk, allowed: true } };
}
