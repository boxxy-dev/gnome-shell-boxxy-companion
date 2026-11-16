import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {CharactersSection} from './sections/charactersSection.js';
import {DetachedSection} from './sections/detachedSection.js';
import {TasksSection} from './sections/tasksSection.js';

export class BoxxyIndicator {
    constructor({
        extensionPath,
        avatarCache,
        onStartAgent,
        onStopAgent,
        onReloadAgent,
        onStopDevAgent,
        onReloadDevAgent,
        onOpenTerminal,
        onOpenPreferences,
        onMenuOpened,
        onFocusPane,
        onSpawnCharacter,
        onRestoreDetached,
        onTerminateDetached,
        onCancelTask,
    }) {
        this._avatarCache = avatarCache;
        this._onStartAgent = onStartAgent;
        this._onStopAgent = onStopAgent;
        this._onReloadAgent = onReloadAgent;
        this._onStopDevAgent = onStopDevAgent;
        this._onReloadDevAgent = onReloadDevAgent;
        this._onOpenTerminal = onOpenTerminal;
        this._onOpenPreferences = onOpenPreferences;
        this._onMenuOpened = onMenuOpened;
        this._onFocusPane = onFocusPane;
        this._onSpawnCharacter = onSpawnCharacter;
        this._onRestoreDetached = onRestoreDetached;
        this._onTerminateDetached = onTerminateDetached;
        this._onCancelTask = onCancelTask;

        this._iconOn = new Gio.FileIcon({
            file: Gio.File.new_for_path(`${extensionPath}/resources/boxxyclaw-symbolic.svg`),
        });
        this._iconOff = new Gio.FileIcon({
            file: Gio.File.new_for_path(`${extensionPath}/resources/boxxyclaw-off-symbolic.svg`),
        });

        this._running = false;
        this._statusMeta = null;
        this._catalog = [];
        this._detached = [];
        this._tasks = [];
        this._devInstances = [];

        this._dirty = {
            dev: false,
            detached: false,
            tasks: false,
            characters: false,
        };

        this._build();
    }

    _build() {
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

        this.button = new PanelMenu.Button(0.5, 'Boxxy Terminal', false);
        this.button.add_child(this._panelBox);

        const menu = this.button.menu;
        menu.box.add_style_class_name('boxxy-popup-menu');

        this._menuOpenSignalId = menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._flushDirtySections();
                this._tasksSection.startCountdown();
                this._onMenuOpened?.();
            } else {
                this._tasksSection.stopCountdown();
            }
        });

        // 1. Primary Agent Status Card
        menu.addMenuItem(this._createAgentHeaderItem());

        // 2. Dynamic Dev Agent Section (empty/invisible unless dev-agent is running)
        this._devSection = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._devSection);

        // 3. Detached Background Shells
        this._detachedSection = new DetachedSection({
            avatarCache: this._avatarCache,
            onRestore: pid => {
                menu.close();
                this._onRestoreDetached(pid);
            },
            onTerminate: pid => this._onTerminateDetached(pid),
        });
        menu.addMenuItem(this._detachedSection.section);

        // 4. Pending Reminders / Scheduled Tasks
        this._tasksSection = new TasksSection({
            avatarCache: this._avatarCache,
            onFocusOrRestore: task => {
                menu.close();
                if (task.is_detached && task.pid)
                    this._onRestoreDetached(task.pid);
                else if (task.pane_id)
                    this._onFocusPane(task.pane_id);
            },
            onCancel: (paneId, taskId) => this._onCancelTask(paneId, taskId),
        });
        menu.addMenuItem(this._tasksSection.section);

        // 5. Character Roster (Active + Collapsible Available Dropdown)
        this._charactersSection = new CharactersSection({
            avatarCache: this._avatarCache,
            onFocusCharacter: paneId => {
                menu.close();
                this._onFocusPane(paneId);
            },
            onSpawnCharacter: charKey => {
                menu.close();
                this._onSpawnCharacter(charKey);
            },
        });
        menu.addMenuItem(this._charactersSection.section);

        // 6. Footer Quick Actions
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this._createFooterActionItem(
            'Open Boxxy Terminal',
            'utilities-terminal-symbolic',
            () => {
                menu.close();
                this._onOpenTerminal();
            }
        ));
        menu.addMenuItem(this._createFooterActionItem(
            'Extension Settings',
            'preferences-system-symbolic',
            () => {
                menu.close();
                this._onOpenPreferences();
            }
        ));

        Main.panel.addToStatusArea('boxxy-terminal', this.button);
        this._syncAgentHeader();
    }

    destroy() {
        this._tasksSection?.destroy();
        if (this._menuOpenSignalId && this.button?.menu) {
            this.button.menu.disconnect(this._menuOpenSignalId);
            this._menuOpenSignalId = 0;
        }
        if (this.button) {
            this.button.destroy();
            this.button = null;
        }
        this._panelBox = null;
        this._panelIcon = null;
        this._badgeLabel = null;
    }

    get isMenuOpen() {
        return Boolean(this.button?.menu?.isOpen);
    }

    _createFooterActionItem(label, iconName, onActivate) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
            style_class: 'boxxy-footer-item',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);

        item.add_child(new St.Icon({
            icon_name: iconName,
            icon_size: 16,
            style_class: 'boxxy-footer-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        item.add_child(new St.Label({
            text: label,
            style_class: 'boxxy-footer-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        item.connect('activate', onActivate);
        return item;
    }

    _createDaemonControls({onReload, onStop, reloadName, stopName}) {
        const group = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-btn-group',
        });

        const reloadBtn = new St.Button({
            style_class: 'boxxy-circle-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: reloadName,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 16,
            }),
        });
        reloadBtn.connect('clicked', onReload);
        group.add_child(reloadBtn);

        const stopBtn = new St.Button({
            style_class: 'boxxy-circle-btn boxxy-circle-btn-danger',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: stopName,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'media-playback-stop-symbolic',
                icon_size: 16,
            }),
        });
        stopBtn.connect('clicked', onStop);
        group.add_child(stopBtn);

        return group;
    }

    _createAgentHeaderItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'boxxy-agent-card',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);

        this._statusDot = new St.Bin({
            style_class: 'boxxy-status-dot boxxy-status-dot-stopped',
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(this._statusDot);

        const titleBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-row-text-box',
        });

        this._agentTitleLabel = new St.Label({
            text: 'Boxxy Agent',
            style_class: 'boxxy-agent-title',
        });
        this._agentSubLabel = new St.Label({
            text: 'Stopped',
            style_class: 'boxxy-agent-subtitle',
        });
        this._agentSubLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        titleBox.add_child(this._agentTitleLabel);
        titleBox.add_child(this._agentSubLabel);
        item.add_child(titleBox);

        this._startBtn = new St.Button({
            label: 'Start',
            style_class: 'boxxy-pill-btn boxxy-restore-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._startBtn.connect('clicked', () => this._onStartAgent());
        item.add_child(this._startBtn);

        this._runningControls = this._createDaemonControls({
            onReload: () => this._onReloadAgent(),
            onStop: () => this._onStopAgent(),
            reloadName: 'Restart Agent',
            stopName: 'Stop Agent',
        });
        item.add_child(this._runningControls);

        return item;
    }

    setDaemonRunning(running) {
        this._running = running;
        if (!running) {
            this._statusMeta = null;
            this._catalog = [];
            this._detached = [];
            this._tasks = [];
            this._dirty.detached = false;
            this._dirty.tasks = false;
            this._dirty.characters = false;
            this._detachedSection.clear();
            this._tasksSection.clear();
            this._charactersSection.clear();
            this._updateBadge();
        }
        this._panelIcon?.set_gicon(running ? this._iconOn : this._iconOff);
        this._syncAgentHeader();
    }

    setStatusMetadata(meta) {
        this._statusMeta = meta || null;
        if (meta?.config_dir)
            this._avatarCache.setConfigDir(meta.config_dir);
        this._syncAgentHeader();
    }

    setDevInstances(instances) {
        this._devInstances = Array.isArray(instances) ? instances : [];
        if (this.isMenuOpen) {
            this._dirty.dev = false;
            this._renderDevSection();
        } else {
            this._dirty.dev = true;
        }
    }

    setCatalog(catalog) {
        this._catalog = Array.isArray(catalog) ? catalog : [];
        if (this.isMenuOpen) {
            this._dirty.characters = false;
            this._charactersSection.render(this._catalog);
            if (this._detached.length > 0)
                this._detachedSection.render(this._detached, this._catalog);
            if (this._tasks.length > 0)
                this._tasksSection.render(this._tasks, this._catalog, true);
        } else {
            this._dirty.characters = true;
            if (this._detached.length > 0)
                this._dirty.detached = true;
            if (this._tasks.length > 0)
                this._dirty.tasks = true;
        }
    }

    setDetachedSessions(sessions) {
        this._detached = Array.isArray(sessions) ? sessions : [];
        this._updateBadge();
        if (this.isMenuOpen) {
            this._dirty.detached = false;
            this._detachedSection.render(this._detached, this._catalog);
        } else {
            this._dirty.detached = true;
        }
    }

    setPendingTasks(tasks) {
        this._tasks = Array.isArray(tasks) ? tasks : [];
        this._updateBadge();
        if (this.isMenuOpen) {
            this._dirty.tasks = false;
            this._tasksSection.render(this._tasks, this._catalog, true);
        } else {
            this._dirty.tasks = true;
        }
    }

    _flushDirtySections() {
        if (this._dirty.dev) {
            this._dirty.dev = false;
            this._renderDevSection();
        }
        if (this._dirty.detached) {
            this._dirty.detached = false;
            this._detachedSection.render(this._detached, this._catalog);
        }
        if (this._dirty.tasks) {
            this._dirty.tasks = false;
            this._tasksSection.render(this._tasks, this._catalog, true);
        }
        if (this._dirty.characters) {
            this._dirty.characters = false;
            this._charactersSection.render(this._catalog);
        }
    }

    _syncAgentHeader() {
        if (!this._statusDot || !this._agentSubLabel)
            return;

        if (this._running) {
            this._statusDot.remove_style_class_name('boxxy-status-dot-stopped');
            this._statusDot.add_style_class_name('boxxy-status-dot-running');

            const ver = this._statusMeta?.version ? `v${this._statusMeta.version}` : '';
            const isStale = Boolean(this._statusMeta?.is_stale_binary);
            let sub = ver ? `Running • ${ver}` : 'Running';
            if (isStale)
                sub += ' (restart to update)';

            this._agentSubLabel.set_text(sub);
            if (isStale)
                this._agentSubLabel.add_style_class_name('boxxy-agent-subtitle-stale');
            else
                this._agentSubLabel.remove_style_class_name('boxxy-agent-subtitle-stale');

            this._startBtn.visible = false;
            this._runningControls.visible = true;
        } else {
            this._statusDot.remove_style_class_name('boxxy-status-dot-running');
            this._statusDot.add_style_class_name('boxxy-status-dot-stopped');
            this._agentSubLabel.set_text('Stopped');
            this._agentSubLabel.remove_style_class_name('boxxy-agent-subtitle-stale');

            this._startBtn.visible = true;
            this._runningControls.visible = false;
        }
    }

    _renderDevSection() {
        this._devSection.removeAll();
        if (this._devInstances.length === 0)
            return;

        for (const inst of this._devInstances) {
            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'boxxy-agent-card boxxy-dev-card',
            });
            item.setOrnament(PopupMenu.Ornament.HIDDEN);

            const dot = new St.Bin({
                style_class: 'boxxy-status-dot boxxy-status-dot-dev',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(dot);

            const textBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'boxxy-row-text-box',
            });

            const title = new St.Label({
                text: inst.label,
                style_class: 'boxxy-agent-title',
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const verText = inst.version ? `Running • v${inst.version}` : 'Running';
            const sub = new St.Label({
                text: verText,
                style_class: 'boxxy-agent-subtitle',
            });
            sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            textBox.add_child(title);
            textBox.add_child(sub);
            item.add_child(textBox);

            item.add_child(this._createDaemonControls({
                onReload: () => this._onReloadDevAgent(inst.busName),
                onStop: () => this._onStopDevAgent(inst.busName),
                reloadName: `Restart ${inst.label}`,
                stopName: `Stop ${inst.label}`,
            }));

            this._devSection.addMenuItem(item);
        }
    }

    _updateBadge() {
        if (!this._badgeLabel)
            return;

        const detachedWithoutTasks = this._detached.filter(
            s => !(Number(s.pending_task_count || 0) > 0)
        ).length;
        const totalCount = detachedWithoutTasks + this._tasks.length;
        const anyWaiting = this._detached.some(s => Boolean(s.waiting_for_input));

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
}
