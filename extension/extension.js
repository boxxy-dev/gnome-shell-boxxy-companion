import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AvatarCache } from './lib/avatarCache.js';
import { SHORTCUT_SLOTS } from './lib/constants.js';
import { AgentClient, DevAgentWatcher } from './lib/dbus.js';
import { getActivePaneId, isCharacterActive } from './lib/format.js';
import {
    launchBoxxyTerminal,
    startAgentDaemon,
} from './lib/launcher.js';
import { BoxxyIndicator } from './ui/indicator.js';
import {
    focusBoxxyWindow,
    focusOrLaunchBoxxyWindow,
} from './ui/windowFocus.js';

export default class BoxxyExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._catalog = [];
        this._avatarCache = new AvatarCache();

        this._indicator = new BoxxyIndicator({
            extensionPath: this.path,
            avatarCache: this._avatarCache,
            onStartAgent: () => startAgentDaemon(),
            onStopAgent: () => void this._agent?.requestStop(),
            onReloadAgent: () => void this._agent?.requestReload(),
            onStopDevAgent: busName => void this._devWatcher?.stopInstance(busName),
            onReloadDevAgent: busName => void this._devWatcher?.reloadInstance(busName),
            onOpenTerminal: () => focusOrLaunchBoxxyWindow(),
            onOpenPreferences: () => this.openPreferences(),
            onMenuOpened: () => this._agent?.refreshVolatile(),
            onFocusPane: paneId => void this._focusPane(paneId),
            onSpawnCharacter: charKey => void this._spawnCharacter(charKey),
            onRestoreDetached: pid => void this._restoreDetached(pid),
            onTerminateDetached: pid => void this._agent?.terminateDetachedSession(pid),
            onCancelTask: (paneId, taskId) => void this._agent?.cancelPendingTask(paneId, taskId),
        });

        this._agent = new AgentClient({
            onStateChanged: running => {
                if (!running)
                    this._catalog = [];
                this._indicator?.setDaemonRunning(running);
            },
            onStatusMetadata: meta => {
                this._indicator?.setStatusMetadata(meta);
            },
            onCatalogChanged: catalog => {
                this._catalog = catalog;
                this._indicator?.setCatalog(catalog);
            },
            onDetachedChanged: sessions => {
                this._indicator?.setDetachedSessions(sessions);
            },
            onTasksChanged: tasks => {
                this._indicator?.setPendingTasks(tasks);
            },
        });

        this._devWatcher = new DevAgentWatcher(instances => {
            this._indicator?.setDevInstances(instances);
        });

        this._agent.start();
        this._devWatcher.start();
        this._setupShortcuts();
    }

    disable() {
        this._teardownShortcuts();

        this._devWatcher?.destroy();
        this._devWatcher = null;

        this._agent?.destroy();
        this._agent = null;

        this._indicator?.destroy();
        this._indicator = null;

        this._avatarCache?.invalidate();
        this._avatarCache = null;

        this._catalog = [];
        this._settings = null;
    }

    // -- global keybindings -------------------------------------------------

    _setupShortcuts() {
        for (let i = 1; i <= SHORTCUT_SLOTS; i++) {
            Main.wm.addKeybinding(
                `shortcut-${i}`,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => void this._handleShortcut(i)
            );
        }
    }

    _teardownShortcuts() {
        for (let i = 1; i <= SHORTCUT_SLOTS; i++)
            Main.wm.removeKeybinding(`shortcut-${i}`);
    }

    async _handleShortcut(index) {
        const slugs = this._settings?.get_strv('shortcut-slugs') || [];
        const slug = (slugs[index - 1] || '').trim();
        if (!slug)
            return;

        if (!this._agent?.isRunning) {
            launchBoxxyTerminal();
            return;
        }

        const charInfo = this._catalog.find(
            c => c.config?.name === slug || c.config?.id === slug
        );
        if (charInfo && isCharacterActive(charInfo)) {
            const paneId = getActivePaneId(charInfo);
            if (paneId)
                await this._focusPane(paneId);
            return;
        }

        await this._spawnCharacter(charInfo?.config?.id || slug);
    }

    // -- actions ------------------------------------------------------------

    async _focusPane(paneId) {
        const hasOpenWindow = focusBoxxyWindow();
        const ok = await this._agent?.requestFocusPane(paneId);
        if (ok && !hasOpenWindow)
            launchBoxxyTerminal();
    }

    async _spawnCharacter(charKey) {
        const hasOpenWindow = focusBoxxyWindow();
        if (!this._agent?.isRunning) {
            if (!hasOpenWindow)
                launchBoxxyTerminal();
            return;
        }

        await this._agent.requestSpawnCharacter(charKey, '');
        if (!hasOpenWindow)
            launchBoxxyTerminal();
    }

    async _restoreDetached(pid) {
        const hasOpenWindow = focusBoxxyWindow();
        const ok = await this._agent?.restoreDetachedSession(pid);
        if (ok && !hasOpenWindow)
            launchBoxxyTerminal();
    }
}
