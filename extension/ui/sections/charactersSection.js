import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {AVATAR_SIZE} from '../../lib/constants.js';
import {
    formatCharacterDuty,
    formatCharacterName,
    getActivePaneId,
    isCharacterActive,
    sanitizeHexColor,
} from '../../lib/format.js';

/**
 * Renders Active ("In Use") characters as spacious cards at the top for 1-click focus,
 * while tucking Available characters into a clean collapsible submenu with circular
 * signature-colored portraits and duty subtitles.
 */
export class CharactersSection {
    constructor({avatarCache, onFocusCharacter, onSpawnCharacter}) {
        this._avatarCache = avatarCache;
        this._onFocusCharacter = onFocusCharacter;
        this._onSpawnCharacter = onSpawnCharacter;

        this.section = new PopupMenu.PopupMenuSection();
    }

    clear() {
        this.section.removeAll();
    }

    render(catalog) {
        this.section.removeAll();

        const list = Array.isArray(catalog) ? catalog : [];
        if (list.length === 0)
            return;

        const activeChars = [];
        const availableChars = [];
        for (const info of list) {
            if (isCharacterActive(info))
                activeChars.push(info);
            else
                availableChars.push(info);
        }

        this.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (activeChars.length > 0) {
            const header = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'boxxy-section-header-item',
            });
            header.setOrnament(PopupMenu.Ornament.HIDDEN);
            header.add_child(new St.Label({
                text: `Active Characters (${activeChars.length})`,
                style_class: 'boxxy-section-header',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this.section.addMenuItem(header);

            for (const info of activeChars)
                this.section.addMenuItem(this._createCharacterRow(info, true));
        }

        if (availableChars.length > 0) {
            const dropdownTitle = activeChars.length > 0
                ? `Available Characters (${availableChars.length})`
                : `Characters (${availableChars.length} Available)`;

            const subMenu = new PopupMenu.PopupSubMenuMenuItem(dropdownTitle, false);
            subMenu.setOrnament(PopupMenu.Ornament.HIDDEN);
            subMenu.add_style_class_name('boxxy-available-submenu-header');
            subMenu.menu.box.add_style_class_name('boxxy-available-submenu-box');

            for (const info of availableChars)
                subMenu.menu.addMenuItem(this._createCharacterRow(info, false));

            this.section.addMenuItem(subMenu);
        }
    }

    _createCharacterRow(info, isActive) {
        const cfg = info.config || {};
        const name = formatCharacterName(cfg.display_name || cfg.name) || 'Character';
        const duty = formatCharacterDuty(cfg.duties);
        const safeColor = sanitizeHexColor(cfg.color);

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
            style_class: isActive
                ? 'boxxy-char-item boxxy-char-item-active'
                : 'boxxy-char-subitem',
        });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);

        const avatarSlug = info.has_avatar ? cfg.name : '';
        item.add_child(this._avatarCache.createAvatar(avatarSlug, name, safeColor, AVATAR_SIZE));

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-char-text-box',
        });

        const nameRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'boxxy-char-name-row',
        });

        const nameLabel = new St.Label({
            text: name,
            style_class: 'boxxy-char-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        nameRow.add_child(nameLabel);

        const accentDot = new St.Bin({
            style_class: 'boxxy-char-accent-dot',
            style: `background-color: ${safeColor};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        nameRow.add_child(accentDot);

        textBox.add_child(nameRow);

        if (duty) {
            const dutyLabel = new St.Label({
                text: duty,
                style_class: 'boxxy-char-duty',
            });
            dutyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textBox.add_child(dutyLabel);
        }

        item.add_child(textBox);

        if (isActive) {
            const pill = new St.Label({
                text: 'In Use',
                style_class: 'boxxy-char-pill-active',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(pill);

            const paneId = getActivePaneId(info);
            if (paneId)
                item.connect('activate', () => this._onFocusCharacter(paneId));
        } else {
            const openIcon = new St.Icon({
                icon_name: 'go-next-symbolic',
                icon_size: 14,
                style_class: 'boxxy-char-open-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(openIcon);

            item.connect('activate', () => {
                this._onSpawnCharacter(cfg.id || cfg.name);
            });
        }

        return item;
    }
}
