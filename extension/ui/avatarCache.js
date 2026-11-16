import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {AVATAR_SIZE} from '../lib/constants.js';
import {hexToRgba, sanitizeHexColor} from '../lib/format.js';

/**
 * Caches character avatar `file://` URIs keyed by `<configDir>::<slug>` and renders
 * circular portraits via `St.Bin` `background-image` (with a signature-color
 * ring and initial-letter monogram fallback).
 */
export class AvatarCache {
    constructor() {
        this._defaultConfigDir = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.config',
            'boxxy-terminal',
        ]);
        this._configDir = this._defaultConfigDir;
        this._uris = new Map();
    }

    setConfigDir(configDir) {
        const next = (configDir && typeof configDir === 'string' && configDir.trim())
            ? configDir.trim()
            : this._defaultConfigDir;
        if (next !== this._configDir) {
            this._configDir = next;
            this._uris.clear();
        }
    }

    invalidate() {
        this._uris.clear();
    }

    getAvatarUri(slug) {
        if (!slug || typeof slug !== 'string')
            return null;

        const key = `${this._configDir}::${slug}`;
        if (this._uris.has(key))
            return this._uris.get(key);

        const avatarPath = GLib.build_filenamev([
            this._configDir,
            'boxxyclaw',
            'characters',
            slug,
            'AVATAR.png',
        ]);

        let uri = null;
        if (GLib.file_test(avatarPath, GLib.FileTest.EXISTS)) {
            uri = Gio.File.new_for_path(avatarPath)
                .get_uri()
                .replace(/["()\\]/g, '');
        }

        this._uris.set(key, uri);
        return uri;
    }

    createAvatar(slug, displayName, hexColor, size = AVATAR_SIZE) {
        const safeColor = sanitizeHexColor(hexColor);
        const uri = slug ? this.getAvatarUri(slug) : null;

        if (uri) {
            return new St.Bin({
                style_class: 'boxxy-char-avatar',
                style: `background-image: url("${uri}"); background-size: cover; border-color: ${safeColor};`,
                width: size,
                height: size,
                y_align: Clutter.ActorAlign.CENTER,
            });
        }

        const initial = (displayName || slug || '?').trim().charAt(0).toUpperCase() || '?';
        return new St.Bin({
            style_class: 'boxxy-char-avatar boxxy-char-monogram',
            style: `background-color: ${hexToRgba(safeColor, 0.24)}; border-color: ${safeColor};`,
            width: size,
            height: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Label({
                text: initial,
                style_class: 'boxxy-char-monogram-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        });
    }
}
