// A notification on the owner's computer, for pings that should reach them
// with the office closed: a staffer's ping, or the setup test. While the tab
// is open the browser shows its own (Notification API), on every system.
//
// In the Mac app the server asks the app on stdout, one line each, and macOS
// shows it as Oddboro's (apps/desktop/src-tauri/src/server.rs). Run from the
// repo, each system has its own way, in the table below: osascript on a Mac
// (which macOS shows as Script Editor's, so Script Editor has to be allowed in
// System Settings, Notifications), and notify-send on Linux, which every
// desktop that follows the freedesktop notification spec shows, and a toast
// on Windows through PowerShell. A toast has to name an app Windows knows, and
// the repo installs none, so it shows as Windows PowerShell's, the way a Mac
// shows Script Editor's.
import {
  IN_APP,
  SYSTEM,
  openUrl,
  powershell,
  probe,
  type Probe,
  type System
} from '@oddboro/ledger';

// The words come in as environment variables and are escaped for XML inside.
const TOAST = `
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$e = [Security.SecurityElement]
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>' + $e::Escape($env:ODDBORO_TITLE) + '</text><text>' + $e::Escape($env:ODDBORO_MESSAGE) + '</text></binding></visual></toast>')
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show((New-Object Windows.UI.Notifications.ToastNotification $xml))`;

/** One line: no tab or line break may reach the app inside the words. */
const flat = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

const NOTIFY: Record<System, ((title: string, message: string) => Promise<Probe>) | undefined> = {
  // Arguments, not a script string, so the words need no escaping.
  mac: (title, message) =>
    probe('osascript', [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"',
      '-e',
      'end run',
      message,
      title
    ]),
  linux: (title, message) => probe('notify-send', ['--app-name', 'Oddboro', title, message]),
  windows: (title, message) => powershell(TOAST, { ODDBORO_TITLE: title, ODDBORO_MESSAGE: message })
};

/** Where each system lets the owner allow notifications. Linux has no one place, so none. */
const SETTINGS: Record<System, string | undefined> = {
  mac: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  linux: undefined,
  windows: 'ms-settings:notifications'
};

/** Whether this computer can show the office's own notifications. */
export const CAN_NOTIFY = IN_APP || !!(SYSTEM && NOTIFY[SYSTEM]);

export async function notifyMac(title: string, message: string): Promise<boolean> {
  if (IN_APP) {
    process.stdout.write(`oddboro:notify ${flat(title)}\t${flat(message)}\n`);
    return true;
  }
  const notify = SYSTEM && NOTIFY[SYSTEM];
  if (!notify) return false;
  const r = await notify(title, message);
  switch (r.status) {
    case 'ok':
      return true;
    case 'failed':
    case 'missing':
    case 'timeout':
      return false;
    default: {
      const missed: never = r;
      throw new Error(`The notification came back as ${JSON.stringify(missed)}`);
    }
  }
}

/** Open the system's notification settings, where it has one place for them. */
export function openNotificationSettings(): Promise<boolean> {
  const url = SYSTEM && SETTINGS[SYSTEM];
  return url ? openUrl(url) : Promise.resolve(false);
}
