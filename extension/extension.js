import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

// ---- constants -----------------------------------------------------------

const D_BUS_SERVICE = 'dev.boxxy.BoxxyAgent';
const AGENT_BINARY   = 'boxxy-agent';
const AGENT_IFACE    = 'dev.boxxy.BoxxyTerminal.Agent';
const AGENT_PATH     = '/dev/boxxy/Agent';

// zbus converts Rust snake_case to D-Bus PascalCase by default
const METHOD_GET_SNAPSHOT    = 'GetRegistrySnapshot';
const METHOD_REQUEST_FOCUS   = 'RequestFocusPane';
const SIGNAL_CLAIMS_CHANGED  = 'ClaimsChanged';

const AVATAR_SIZE    = 24;
const COLOR_DOT_SIZE = 12;

// ---- helpers -------------------------------------------------------------

function resolveAgentBinary() {
    const homeDir = GLib.get_home_dir();
    const nativePath = GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', AGENT_BINARY]);
    if (GLib.file_test(nativePath, GLib.FileTest.IS_EXECUTABLE))
        return nativePath;

    const flatpakPath = GLib.build_filenamev(['/app', 'bin', AGENT_BINARY]);
    if (GLib.file_test(flatpakPath, GLib.FileTest.IS_EXECUTABLE))
        return flatpakPath;

    return AGENT_BINARY;
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

function getCharAvatarPath(slug) {
    const configDir = GLib.build_filenamev([
        GLib.get_home_dir(), '.config', 'boxxy-terminal', 'boxxyclaw', 'characters',
    ]);
    return GLib.build_filenamev([configDir, slug, 'AVATAR.png']);
}

// ---- extension -----------------------------------------------------------

export default class BoxxyExtension extends Extension {
    enable() {
        this._proxy = null;
        this._ownerId = 0;
        this._agentProxy = null;

        this._indicator = null;
        this._statusItem = null;
        this._charSection = {};
        this._toggleItem = null;
        this._restartItem = null;

        this._charSignalId = 0;
        this._charActive = false;

        this._buildIndicator();
        this._watchDaemon();
    }

    disable() {
        this._unwatchDaemon();
        this._destroyIndicator();
    }

    // -- panel indicator ----------------------------------------------------

    _buildIndicator() {
        this._iconOn = new Gio.FileIcon({file: Gio.File.new_for_path(this.path + '/resources/boxxyclaw-symbolic.svg')});
        this._iconOff = new Gio.FileIcon({file: Gio.File.new_for_path(this.path + '/resources/boxxyclaw-off-symbolic.svg')});

        this._panelIcon = new St.Icon({
            gicon: this._iconOff,
            style_class: 'system-status-icon boxxy-panel-icon',
        });

        this._indicator = new PanelMenu.Button(0.5, 'Boxxy Terminal', false);
        this._indicator.add_child(this._panelIcon);

        const menu = this._indicator.menu;

        // Status line (index 0)
        this._statusItem = new PopupMenu.PopupMenuItem('', {});
        this._statusItem.setOrnament(PopupMenu.Ornament.NONE);
        this._statusItem.reactive = false;
        this._statusItem.label.add_style_class_name('boxxy-status-label');
        menu.addMenuItem(this._statusItem);

        // Separator before characters (index 1)
        this._charSection.headerSep = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this._charSection.headerSep);

        // Characters header (index 2)
        this._charSection.header = new PopupMenu.PopupMenuItem('');
        this._charSection.header.setOrnament(PopupMenu.Ornament.NONE);
        this._charSection.header.reactive = false;
        this._charSection.header.label.add_style_class_name('boxxy-char-header');
        this._charSection.header.visible = false;
        menu.addMenuItem(this._charSection.header);

        // Character items go here (index 3)
        this._charSection.insertAt = 3;
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

        Main.panel.addToStatusArea('boxxy-terminal', this._indicator);

        this._updateStatus(false);
    }

    _destroyIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._charSection.items = [];
        this._charSection.header = null;
        this._charSection.headerSep = null;
        this._charSection.actionSep = null;
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
        if (this._ownerId && this._proxy) {
            this._proxy.disconnect(this._ownerId);
            this._ownerId = 0;
        }
        this._proxy = null;
        this._agentProxy = null;
        this._unsubscribeCharacters();
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
        log('[boxxy] chars: daemon started, fetching registry');

        this._ensureAgentProxy();
        this._fetchRegistry();
        this._subscribeCharacters();
    }

    _onDaemonStopped() {
        log('[boxxy] chars: daemon stopped, clearing');
        this._agentProxy = null;
        this._unsubscribeCharacters();
        this._clearCharacterItems();
        this._charActive = false;
    }

    // -- agent proxy (for focus requests) -----------------------------------

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
                    log('[boxxy] agent proxy ready for focus requests');
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
        // Activate the Boxxy Terminal window first — on Wayland the daemon
        // cannot steal focus, but the Shell extension can push the window
        // to the foreground directly.
        this._focusBoxxyWindow();

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
                    } catch (e) {
                        logError(e, '[boxxy] focus: RequestFocusPane failed');
                    }
                },
            );
        } catch (e) {
            logError(e, '[boxxy] focus: error building RequestFocusPane call');
        }
    }

    // -- D-Bus calls & signals ----------------------------------------------

    _fetchRegistry() {
        log('[boxxy] chars: creating agent proxy');

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
                    log('[boxxy] chars: proxy ready, calling ' + METHOD_GET_SNAPSHOT);

                    const reply = proxy.call_sync(
                        METHOD_GET_SNAPSHOT,
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                    );

                    if (!reply) {
                        log('[boxxy] chars: ' + METHOD_GET_SNAPSHOT + ' returned null');
                        return;
                    }

                    const [json] = reply.deepUnpack();
                    log('[boxxy] chars: snapshot received, length=' + (json ? json.length : 0));
                    this._applyRegistrySnapshot(JSON.parse(json));
                } catch (e) {
                    logError(e, '[boxxy] chars: ' + METHOD_GET_SNAPSHOT + ' error');
                }
            },
        );
    }

    _subscribeCharacters() {
        if (this._charSignalId)
            return;

        log('[boxxy] chars: subscribing to ' + SIGNAL_CLAIMS_CHANGED);
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
                    log('[boxxy] chars: ' + SIGNAL_CLAIMS_CHANGED + ' received');
                    this._applyRegistrySnapshot(JSON.parse(json));
                } catch (e) {
                    logError(e, '[boxxy] chars: ' + SIGNAL_CLAIMS_CHANGED + ' error');
                }
            },
        );
        log('[boxxy] chars: signal_subscribe id=' + this._charSignalId);
    }

    _unsubscribeCharacters() {
        if (this._charSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._charSignalId);
            this._charSignalId = 0;
        }
    }

    // -- snapshot application -----------------------------------------------

    _applyRegistrySnapshot(snapshot) {
        if (!this._proxy?.g_name_owner)
            return;

        const catalog = snapshot.catalog || [];
        log('[boxxy] chars: applying snapshot, catalog size=' + catalog.length);
        this._charActive = true;
        this._rebuildCharacterItems(catalog);
    }

    // -- character menu items -----------------------------------------------

    _clearCharacterItems() {
        // In St, destroy() removes the actor from its parent container.
        for (const item of this._charSection.items)
            item.destroy();
        this._charSection.items = [];

        if (this._charSection.header)
            this._charSection.header.visible = false;
        if (this._charSection.actionSep)
            this._charSection.actionSep.visible = false;
    }

    _rebuildCharacterItems(catalog) {
        // Destroy old character rows (destroy removes from parent in St)
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

        if (!hasCharacters) {
            log('[boxxy] chars: no characters in catalog');
            return;
        }

        const items = [];
        for (const info of catalog) {
            const cfg = info.config;
            const isActive =
                typeof info.status === 'object' && info.status !== null && 'Active' in info.status;
            const paneId = isActive ? info.status.Active.pane_id : null;

            const item = this._createCharacterItem(cfg, isActive, paneId, info.has_avatar);
            items.push(item);
        }

        // Insert in reverse so catalog order is preserved
        for (let i = items.length - 1; i >= 0; i--)
            this._indicator.menu.addMenuItem(items[i], this._charSection.insertAt);

        this._charSection.items = items;
        log('[boxxy] chars: built ' + items.length + ' character rows');
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
            text: cfg.display_name || cfg.name,
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
                log('[boxxy] focus: character clicked, pane=' + paneId);
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
