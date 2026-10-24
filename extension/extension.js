import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

// ---- constants -----------------------------------------------------------

const D_BUS_SERVICE = 'dev.boxxy.BoxxyAgent';
const AGENT_BINARY   = 'boxxy-agent';
const TERMINAL_BINARY = 'boxxy-terminal';
const AGENT_IFACE    = 'dev.boxxy.BoxxyTerminal.Agent';
const AGENT_PATH     = '/dev/boxxy/Agent';

// zbus converts Rust snake_case to D-Bus PascalCase by default
const METHOD_GET_SNAPSHOT          = 'GetRegistrySnapshot';
const METHOD_REQUEST_FOCUS         = 'RequestFocusPane';
const METHOD_GET_DETACHED          = 'GetDetachedSessions';
const METHOD_RESTORE_DETACHED      = 'RequestRestoreDetached';
const METHOD_TERMINATE_DETACHED    = 'TerminateDetachedSession';
const METHOD_GET_PENDING_TASKS     = 'GetPendingTasks';
const METHOD_CANCEL_PENDING_TASK   = 'CancelPendingTask';
const SIGNAL_CLAIMS_CHANGED        = 'ClaimsChanged';
const SIGNAL_DETACHED_CHANGED      = 'DetachedSessionsChanged';
const SIGNAL_PENDING_TASKS_CHANGED = 'PendingTasksChanged';

const AVATAR_SIZE    = 24;
const COLOR_DOT_SIZE = 12;

// ---- helpers -------------------------------------------------------------

function resolveAgentBinary() {
    const homeDir = GLib.get_home_dir();
    const binPath = GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', 'bin', AGENT_BINARY]);
    if (GLib.file_test(binPath, GLib.FileTest.IS_EXECUTABLE))
        return binPath;

    const nativePath = GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', AGENT_BINARY]);
    if (GLib.file_test(nativePath, GLib.FileTest.IS_EXECUTABLE))
        return nativePath;

    const flatpakPath = GLib.build_filenamev(['/app', 'bin', AGENT_BINARY]);
    if (GLib.file_test(flatpakPath, GLib.FileTest.IS_EXECUTABLE))
        return flatpakPath;

    return AGENT_BINARY;
}

function resolveTerminalCommand() {
    const homeDir = GLib.get_home_dir();
    const binPath = GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', 'bin', TERMINAL_BINARY]);
    if (GLib.file_test(binPath, GLib.FileTest.IS_EXECUTABLE))
        return shellQuote(binPath);

    const localBin = GLib.build_filenamev([homeDir, '.local', 'bin', TERMINAL_BINARY]);
    if (GLib.file_test(localBin, GLib.FileTest.IS_EXECUTABLE))
        return shellQuote(localBin);

    if (GLib.find_program_in_path(TERMINAL_BINARY))
        return TERMINAL_BINARY;

    return 'flatpak run dev.boxxy.BoxxyTerminal';
}

function shellQuote(str) {
    return `'${str.replace(/'/g, "'\\''")}'`;
}

function spawnAgentCommand(subcommand) {
    const binary = resolveAgentBinary();
    const cmdline = `${shellQuote(binary)} ${subcommand}`;
    log(`[boxxy] spawning: ${cmdline}`);

    try {
        const ok = GLib.spawn_command_line_async(cmdline);
        if (!ok)
            log(`[boxxy] failed to launch ${binary} ${subcommand}`);
        else
            log(`[boxxy] ${binary} ${subcommand} launched`);
    } catch (e) {
        logError(e, `[boxxy] error launching ${binary} ${subcommand}`);
    }
}

function launchBoxxyTerminal() {
    const cmdline = `${resolveTerminalCommand()} --present`;
    log(`[boxxy] launching Boxxy Terminal: ${cmdline}`);
    try {
        GLib.spawn_command_line_async(cmdline);
    } catch (e) {
        logError(e, '[boxxy] error launching Boxxy Terminal');
    }
}

function formatShortCwd(cwd) {
    if (!cwd)
        return '~';
    const homeDir = GLib.get_home_dir();
    if (homeDir && cwd.startsWith(homeDir))
        return '~' + cwd.slice(homeDir.length);
    return cwd;
}

function getCharAvatarPath(slug) {
    const configDir = GLib.build_filenamev([
        GLib.get_home_dir(), '.config', 'boxxy-terminal', 'boxxyclaw', 'characters',
    ]);
    return GLib.build_filenamev([configDir, slug, 'AVATAR.png']);
}

function formatTaskCountdown(dueAtUnix, fallbackRemainingSecs) {
    const nowSec = Math.floor(GLib.get_real_time() / 1000000);
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

function formatTaskTypeLabel(taskType) {
    if (taskType === 'Command')
        return 'Command';
    if (taskType === 'Query')
        return 'Query';
    return 'Reminder';
}

function formatCharacterName(raw) {
    if (!raw || typeof raw !== 'string')
        return '';
    return raw
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function formatDetachedProcessName(session) {
    let raw = (session?.foreground_process || '').trim();
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

// ---- extension -----------------------------------------------------------

export default class BoxxyExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._proxy = null;
        this._ownerId = 0;
        this._agentProxy = null;

        this._indicator = null;
        this._panelBox = null;
        this._panelIcon = null;
        this._badgeLabel = null;
        this._statusItem = null;
        this._detachedSection = {};
        this._tasksSection = {};
        this._charSection = {};
        this._toggleItem = null;
        this._restartItem = null;

        this._charSignalId = 0;
        this._detachedSignalId = 0;
        this._tasksSignalId = 0;
        this._menuOpenSignalId = 0;
        this._countdownTimerId = 0;
        this._charActive = false;
        this._currentCatalog = [];
        this._currentDetached = [];
        this._currentTasks = [];

        this._buildIndicator();
        this._watchDaemon();
        this._setupShortcuts();
    }

    disable() {
        this._teardownShortcuts();
        this._unwatchDaemon();
        this._destroyIndicator();
        this._settings = null;
    }

    // -- shortcuts ----------------------------------------------------------

    _setupShortcuts() {
        for (let i = 1; i <= 10; i++) {
            const name = `shortcut-${i}`;
            Main.wm.addKeybinding(
                name,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => this._handleShortcut(i)
            );
        }
    }

    _teardownShortcuts() {
        for (let i = 1; i <= 10; i++) {
            Main.wm.removeKeybinding(`shortcut-${i}`);
        }
    }

    _handleShortcut(index) {
        const slugs = this._settings.get_strv('shortcut-slugs');
        const slug = slugs[index - 1];
        if (!slug)
            return;

        log(`[boxxy] shortcut ${index} triggered for slug: ${slug}`);

        if (!this._currentCatalog) {
            log('[boxxy] shortcut: no catalog available');
            return;
        }

        const char = this._currentCatalog.find(c => c.config.name === slug);
        if (!char) {
            log(`[boxxy] shortcut: character ${slug} not found in catalog`);
            return;
        }

        const isActive =
            typeof char.status === 'object' && char.status !== null && 'Active' in char.status;
        
        if (isActive) {
            const paneId = char.status.Active.pane_id;
            log(`[boxxy] shortcut: focusing character ${slug} (pane=${paneId})`);
            this._requestFocusPane(paneId);
        } else {
            log(`[boxxy] shortcut: character ${slug} is not active`);
        }
    }

    // -- panel indicator ----------------------------------------------------

    _buildIndicator() {
        this._iconOn = new Gio.FileIcon({file: Gio.File.new_for_path(this.path + '/resources/boxxyclaw-symbolic.svg')});
        this._iconOff = new Gio.FileIcon({file: Gio.File.new_for_path(this.path + '/resources/boxxyclaw-off-symbolic.svg')});

        this._panelBox = new St.BoxLayout({
            style_class: 'panel-status-menu-box boxxy-panel-box',
        });

        this._panelIcon = new St.Icon({
            gicon: this._iconOff,
            style_class: 'system-status-icon boxxy-panel-icon',
        });

        this._badgeLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-panel-badge',
            visible: false,
        });

        this._panelBox.add_child(this._panelIcon);
        this._panelBox.add_child(this._badgeLabel);

        this._indicator = new PanelMenu.Button(0.5, 'Boxxy Terminal', false);
        this._indicator.add_child(this._panelBox);

        const menu = this._indicator.menu;
        this._menuOpenSignalId = menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                if (this._proxy?.g_name_owner) {
                    this._fetchDetachedSessions();
                    this._fetchPendingTasks();
                }
                this._syncCountdownTimer();
            } else {
                this._stopCountdownTimer();
            }
        });

        // Status line (index 0)
        this._statusItem = new PopupMenu.PopupMenuItem('', {});
        this._statusItem.setOrnament(PopupMenu.Ornament.NONE);
        this._statusItem.reactive = false;
        this._statusItem.label.add_style_class_name('boxxy-status-label');
        menu.addMenuItem(this._statusItem);

        // Separator before detached background shells (index 1)
        this._detachedSection.headerSep = new PopupMenu.PopupSeparatorMenuItem();
        this._detachedSection.headerSep.visible = false;
        menu.addMenuItem(this._detachedSection.headerSep);

        // Detached background shells header row (index 2)
        this._detachedSection.headerItem = this._createDetachedHeaderItem();
        this._detachedSection.headerItem.visible = false;
        menu.addMenuItem(this._detachedSection.headerItem);

        // Detached items start at index 3
        this._detachedSection.insertAt = 3;
        this._detachedSection.items = [];

        // Separator before pending reminders
        this._tasksSection.headerSep = new PopupMenu.PopupSeparatorMenuItem();
        this._tasksSection.headerSep.visible = false;
        menu.addMenuItem(this._tasksSection.headerSep);

        // Pending reminders header
        this._tasksSection.header = new PopupMenu.PopupMenuItem('');
        this._tasksSection.header.setOrnament(PopupMenu.Ornament.NONE);
        this._tasksSection.header.reactive = false;
        this._tasksSection.header.label.add_style_class_name('boxxy-char-header');
        this._tasksSection.header.visible = false;
        menu.addMenuItem(this._tasksSection.header);

        this._tasksSection.items = [];
        this._tasksSection.countdownLabels = [];

        // Separator before characters
        this._charSection.headerSep = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this._charSection.headerSep);

        // Characters header
        this._charSection.header = new PopupMenu.PopupMenuItem('');
        this._charSection.header.setOrnament(PopupMenu.Ornament.NONE);
        this._charSection.header.reactive = false;
        this._charSection.header.label.add_style_class_name('boxxy-char-header');
        this._charSection.header.visible = false;
        menu.addMenuItem(this._charSection.header);

        // Character items list
        this._charSection.items = [];

        // Separator before actions
        this._charSection.actionSep = new PopupMenu.PopupSeparatorMenuItem();
        this._charSection.actionSep.visible = false;
        menu.addMenuItem(this._charSection.actionSep);

        // Actions
        this._toggleItem = new PopupMenu.PopupMenuItem('');
        this._toggleItem.connect('activate', () => {
            const running = Boolean(this._proxy.g_name_owner);
            spawnAgentCommand(running ? 'stop' : 'start');
        });
        menu.addMenuItem(this._toggleItem);

        this._restartItem = new PopupMenu.PopupMenuItem('Restart Agent');
        this._restartItem.connect('activate', () => spawnAgentCommand('restart'));
        menu.addMenuItem(this._restartItem);

        // Separator before settings
        this._settingsSep = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this._settingsSep);

        // Settings
        this._settingsItem = new PopupMenu.PopupMenuItem('Extension Settings');
        this._settingsItem.connect('activate', () => this.openPreferences());
        menu.addMenuItem(this._settingsItem);

        Main.panel.addToStatusArea('boxxy-terminal', this._indicator);

        this._updateStatus(false);
    }

    _destroyIndicator() {
        this._stopCountdownTimer();
        if (this._menuOpenSignalId && this._indicator?.menu) {
            this._indicator.menu.disconnect(this._menuOpenSignalId);
            this._menuOpenSignalId = 0;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._panelBox = null;
        this._panelIcon = null;
        this._badgeLabel = null;
        this._detachedSection.items = [];
        this._detachedSection.headerItem = null;
        this._detachedSection.headerSep = null;
        this._tasksSection.items = [];
        this._tasksSection.countdownLabels = [];
        this._tasksSection.header = null;
        this._tasksSection.headerSep = null;
        this._charSection.items = [];
        this._charSection.header = null;
        this._charSection.headerSep = null;
        this._charSection.actionSep = null;
        this._settingsSep = null;
        this._settingsItem = null;
    }

    // -- daemon watcher -----------------------------------------------------

    _watchDaemon() {
        this._proxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: D_BUS_SERVICE,
            g_object_path: AGENT_PATH,
            g_interface_name: 'org.freedesktop.DBus.Peer',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        });

        this._proxy.init_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (_source, result) => {
                try {
                    this._proxy.init_finish(result);
                } catch (_e) {}
                this._updateStatus(Boolean(this._proxy.g_name_owner));
                this._ownerId = this._proxy.connect(
                    'notify::g-name-owner',
                    () => this._updateStatus(Boolean(this._proxy.g_name_owner)),
                );
            },
        );
    }

    _unwatchDaemon() {
        this._stopCountdownTimer();
        if (this._ownerId && this._proxy) {
            this._proxy.disconnect(this._ownerId);
            this._ownerId = 0;
        }
        this._proxy = null;
        this._agentProxy = null;
        this._unsubscribeCharacters();
        this._unsubscribeDetachedSessions();
        this._unsubscribePendingTasks();
    }

    // -- status updates -----------------------------------------------------

    _updateStatus(running) {
        if (!this._statusItem || !this._toggleItem || !this._restartItem)
            return;

        if (running) {
            this._panelIcon.set_gicon(this._iconOn);
            this._statusItem.label.set_text('Boxxy Agent — Running');
            this._statusItem.remove_style_class_name('boxxy-status-stopped');
            this._statusItem.add_style_class_name('boxxy-status-running');
            this._toggleItem.label.set_text('Stop Agent');
            this._onDaemonStarted();
        } else {
            this._panelIcon.set_gicon(this._iconOff);
            this._statusItem.label.set_text('Boxxy Agent — Stopped');
            this._statusItem.remove_style_class_name('boxxy-status-running');
            this._statusItem.add_style_class_name('boxxy-status-stopped');
            this._toggleItem.label.set_text('Start Agent');
            this._onDaemonStopped();
        }

        this._restartItem.visible = running;
    }

    _onDaemonStarted() {
        if (this._charActive) {
            log('[boxxy] chars: already populated');
            return;
        }
        log('[boxxy] daemon started, fetching registry, detached sessions, and pending tasks');

        this._ensureAgentProxy();
        this._fetchRegistry();
        this._fetchDetachedSessions();
        this._fetchPendingTasks();
        this._subscribeCharacters();
        this._subscribeDetachedSessions();
        this._subscribePendingTasks();
    }

    _onDaemonStopped() {
        log('[boxxy] daemon stopped, clearing state');
        this._stopCountdownTimer();
        this._agentProxy = null;
        this._unsubscribeCharacters();
        this._unsubscribeDetachedSessions();
        this._unsubscribePendingTasks();
        this._clearDetachedItems();
        this._clearPendingTaskItems();
        this._clearCharacterItems();
        this._charActive = false;
    }

    // -- agent proxy (for focus & restore requests) -------------------------

    _ensureAgentProxy() {
        if (this._agentProxy)
            return;

        this._agentProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: D_BUS_SERVICE,
            g_object_path: AGENT_PATH,
            g_interface_name: AGENT_IFACE,
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        });

        this._agentProxy.init_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (proxy, result) => {
                try {
                    proxy.init_finish(result);
                    log('[boxxy] agent proxy ready');
                } catch (e) {
                    logError(e, '[boxxy] agent proxy init failed');
                    this._agentProxy = null;
                }
            },
        );
    }

    _focusBoxxyWindow() {
        // Try known application IDs first (fast path).
        const appSystem = Shell.AppSystem.get_default();
        const candidateIds = [
            'dev.boxxy.BoxxyTerminal',
            'dev.boxxy.BoxxyTerminal.desktop',
            'boxxy-terminal',
            'boxxy-terminal.desktop',
            'com.github.queer.boxxy',
            'com.github.queer.BoxxyTerminal',
        ];

        for (const id of candidateIds) {
            const app = appSystem.lookup_app(id);
            if (app) {
                const windows = app.get_windows();
                if (windows.length > 0) {
                    log(`[boxxy] focus: found app "${id}", activating`);
                    Main.activateWindow(windows[0]);
                    return true;
                }
            }
        }

        // Fallback: scan every window for a matching class or title.
        const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
        for (const win of allWindows) {
            const wmClass = win.get_wm_class?.() ?? '';
            const title = win.get_title?.() ?? '';
            const lower = (wmClass + title).toLowerCase();
            if (lower.includes('boxxy')) {
                log(`[boxxy] focus: found by scan (class="${wmClass}" title="${title}"), activating`);
                Main.activateWindow(win);
                return true;
            }
        }

        log('[boxxy] focus: could not find Boxxy Terminal window');
        return false;
    }

    _requestFocusPane(paneId) {
        const hasOpenWindow = this._focusBoxxyWindow();

        if (!this._agentProxy || !this._agentProxy.g_name_owner) {
            log('[boxxy] focus: agent proxy not ready');
            return;
        }

        try {
            const param = new GLib.Variant('(s)', [paneId]);
            this._agentProxy.call(
                METHOD_REQUEST_FOCUS,
                param,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_proxy, result) => {
                    try {
                        _proxy.call_finish(result);
                        log('[boxxy] focus: RequestFocusPane sent for ' + paneId);
                        if (!hasOpenWindow)
                            launchBoxxyTerminal();
                        this._fetchDetachedSessions();
                    } catch (e) {
                        logError(e, '[boxxy] focus: RequestFocusPane failed');
                    }
                },
            );
        } catch (e) {
            logError(e, '[boxxy] focus: error building RequestFocusPane call');
        }
    }

    _restoreDetachedSession(pid) {
        if (!this._agentProxy || !this._agentProxy.g_name_owner) {
            log('[boxxy] restore: agent proxy not ready');
            return;
        }

        const hasOpenWindow = this._focusBoxxyWindow();

        try {
            const param = new GLib.Variant('(u)', [pid]);
            this._agentProxy.call(
                METHOD_RESTORE_DETACHED,
                param,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_proxy, result) => {
                    try {
                        _proxy.call_finish(result);
                        log(`[boxxy] restore: RequestRestoreDetached(${pid}) sent`);
                        if (!hasOpenWindow)
                            launchBoxxyTerminal();
                        this._fetchDetachedSessions();
                    } catch (e) {
                        logError(e, '[boxxy] restore: RequestRestoreDetached failed');
                    }
                },
            );
        } catch (e) {
            logError(e, '[boxxy] restore: error calling RequestRestoreDetached');
        }
    }

    _terminateDetachedSession(pid) {
        if (!this._agentProxy || !this._agentProxy.g_name_owner) {
            log('[boxxy] terminate: agent proxy not ready');
            return;
        }

        try {
            const param = new GLib.Variant('(u)', [pid]);
            this._agentProxy.call(
                METHOD_TERMINATE_DETACHED,
                param,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_proxy, result) => {
                    try {
                        _proxy.call_finish(result);
                        log(`[boxxy] terminate: TerminateDetachedSession(${pid}) sent`);
                        this._fetchDetachedSessions();
                        this._fetchPendingTasks();
                    } catch (e) {
                        logError(e, '[boxxy] terminate: TerminateDetachedSession failed');
                    }
                },
            );
        } catch (e) {
            logError(e, '[boxxy] terminate: error calling TerminateDetachedSession');
        }
    }

    _cancelPendingTask(paneId, taskId) {
        if (!this._agentProxy || !this._agentProxy.g_name_owner) {
            log('[boxxy] cancel task: agent proxy not ready');
            return;
        }

        try {
            const param = new GLib.Variant('(ss)', [String(paneId), String(taskId)]);
            this._agentProxy.call(
                METHOD_CANCEL_PENDING_TASK,
                param,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_proxy, result) => {
                    try {
                        _proxy.call_finish(result);
                        log(`[boxxy] cancel task: CancelPendingTask(${paneId}, ${taskId}) sent`);
                        this._fetchPendingTasks();
                        this._fetchDetachedSessions();
                    } catch (e) {
                        logError(e, '[boxxy] cancel task: CancelPendingTask failed');
                    }
                },
            );
        } catch (e) {
            logError(e, '[boxxy] cancel task: error calling CancelPendingTask');
        }
    }

    // -- D-Bus calls & signals ----------------------------------------------

    _fetchRegistry() {
        const agentProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: D_BUS_SERVICE,
            g_object_path: AGENT_PATH,
            g_interface_name: AGENT_IFACE,
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        });

        agentProxy.init_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (proxy, result) => {
                try {
                    proxy.init_finish(result);
                    const reply = proxy.call_sync(
                        METHOD_GET_SNAPSHOT,
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                    );

                    if (!reply)
                        return;

                    const [json] = reply.deepUnpack();
                    this._applyRegistrySnapshot(JSON.parse(json));
                } catch (e) {
                    logError(e, '[boxxy] chars: ' + METHOD_GET_SNAPSHOT + ' error');
                }
            },
        );
    }

    _fetchDetachedSessions() {
        const agentProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: D_BUS_SERVICE,
            g_object_path: AGENT_PATH,
            g_interface_name: AGENT_IFACE,
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        });

        agentProxy.init_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (proxy, result) => {
                try {
                    proxy.init_finish(result);
                    proxy.call(
                        METHOD_GET_DETACHED,
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (_p, callRes) => {
                            try {
                                const reply = _p.call_finish(callRes);
                                if (!reply)
                                    return;
                                const [json] = reply.deepUnpack();
                                this._applyDetachedSessions(JSON.parse(json || '[]'));
                            } catch (e) {
                                logError(e, '[boxxy] detached: ' + METHOD_GET_DETACHED + ' call error');
                            }
                        },
                    );
                } catch (e) {
                    logError(e, '[boxxy] detached: proxy init error');
                }
            },
        );
    }

    _subscribeCharacters() {
        if (this._charSignalId)
            return;

        this._charSignalId = Gio.DBus.session.signal_subscribe(
            D_BUS_SERVICE,
            AGENT_IFACE,
            SIGNAL_CLAIMS_CHANGED,
            AGENT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                try {
                    const [json] = params.deepUnpack();
                    this._applyRegistrySnapshot(JSON.parse(json));
                } catch (e) {
                    logError(e, '[boxxy] chars: ' + SIGNAL_CLAIMS_CHANGED + ' error');
                }
            },
        );
    }

    _unsubscribeCharacters() {
        if (this._charSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._charSignalId);
            this._charSignalId = 0;
        }
    }

    _subscribeDetachedSessions() {
        if (this._detachedSignalId)
            return;

        this._detachedSignalId = Gio.DBus.session.signal_subscribe(
            D_BUS_SERVICE,
            AGENT_IFACE,
            SIGNAL_DETACHED_CHANGED,
            AGENT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                try {
                    const [json] = params.deepUnpack();
                    this._applyDetachedSessions(JSON.parse(json || '[]'));
                } catch (e) {
                    logError(e, '[boxxy] detached: ' + SIGNAL_DETACHED_CHANGED + ' error');
                }
            },
        );
    }

    _unsubscribeDetachedSessions() {
        if (this._detachedSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._detachedSignalId);
            this._detachedSignalId = 0;
        }
    }

    _fetchPendingTasks() {
        const agentProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: D_BUS_SERVICE,
            g_object_path: AGENT_PATH,
            g_interface_name: AGENT_IFACE,
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        });

        agentProxy.init_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (proxy, result) => {
                try {
                    proxy.init_finish(result);
                    proxy.call(
                        METHOD_GET_PENDING_TASKS,
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (_p, callRes) => {
                            try {
                                const reply = _p.call_finish(callRes);
                                if (!reply)
                                    return;
                                const [json] = reply.deepUnpack();
                                this._applyPendingTasks(JSON.parse(json || '[]'));
                            } catch (e) {
                                logError(e, '[boxxy] tasks: ' + METHOD_GET_PENDING_TASKS + ' call error');
                            }
                        },
                    );
                } catch (e) {
                    logError(e, '[boxxy] tasks: proxy init error');
                }
            },
        );
    }

    _subscribePendingTasks() {
        if (this._tasksSignalId)
            return;

        this._tasksSignalId = Gio.DBus.session.signal_subscribe(
            D_BUS_SERVICE,
            AGENT_IFACE,
            SIGNAL_PENDING_TASKS_CHANGED,
            AGENT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                try {
                    const [json] = params.deepUnpack();
                    this._applyPendingTasks(JSON.parse(json || '[]'));
                } catch (e) {
                    logError(e, '[boxxy] tasks: ' + SIGNAL_PENDING_TASKS_CHANGED + ' error');
                }
            },
        );
    }

    _unsubscribePendingTasks() {
        if (this._tasksSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._tasksSignalId);
            this._tasksSignalId = 0;
        }
    }

    _updateBadge() {
        if (!this._badgeLabel)
            return;

        const detachedList = Array.isArray(this._currentDetached) ? this._currentDetached : [];
        const tasksList = Array.isArray(this._currentTasks) ? this._currentTasks : [];
        const detachedWithoutTasks = detachedList.filter(
            s => !(Number(s.pending_task_count || 0) > 0)
        ).length;
        const totalCount = detachedWithoutTasks + tasksList.length;
        const anyWaiting = detachedList.some(s => Boolean(s.waiting_for_input));

        if (totalCount > 0) {
            this._badgeLabel.set_text(`${totalCount}`);
            this._badgeLabel.visible = true;
            if (anyWaiting)
                this._badgeLabel.add_style_class_name('boxxy-panel-badge-warning');
            else
                this._badgeLabel.remove_style_class_name('boxxy-panel-badge-warning');
        } else {
            this._badgeLabel.visible = false;
            this._badgeLabel.remove_style_class_name('boxxy-panel-badge-warning');
        }
    }

    _syncCountdownTimer() {
        const isMenuOpen = Boolean(this._indicator?.menu?.isOpen);
        const hasTasks = Array.isArray(this._currentTasks) && this._currentTasks.length > 0;
        if (!isMenuOpen || !hasTasks) {
            this._stopCountdownTimer();
            return;
        }
        if (this._countdownTimerId)
            return;

        this._countdownTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            1,
            () => {
                if (!this._indicator?.menu?.isOpen || !this._currentTasks?.length) {
                    this._countdownTimerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                for (const entry of this._tasksSection.countdownLabels || []) {
                    const {subLabel, task} = entry;
                    if (subLabel) {
                        const typeLabel = formatTaskTypeLabel(task.task_type);
                        const countdown = formatTaskCountdown(task.due_at_unix, task.remaining_secs);
                        const bgSuffix = task.is_detached ? ' • Background' : '';
                        subLabel.set_text(`${typeLabel} • ${countdown}${bgSuffix}`);
                    }
                }
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _stopCountdownTimer() {
        if (this._countdownTimerId) {
            GLib.Source.remove(this._countdownTimerId);
            this._countdownTimerId = 0;
        }
    }

    // -- detached background shells UI --------------------------------------

    _createDetachedHeaderItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const titleLabel = new St.Label({
            text: 'Background Shells',
            style_class: 'boxxy-char-header',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._detachedSection.headerTitle = titleLabel;
        item.add_child(titleLabel);

        const restoreAllBtn = new St.Button({
            label: 'Restore All',
            style_class: 'boxxy-action-btn boxxy-restore-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        restoreAllBtn.connect('clicked', () => {
            this._indicator?.menu?.close();
            this._restoreDetachedSession(0);
        });
        item.add_child(restoreAllBtn);

        const killAllBtn = new St.Button({
            label: 'Kill All',
            style_class: 'boxxy-action-btn boxxy-kill-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        killAllBtn.connect('clicked', () => {
            this._terminateDetachedSession(0);
        });
        item.add_child(killAllBtn);

        return item;
    }

    _clearDetachedItems() {
        for (const item of this._detachedSection.items || [])
            item.destroy();
        this._detachedSection.items = [];
        this._currentDetached = [];

        if (this._detachedSection.headerItem)
            this._detachedSection.headerItem.visible = false;
        if (this._detachedSection.headerSep)
            this._detachedSection.headerSep.visible = false;
        this._updateBadge();
    }

    _applyDetachedSessions(sessions) {
        if (!this._proxy?.g_name_owner)
            return;

        const list = Array.isArray(sessions) ? sessions : [];
        this._currentDetached = list;

        for (const item of this._detachedSection.items || [])
            item.destroy();
        this._detachedSection.items = [];

        const count = list.length;
        this._updateBadge();

        if (this._detachedSection.headerSep)
            this._detachedSection.headerSep.visible = count > 0;
        if (this._detachedSection.headerItem) {
            this._detachedSection.headerItem.visible = count > 0;
            if (count > 0 && this._detachedSection.headerTitle)
                this._detachedSection.headerTitle.set_text(`Background Shells (${count})`);
        }

        if (count === 0)
            return;

        const items = [];
        for (const s of list) {
            items.push(this._createDetachedItem(s));
        }

        const menuItems = this._indicator.menu._getMenuItems();
        const headerIdx = menuItems.indexOf(this._detachedSection.headerItem);
        const insertAt = headerIdx >= 0 ? headerIdx + 1 : this._detachedSection.insertAt;

        for (let i = items.length - 1; i >= 0; i--)
            this._indicator.menu.addMenuItem(items[i], insertAt);

        this._detachedSection.items = items;
    }

    _createDetachedItem(session) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        item.add_style_class_name('boxxy-detached-item');

        const charObj = (this._currentCatalog || []).find(
            c => (session.character_id && c.config.id === session.character_id) ||
                 (session.character_slug && c.config.name === session.character_slug),
        );
        const slug = session.character_slug || charObj?.config?.name || '';
        const avatarPath = slug ? getCharAvatarPath(slug) : '';

        if (avatarPath && GLib.file_test(avatarPath, GLib.FileTest.EXISTS)) {
            const avatarFile = Gio.File.new_for_path(avatarPath);
            const avatar = new St.Icon({
                gicon: new Gio.FileIcon({file: avatarFile}),
                style_class: 'boxxy-char-avatar',
                icon_size: AVATAR_SIZE,
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(avatar);
        } else {
            const termIcon = new St.Icon({
                icon_name: 'utilities-terminal-symbolic',
                style_class: 'boxxy-detached-icon',
                icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(termIcon);
        }

        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const procName = formatDetachedProcessName(session);
        const titleText = session.waiting_for_input
            ? `${procName} — Waiting for input`
            : procName;
        const titleLabel = new St.Label({
            text: titleText,
            style_class: session.waiting_for_input
                ? 'boxxy-detached-title boxxy-detached-title-warning'
                : 'boxxy-detached-title',
        });

        const shortCwd = formatShortCwd(session.cwd);
        const idleSecs = Number(session.idle_secs || 0);
        const idleStr = idleSecs < 60
            ? `${idleSecs}s idle`
            : idleSecs < 3600
                ? `${Math.floor(idleSecs / 60)}m idle`
                : `${Math.floor(idleSecs / 3600)}h idle`;

        let subText = `${shortCwd} • ${idleStr}`;
        const charName = formatCharacterName(session.character_name);
        if (charName && !titleText.toLowerCase().startsWith(charName.toLowerCase()))
            subText += ` • ${charName}`;
        if (session.pending_task_count > 0) {
            const rLabel = session.pending_task_count === 1 ? 'reminder' : 'reminders';
            subText += ` • ${session.pending_task_count} ${rLabel}`;
        }

        const subLabel = new St.Label({
            text: subText,
            style_class: 'boxxy-detached-subtitle',
        });

        textBox.add_child(titleLabel);
        textBox.add_child(subLabel);
        item.add_child(textBox);

        const restoreBtn = new St.Button({
            label: 'Restore',
            style_class: 'boxxy-action-btn boxxy-restore-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        restoreBtn.connect('clicked', () => {
            this._indicator?.menu?.close();
            this._restoreDetachedSession(session.pid);
        });
        item.add_child(restoreBtn);

        const killBtn = new St.Button({
            label: 'Kill',
            style_class: 'boxxy-action-btn boxxy-kill-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        killBtn.connect('clicked', () => {
            this._terminateDetachedSession(session.pid);
        });
        item.add_child(killBtn);

        return item;
    }

    // -- pending reminders / tasks UI ---------------------------------------

    _clearPendingTaskItems() {
        this._stopCountdownTimer();
        for (const item of this._tasksSection.items || [])
            item.destroy();
        this._tasksSection.items = [];
        this._tasksSection.countdownLabels = [];
        this._currentTasks = [];

        if (this._tasksSection.header)
            this._tasksSection.header.visible = false;
        if (this._tasksSection.headerSep)
            this._tasksSection.headerSep.visible = false;
        this._updateBadge();
    }

    _applyPendingTasks(tasks) {
        if (!this._proxy?.g_name_owner)
            return;

        const list = Array.isArray(tasks) ? tasks : [];
        this._currentTasks = list;

        for (const item of this._tasksSection.items || [])
            item.destroy();
        this._tasksSection.items = [];
        this._tasksSection.countdownLabels = [];

        const count = list.length;
        this._updateBadge();

        if (this._tasksSection.headerSep)
            this._tasksSection.headerSep.visible = count > 0;
        if (this._tasksSection.header) {
            this._tasksSection.header.visible = count > 0;
            if (count > 0)
                this._tasksSection.header.label.set_text(`Pending Reminders (${count})`);
        }

        if (count === 0) {
            this._stopCountdownTimer();
            return;
        }

        const items = [];
        for (const t of list) {
            items.push(this._createPendingTaskItem(t));
        }

        const menuItems = this._indicator.menu._getMenuItems();
        const headerIdx = menuItems.indexOf(this._tasksSection.header);
        const insertAt = headerIdx >= 0 ? headerIdx + 1 : 3;

        for (let i = items.length - 1; i >= 0; i--)
            this._indicator.menu.addMenuItem(items[i], insertAt);

        this._tasksSection.items = items;
        this._syncCountdownTimer();
    }

    _createPendingTaskItem(task) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        item.add_style_class_name('boxxy-detached-item');

        const charObj = (this._currentCatalog || []).find(
            c => c.config.id === task.character_id || c.config.name === task.character_slug,
        );
        const slug = task.character_slug || charObj?.config?.name || '';
        const color = charObj?.config?.color || '#a855f7';
        const avatarPath = slug ? getCharAvatarPath(slug) : '';

        if (avatarPath && GLib.file_test(avatarPath, GLib.FileTest.EXISTS)) {
            const avatarFile = Gio.File.new_for_path(avatarPath);
            const avatar = new St.Icon({
                gicon: new Gio.FileIcon({file: avatarFile}),
                style_class: 'boxxy-char-avatar',
                icon_size: AVATAR_SIZE,
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(avatar);
        } else {
            item.add_child(this._createColorDot(color));
        }

        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const charName = formatCharacterName(task.character_name) || 'AI Agent';
        const payload = (task.payload || 'Scheduled Reminder').trim();
        const titleLabel = new St.Label({
            text: `${charName}: ${payload}`,
            style_class: 'boxxy-detached-title',
        });

        const typeLabel = formatTaskTypeLabel(task.task_type);
        const countdown = formatTaskCountdown(task.due_at_unix, task.remaining_secs);
        const bgSuffix = task.is_detached ? ' • Background' : '';

        const subLabel = new St.Label({
            text: `${typeLabel} • ${countdown}${bgSuffix}`,
            style_class: 'boxxy-detached-subtitle',
        });
        this._tasksSection.countdownLabels.push({subLabel, task});

        textBox.add_child(titleLabel);
        textBox.add_child(subLabel);
        item.add_child(textBox);

        const focusLabel = task.is_detached ? 'Restore' : 'Focus';
        const focusBtn = new St.Button({
            label: focusLabel,
            style_class: 'boxxy-action-btn boxxy-restore-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        focusBtn.connect('clicked', () => {
            this._indicator?.menu?.close();
            if (task.is_detached && task.pid) {
                this._restoreDetachedSession(task.pid);
            } else if (task.pane_id) {
                this._requestFocusPane(task.pane_id);
            }
        });
        item.add_child(focusBtn);

        const cancelBtn = new St.Button({
            label: 'Cancel',
            style_class: 'boxxy-action-btn boxxy-kill-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        cancelBtn.connect('clicked', () => {
            this._cancelPendingTask(task.pane_id, task.id);
        });
        item.add_child(cancelBtn);

        return item;
    }

    // -- snapshot application -----------------------------------------------

    _applyRegistrySnapshot(snapshot) {
        if (!this._proxy?.g_name_owner)
            return;

        const catalog = snapshot.catalog || [];
        this._currentCatalog = catalog;
        this._charActive = true;
        this._rebuildCharacterItems(catalog);
    }

    // -- character menu items -----------------------------------------------

    _clearCharacterItems() {
        for (const item of this._charSection.items)
            item.destroy();
        this._charSection.items = [];

        if (this._charSection.header)
            this._charSection.header.visible = false;
        if (this._charSection.actionSep)
            this._charSection.actionSep.visible = false;
    }

    _rebuildCharacterItems(catalog) {
        for (const item of this._charSection.items)
            item.destroy();
        this._charSection.items = [];

        const hasCharacters = catalog.length > 0;

        if (this._charSection.header) {
            this._charSection.header.visible = hasCharacters;
            if (hasCharacters)
                this._charSection.header.label.set_text(`Characters (${catalog.length})`);
        }
        if (this._charSection.actionSep)
            this._charSection.actionSep.visible = hasCharacters;

        if (!hasCharacters)
            return;

        const items = [];
        for (const info of catalog) {
            const cfg = info.config;
            const isActive =
                typeof info.status === 'object' && info.status !== null && 'Active' in info.status;
            const paneId = isActive ? info.status.Active.pane_id : null;

            const item = this._createCharacterItem(cfg, isActive, paneId, info.has_avatar);
            items.push(item);
        }

        // Compute dynamic insertion index right after the Characters header item
        const menuItems = this._indicator.menu._getMenuItems();
        const headerIdx = menuItems.indexOf(this._charSection.header);
        const insertAt = headerIdx >= 0 ? headerIdx + 1 : 3;

        for (let i = items.length - 1; i >= 0; i--)
            this._indicator.menu.addMenuItem(items[i], insertAt);

        this._charSection.items = items;
    }

    _createCharacterItem(cfg, isActive, paneId, hasAvatar) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: isActive,
            can_focus: isActive,
        });
        item.add_style_class_name('boxxy-char-item');
        if (isActive)
            item.add_style_class_name('boxxy-char-item-active');

        if (hasAvatar) {
            const avatarPath = getCharAvatarPath(cfg.name);
            if (GLib.file_test(avatarPath, GLib.FileTest.EXISTS)) {
                const avatarFile = Gio.File.new_for_path(avatarPath);
                const avatar = new St.Icon({
                    gicon: new Gio.FileIcon({file: avatarFile}),
                    style_class: 'boxxy-char-avatar',
                    icon_size: AVATAR_SIZE,
                });
                item.add_child(avatar);
            } else {
                item.add_child(this._createColorDot(cfg.color));
            }
        } else {
            item.add_child(this._createColorDot(cfg.color));
        }

        const nameLabel = new St.Label({
            text: formatCharacterName(cfg.display_name || cfg.name),
            style_class: 'boxxy-char-name',
        });
        item.add_child(nameLabel);

        const spacer = new St.Bin({ x_expand: true });
        item.add_child(spacer);

        const statusLabel = new St.Label({
            text: isActive ? 'In Use' : 'Available',
            style_class: isActive
                ? 'boxxy-char-status-active'
                : 'boxxy-char-status-idle',
        });
        item.add_child(statusLabel);

        if (isActive && paneId) {
            item.connect('activate', () => {
                this._requestFocusPane(paneId);
            });
        }

        return item;
    }

    _createColorDot(hexColor) {
        const dot = new St.Bin({
            style_class: 'boxxy-color-dot',
            style: `background-color: ${hexColor};`,
            width: COLOR_DOT_SIZE,
            height: COLOR_DOT_SIZE,
        });
        return dot;
    }
}
