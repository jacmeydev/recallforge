// ============================================================================
// RecallForge — Daily reminder (desktop notification)
// ============================================================================
//   recallforge remind            shows "45 cards due today (~9 min)" if anything is due
//   recallforge remind --install  runs it every day at the chosen time (default 08:45)
//   recallforge remind --uninstall
// Uses what each system already has: osascript (macOS), notify-send (Linux),
// PowerShell (Windows), and the system scheduler (launchd, crontab, schtasks).
// ============================================================================

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getStats } from './core/stats';
import { getLocalUser } from './core/users';

export function reminderText(): string | null {
  const stats = getStats(getLocalUser().id);
  const due = stats.due.learning + stats.due.review + stats.due.new;
  if (due === 0) return null;
  const minutes = stats.workload.minutesToday;
  return `${due} ${due === 1 ? 'tarjeta' : 'tarjetas'} para hoy (~${minutes} min). Dile a tu agente «vamos a repasar».`;
}

export function notify(title: string, message: string): boolean {
  try {
    if (process.platform === 'darwin') {
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execFileSync('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`]);
    } else if (process.platform === 'win32') {
      const esc = (s: string) => s.replace(/'/g, "''");
      const script = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
        '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
        `$t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode('${esc(title)}')) | Out-Null`,
        `$t.GetElementsByTagName('text')[1].AppendChild($t.CreateTextNode('${esc(message)}')) | Out-Null`,
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('RecallForge').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
      ].join('; ');
      execFileSync('powershell', ['-NoProfile', '-Command', script]);
    } else {
      execFileSync('notify-send', ['--app-name=RecallForge', title, message]);
    }
    return true;
  } catch {
    return false;
  }
}

const LAUNCHD_LABEL = 'com.recallforge.remind';
const CRON_MARK = '# recallforge-remind';

function commandLine(cli: string): string[] {
  const env = process.env.RECALLFORGE_DB ? [`RECALLFORGE_DB=${process.env.RECALLFORGE_DB}`] : [];
  return [...env, process.execPath, cli, 'remind'];
}

/** Schedule the reminder every day at hh:mm with the system scheduler. Returns what was done. */
export function installReminder(cli: string, time = '08:45'): string {
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) throw new Error('Usa la hora como HH:MM, por ejemplo 08:45');
  if (process.platform === 'darwin') {
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    const args = [process.execPath, cli, 'remind'].map((a) => `<string>${a}</string>`).join('');
    const env = process.env.RECALLFORGE_DB
      ? `<key>EnvironmentVariables</key><dict><key>RECALLFORGE_DB</key><string>${process.env.RECALLFORGE_DB}</string></dict>`
      : '';
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${LAUNCHD_LABEL}</string>
<key>ProgramArguments</key><array>${args}</array>${env}
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
</dict></plist>
`
    );
    try {
      execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' });
    } catch {
      // not loaded yet
    }
    execFileSync('launchctl', ['load', plist]);
    return `Recordatorio diario a las ${time} (launchd: ${plist}).`;
  }
  if (process.platform === 'win32') {
    execFileSync('schtasks', ['/Create', '/F', '/SC', 'DAILY', '/ST', time, '/TN', 'RecallForge', '/TR', `"${process.execPath}" "${cli}" remind`]);
    return `Recordatorio diario a las ${time} (Programador de tareas: RecallForge).`;
  }
  let current = '';
  try {
    current = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    current = '';
  }
  const lines = current.split('\n').filter((line) => line.trim() && !line.includes(CRON_MARK));
  const display = process.env.DISPLAY ? `DISPLAY=${process.env.DISPLAY} ` : '';
  const bus = process.env.DBUS_SESSION_BUS_ADDRESS ? `DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS} ` : '';
  lines.push(`${minute} ${hour} * * * ${display}${bus}${commandLine(cli).map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')} ${CRON_MARK}`);
  execFileSync('crontab', ['-'], { input: `${lines.join('\n')}\n` });
  return `Recordatorio diario a las ${time} (crontab).`;
}

export function uninstallReminder(): string {
  if (process.platform === 'darwin') {
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    try {
      execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' });
    } catch {
      // already unloaded
    }
    fs.rmSync(plist, { force: true });
  } else if (process.platform === 'win32') {
    try {
      execFileSync('schtasks', ['/Delete', '/F', '/TN', 'RecallForge'], { stdio: 'ignore' });
    } catch {
      // not installed
    }
  } else {
    let current = '';
    try {
      current = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return 'No había recordatorio instalado.';
    }
    const lines = current.split('\n').filter((line) => line.trim() && !line.includes(CRON_MARK));
    execFileSync('crontab', ['-'], { input: lines.length ? `${lines.join('\n')}\n` : '' });
  }
  return 'Recordatorio diario desactivado.';
}
