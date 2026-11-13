// Site analytics: PostHog counts page views and clicks on oddboro.com, and
// only after the visitor says yes in the banner. Until then nothing loads, no
// cookie is set and nothing is sent. A browser that sends Global Privacy
// Control or Do Not Track never sees the banner and is never counted.
//
// The visitor's answer lives in this browser's localStorage. Events go to
// /ingest on this site, which the Worker (worker.ts) forwards to PostHog, so
// the browser talks to oddboro.com alone. The Oddboro app sends nothing here.
import type { PostHog } from 'posthog-js';

/** The project's public key. It ships in every page by design. */
const TOKEN = 'phc_Dhsqm2j95SMKGma3MYpFXUuor8ho6VxqVzuShXm4CnmR';
const KEY = 'oddboro.analytics';

type Answer = 'yes' | 'no';

/** `asking` shows the banner. */
export const consent = $state({ asking: false });

let posthog: PostHog | undefined;

function stored(): Answer | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

function store(answer: Answer) {
  try {
    localStorage.setItem(KEY, answer);
  } catch {
    // Storage can be off. The answer still holds for this page.
  }
}

/** Global Privacy Control or Do Not Track: the visitor has already said no. */
function refused(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

async function load() {
  if (posthog) return;
  // The build that never loads scripts from another host.
  const { default: ph } = await import('posthog-js/no-external');
  ph.init(TOKEN, {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: 'history_change',
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    respect_dnt: true
  });
  posthog = ph;
}

/** Remove what PostHog stored in this browser: its cookie and its storage. */
function forget() {
  posthog?.opt_out_capturing();
  posthog?.reset();
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name.startsWith('ph_')) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('ph_')) localStorage.removeItem(k);
  } catch {
    // Nothing stored, or storage is off.
  }
}

/** On each page load: ask, start, or stay off, by the stored answer. */
export function startAnalytics() {
  if (refused()) return;
  const answer = stored();
  if (answer === 'yes') void load();
  else if (answer === null) consent.asking = true;
}

export function answer(yes: boolean) {
  store(yes ? 'yes' : 'no');
  consent.asking = false;
  if (yes) void load();
  else forget();
}

/** The footer's Cookie settings: ask again, unless the browser already refuses. */
export function askAgain() {
  if (!refused()) consent.asking = true;
}
