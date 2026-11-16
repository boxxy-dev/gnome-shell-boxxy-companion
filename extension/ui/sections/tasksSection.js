import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ROW_AVATAR_SIZE} from '../../lib/constants.js';
import {
    formatCharacterName,
    formatTaskCountdown,
    formatTaskTypeLabel,
} from '../../lib/format.js';

export class TasksSection {
    constructor({avatarCache, onFocusOrRestore, onCancel}) {
        this._avatarCache = avatarCache;
        this._onFocusOrRestore = onFocusOrRestore;
        this._onCancel = onCancel;

        this.section = new PopupMenu.PopupMenuSection();
        this._countdownEntries = [];
        this._timerId = 0;
    }

    destroy() {
        this.stopCountdown();
        this._countdownEntries = [];
        this.section.removeAll();
    }

    clear() {
        this.stopCountdown();
        this._countdownEntries = [];
        this.section.removeAll();
    }

    render(tasks, catalog, isMenuOpen) {
        this.stopCountdown();
        this._countdownEntries = [];
        this.section.removeAll();

        const list = Array.isArray(tasks) ? tasks : [];
        if (list.length === 0)
            return;

        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const header = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'boxxy-section-header-item',
        });
        header.setOrnament(PopupMenu.Ornament.HIDDEN);
        header.add_child(new St.Label({
            text: `Pending Reminders (${list.length})`,
            style_class: 'boxxy-section-header',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.section.addMenuItem(header);

        for (const task of list)
            this.section.addMenuItem(this._createTaskItem(task, catalog));

        if (isMenuOpen)
            this.startCountdown();
    }

    startCountdown() {
        if (this._timerId || this._countdownEntries.length === 0)
            return;

        this._tickCountdowns();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            1,
            () => {
                if (this._countdownEntries.length === 0) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._tickCountdowns();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    stopCountdown() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }

    _tickCountdowns() {
        for (const {subLabel, task} of this._countdownEntries) {
            if (!subLabel)
                continue;
            const typeLabel = formatTaskTypeLabel(task.task_type);
            const countdown = formatTaskCountdown(task.due_at_unix, task.remaining_secs);
            const bgSuffix = task.is_detached ? ' • Background' : '';
            subLabel.set_text(`${typeLabel} • ${countdown}${bgSuffix}`);
        }
    }

    _createTaskItem(task, catalog) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'boxxy-card-item',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);

        const charObj = (catalog || []).find(
            c => c.config?.id === task.character_id || c.config?.name === task.character_slug
        );
        const slug = task.character_slug || charObj?.config?.name || '';
        const charName = formatCharacterName(task.character_name) || 'AI Agent';
        const color = charObj?.config?.color;
        item.add_child(this._avatarCache.createAvatar(slug, charName, color, ROW_AVATAR_SIZE));

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-row-text-box',
        });

        const payload = (task.payload || 'Scheduled Reminder').trim();
        const titleLabel = new St.Label({
            text: `${charName}: ${payload}`,
            style_class: 'boxxy-row-title',
        });
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const typeLabel = formatTaskTypeLabel(task.task_type);
        const countdown = formatTaskCountdown(task.due_at_unix, task.remaining_secs);
        const bgSuffix = task.is_detached ? ' • Background' : '';
        const subLabel = new St.Label({
            text: `${typeLabel} • ${countdown}${bgSuffix}`,
            style_class: 'boxxy-row-subtitle',
        });
        subLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._countdownEntries.push({subLabel, task});

        textBox.add_child(titleLabel);
        textBox.add_child(subLabel);
        item.add_child(textBox);

        const actionsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-btn-group',
        });

        const focusBtn = new St.Button({
            label: task.is_detached ? 'Restore' : 'Focus',
            style_class: 'boxxy-pill-btn boxxy-restore-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        focusBtn.connect('clicked', () => this._onFocusOrRestore(task));
        actionsBox.add_child(focusBtn);

        const cancelBtn = new St.Button({
            style_class: 'boxxy-circle-btn boxxy-circle-btn-danger',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: 'Cancel Reminder',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 15,
            }),
        });
        cancelBtn.connect('clicked', () => this._onCancel(task.pane_id, task.id));
        actionsBox.add_child(cancelBtn);

        item.add_child(actionsBox);

        return item;
    }
}
