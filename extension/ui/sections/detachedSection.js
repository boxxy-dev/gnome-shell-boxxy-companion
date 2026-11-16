import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ROW_AVATAR_SIZE} from '../../lib/constants.js';
import {
    formatCharacterName,
    formatDetachedProcessName,
    formatIdleDuration,
    formatShortCwd,
} from '../../lib/format.js';

export class DetachedSection {
    constructor({avatarCache, onRestore, onTerminate}) {
        this._avatarCache = avatarCache;
        this._onRestore = onRestore;
        this._onTerminate = onTerminate;

        this.section = new PopupMenu.PopupMenuSection();
    }

    clear() {
        this.section.removeAll();
    }

    render(sessions, catalog) {
        this.section.removeAll();

        const list = Array.isArray(sessions) ? sessions : [];
        if (list.length === 0)
            return;

        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.section.addMenuItem(this._createHeaderItem(list.length));

        for (const session of list)
            this.section.addMenuItem(this._createSessionItem(session, catalog));
    }

    _createHeaderItem(count) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'boxxy-section-header-item',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);

        const titleLabel = new St.Label({
            text: `Background Shells (${count})`,
            style_class: 'boxxy-section-header',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(titleLabel);

        if (count > 1) {
            const restoreAllBtn = new St.Button({
                label: 'Restore All',
                style_class: 'boxxy-pill-btn boxxy-restore-btn',
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            restoreAllBtn.connect('clicked', () => this._onRestore(0));
            item.add_child(restoreAllBtn);

            const killAllBtn = new St.Button({
                label: 'Kill All',
                style_class: 'boxxy-pill-btn boxxy-kill-btn',
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            killAllBtn.connect('clicked', () => this._onTerminate(0));
            item.add_child(killAllBtn);
        }

        return item;
    }

    _createSessionItem(session, catalog) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'boxxy-card-item',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);

        const charObj = (catalog || []).find(
            c => (session.character_id && c.config?.id === session.character_id) ||
                 (session.character_slug && c.config?.name === session.character_slug)
        );
        const slug = session.character_slug || charObj?.config?.name || '';
        const charName = formatCharacterName(session.character_name || charObj?.config?.display_name);

        if (slug && this._avatarCache.getAvatarUri(slug)) {
            item.add_child(
                this._avatarCache.createAvatar(slug, charName, charObj?.config?.color, ROW_AVATAR_SIZE)
            );
        } else {
            item.add_child(new St.Bin({
                style_class: 'boxxy-shell-icon-circle',
                width: ROW_AVATAR_SIZE,
                height: ROW_AVATAR_SIZE,
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({
                    icon_name: 'utilities-terminal-symbolic',
                    icon_size: 16,
                }),
            }));
        }

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-row-text-box',
        });

        const procName = formatDetachedProcessName(session);
        const titleText = session.waiting_for_input
            ? `${procName} — Waiting for input`
            : procName;
        const titleLabel = new St.Label({
            text: titleText,
            style_class: session.waiting_for_input
                ? 'boxxy-row-title boxxy-row-title-warning'
                : 'boxxy-row-title',
        });
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const shortCwd = formatShortCwd(session.cwd);
        const idleStr = formatIdleDuration(session.idle_secs);
        let subText = `${shortCwd} • ${idleStr}`;

        if (charName && !titleText.toLowerCase().startsWith(charName.toLowerCase()))
            subText += ` • ${charName}`;
        if (session.pending_task_count > 0) {
            const rLabel = session.pending_task_count === 1 ? 'reminder' : 'reminders';
            subText += ` • ${session.pending_task_count} ${rLabel}`;
        }

        const subLabel = new St.Label({
            text: subText,
            style_class: 'boxxy-row-subtitle',
        });
        subLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        textBox.add_child(titleLabel);
        textBox.add_child(subLabel);
        item.add_child(textBox);

        const actionsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-btn-group',
        });

        const restoreBtn = new St.Button({
            label: 'Restore',
            style_class: 'boxxy-pill-btn boxxy-restore-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        restoreBtn.connect('clicked', () => this._onRestore(session.pid));
        actionsBox.add_child(restoreBtn);

        const killBtn = new St.Button({
            style_class: 'boxxy-circle-btn boxxy-circle-btn-danger',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: 'Terminate Shell',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 15,
            }),
        });
        killBtn.connect('clicked', () => this._onTerminate(session.pid));
        actionsBox.add_child(killBtn);

        item.add_child(actionsBox);

        return item;
    }
}
