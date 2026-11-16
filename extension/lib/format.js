import GLib from 'gi://GLib';
import {DEFAULT_ACCENT_HEX, DBUS_SERVICE_DEVEL_INSTANCE_PREFIX} from './constants.js';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export function sanitizeHexColor(raw, fallback = DEFAULT_ACCENT_HEX) {
    if (typeof raw !== 'string')
        return fallback;
    const trimmed = raw.trim();
    return HEX_COLOR_RE.test(trimmed) ? trimmed.slice(0, 7) : fallback;
}

export function hexToRgba(rawHex, alpha = 0.2) {
    const hex = sanitizeHexColor(rawHex);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = Math.max(0, Math.min(1, Number(alpha)));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function formatShortCwd(cwd) {
    if (!cwd)
        return '~';
    const homeDir = GLib.get_home_dir();
    if (homeDir && (cwd === homeDir || cwd.startsWith(`${homeDir}/`)))
        return `~${cwd.slice(homeDir.length)}`;
    return cwd;
}

export function formatIdleDuration(rawSecs) {
    const secs = Math.max(0, Number(rawSecs || 0));
    if (secs < 60)
        return `${secs}s idle`;
    if (secs < 3600)
        return `${Math.floor(secs / 60)}m idle`;
    return `${Math.floor(secs / 3600)}h idle`;
}

export function formatTaskCountdown(dueAtUnix, fallbackRemainingSecs) {
    const nowSec = Math.floor(GLib.get_real_time() / 1_000_000);
    const rem = dueAtUnix > 0
        ? Math.max(0, dueAtUnix - nowSec)
        : Math.max(0, Number(fallbackRemainingSecs || 0));

    if (rem <= 0)
        return 'due now';
    if (rem < 60)
        return `in ${rem}s`;
    if (rem < 3600) {
        const m = Math.floor(rem / 60);
        const s = rem % 60;
        return s > 0 ? `in ${m}m ${s}s` : `in ${m}m`;
    }
    const h = Math.floor(rem / 3600);
    const m = Math.floor((rem % 3600) / 60);
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

export function formatTaskTypeLabel(taskType) {
    if (taskType === 'Command')
        return 'Command';
    if (taskType === 'Query')
        return 'Query';
    return 'Reminder';
}

export function formatCharacterName(raw) {
    if (!raw || typeof raw !== 'string')
        return '';
    return raw
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export function prettifyCharacterSlug(raw) {
    if (!raw || typeof raw !== 'string')
        return '';
    return raw
        .trim()
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export function formatCharacterDuty(raw) {
    if (!raw || typeof raw !== 'string')
        return '';
    const firstLine = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean);
    return firstLine || '';
}

export function formatDetachedProcessName(session) {
    const raw = (session?.foreground_process || '').trim();
    if (!raw) {
        const charName = formatCharacterName(session?.character_name);
        return charName ? `${charName} (AI Agent)` : 'Background Process';
    }
    const colonIdx = raw.indexOf(':');
    if (colonIdx > 0) {
        const prefix = raw.slice(0, colonIdx).trim();
        let rest = raw.slice(colonIdx + 1).trim();
        rest = rest.replace(/^"(.+)"(\s*\(\+\d+\s+more\))?$/, '$1$2');
        return `${formatCharacterName(prefix)}: ${rest}`;
    }
    if (session?.character_name && raw.toLowerCase().startsWith(session.character_name.toLowerCase())) {
        const charName = formatCharacterName(session.character_name);
        return charName + raw.slice(session.character_name.length);
    }
    return raw;
}

export function formatDevInstanceLabel(busName) {
    if (busName.startsWith(DBUS_SERVICE_DEVEL_INSTANCE_PREFIX)) {
        const slug = busName.slice(DBUS_SERVICE_DEVEL_INSTANCE_PREFIX.length);
        return slug ? `Dev Agent (${slug})` : 'Dev Agent';
    }
    return 'Dev Agent';
}

export function isCharacterActive(charInfo) {
    return Boolean(
        charInfo &&
        typeof charInfo.status === 'object' &&
        charInfo.status !== null &&
        'Active' in charInfo.status
    );
}

export function getActivePaneId(charInfo) {
    return isCharacterActive(charInfo) ? charInfo.status.Active.pane_id : null;
}
