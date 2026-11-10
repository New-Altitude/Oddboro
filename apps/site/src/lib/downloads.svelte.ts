// The builds Oddboro ships, and which one this visitor's computer wants. The
// page renders the Mac build first, so it is whole with no script; in the
// browser, `detectBuild` switches to the Windows or Linux build on those
// systems. The answer stays in this page and goes nowhere.
import { SITE } from '#lib/site.ts';

export type BuildId = 'mac' | 'windows-x64' | 'windows-arm64' | 'linux-x86_64' | 'linux-aarch64';

export type Build = {
  id: BuildId;
  /** Whose mark the download button shows. */
  mark: 'mac' | 'windows' | 'linux';
  /** What the button says after "Download for". */
  system: string;
  /** Who Get started's heading names: "Download Oddboro for ...". */
  audience: string;
  /** The build named in full, for the list of every build. */
  label: string;
  /** The file every release carries under this name, so the newest one has a fixed link. */
  file: string;
  /** The file in one version's release. */
  versioned: (version: string) => string;
  requirements: string[];
  install: string[];
};

export const BUILDS: Build[] = [
  {
    id: 'mac',
    mark: 'mac',
    system: 'Mac',
    audience: 'your Mac',
    label: 'Mac, Apple silicon',
    file: 'Oddboro.dmg',
    versioned: (v) => `Oddboro_${v}_aarch64.dmg`,
    requirements: [
      'A Mac with Apple silicon',
      'macOS 13 or later',
      'A Claude plan or API key, or a ChatGPT or Grok account'
    ],
    install: [
      'Open Oddboro.dmg.',
      'Drag Oddboro to Applications.',
      'Open Oddboro from Applications.'
    ]
  },
  {
    id: 'windows-x64',
    mark: 'windows',
    system: 'Windows',
    audience: 'Windows',
    label: 'Windows, x64',
    file: 'Oddboro-x64-setup.exe',
    versioned: (v) => `Oddboro_${v}_x64-setup.exe`,
    requirements: [
      'Windows 10 or 11 on x64',
      'A Claude plan or API key, or a ChatGPT or Grok account'
    ],
    install: [
      'Open Oddboro-x64-setup.exe.',
      'If Windows says it protected your PC, select More info, then Run anyway.',
      'Open Oddboro from the Start menu.'
    ]
  },
  {
    id: 'windows-arm64',
    mark: 'windows',
    system: 'Windows',
    audience: 'Windows',
    label: 'Windows, arm64',
    file: 'Oddboro-arm64-setup.exe',
    versioned: (v) => `Oddboro_${v}_arm64-setup.exe`,
    requirements: ['Windows 11 on arm64', 'A Claude plan or API key, or a ChatGPT or Grok account'],
    install: [
      'Open Oddboro-arm64-setup.exe.',
      'If Windows says it protected your PC, select More info, then Run anyway.',
      'Open Oddboro from the Start menu.'
    ]
  },
  {
    id: 'linux-x86_64',
    mark: 'linux',
    system: 'Linux',
    audience: 'Linux',
    label: 'Linux, x86_64',
    file: 'Oddboro-x86_64.AppImage',
    versioned: (v) => `Oddboro_${v}_x86_64.AppImage`,
    requirements: [
      'Linux on x86_64, with systemd and a desktop',
      'A keyring and notifications (GNOME, KDE and most others)',
      'A Claude plan or API key, or a ChatGPT or Grok account'
    ],
    install: [
      'Move Oddboro-x86_64.AppImage to ~/Applications.',
      'Allow it to run: chmod +x ~/Applications/Oddboro-x86_64.AppImage',
      'Open it.'
    ]
  },
  {
    id: 'linux-aarch64',
    mark: 'linux',
    system: 'Linux',
    audience: 'Linux',
    label: 'Linux, arm64',
    file: 'Oddboro-aarch64.AppImage',
    versioned: (v) => `Oddboro_${v}_aarch64.AppImage`,
    requirements: [
      'Linux on arm64, with systemd and a desktop',
      'A keyring and notifications (GNOME, KDE and most others)',
      'A Claude plan or API key, or a ChatGPT or Grok account'
    ],
    install: [
      'Move Oddboro-aarch64.AppImage to ~/Applications.',
      'Allow it to run: chmod +x ~/Applications/Oddboro-aarch64.AppImage',
      'Open it.'
    ]
  }
];

/** The newest published release's copy of a build. */
export const latestHref = (b: Build) => `${SITE.releases}/latest/download/${b.file}`;

/** One version's copy of a build. */
export const versionHref = (b: Build, version: string) =>
  `${SITE.releases}/download/v${version}/${b.versioned(version)}`;

const byId = (id: BuildId) => BUILDS.find((b) => b.id === id)!;

/** The build this visitor gets first. Every download button reads it. */
export const download = $state({ build: byId('mac') });

let detected = false;

type UAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

/**
 * Picks the build for this computer, once per page load. Windows gets an
 * installer and Linux an AppImage, each for its chip; anything else keeps the
 * Mac build, and the list of every build is one link away. Browsers report an
 * x64 chip in the user agent on arm64 Windows and Linux too, so Chromium's
 * own hint decides the chip where it gives one. Without it, arm64 Windows
 * gets the x64 installer, which it runs.
 */
export async function detectBuild(): Promise<void> {
  if (detected || typeof navigator === 'undefined') return;
  detected = true;
  const ua = navigator.userAgent;
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  const platform = data?.platform ?? navigator.platform ?? '';
  const windows = /^win/i.test(platform) || /windows nt/i.test(ua);
  const linux =
    !windows && (/linux/i.test(platform) || (/linux|x11/i.test(ua) && !/android/i.test(ua)));
  if (!(windows || linux) || /android|cros/i.test(ua)) return;
  let arm = /aarch64|arm64|armv8/i.test(`${ua} ${platform}`);
  try {
    const hints = await data?.getHighEntropyValues?.(['architecture']);
    if (hints?.architecture) arm = hints.architecture === 'arm';
  } catch {
    // No hint: the user agent's answer stands.
  }
  if (windows) download.build = byId(arm ? 'windows-arm64' : 'windows-x64');
  else download.build = byId(arm ? 'linux-aarch64' : 'linux-x86_64');
}
