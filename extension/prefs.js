import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUT_SLOTS = 10;
const SLUG_KEY = 'shortcut-slugs';

function normalizeSlugsArray(rawSlugs) {
    const out = Array.isArray(rawSlugs) ? rawSlugs.slice(0, SHORTCUT_SLOTS) : [];
    while (out.length < SHORTCUT_SLOTS)
        out.push('');
    return out.map(s => (typeof s === 'string' ? s : ''));
}

function prettifyName(raw) {
    if (!raw || typeof raw !== 'string')
        return '';
    return raw
        .trim()
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function loadOfflineCharactersFromDisk() {
    const charsDir = GLib.build_filenamev([
        GLib.get_home_dir(),
        '.config',
        'boxxy-terminal',
        'boxxyclaw',
        'characters',
    ]);
    const dirFile = Gio.File.new_for_path(charsDir);
    if (!dirFile.query_exists(null))
        return [];

    const entries = [];
    try {
        const enumerator = dirFile.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                continue;
            const slug = info.get_name();
            const tomlPath = GLib.build_filenamev([charsDir, slug, 'CHARACTER.toml']);
            if (!GLib.file_test(tomlPath, GLib.FileTest.IS_REGULAR))
                continue;

            let displayName = prettifyName(slug);
            try {
                const [ok, bytes] = GLib.file_get_contents(tomlPath);
                if (ok && bytes) {
                    const text = new TextDecoder('utf-8').decode(bytes);
                    const match = text.match(/^\s*display_name\s*=\s*"([^"]+)"/m);
                    if (match?.[1])
                        displayName = prettifyName(match[1]);
                }
            } catch (_e) {
                // Keep slug-based displayName
            }

            entries.push({slug, displayName});
        }
        enumerator.close(null);
    } catch (e) {
        console.debug('[boxxy] prefs: offline character scan failed:', e.message);
    }

    entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return entries;
}

const ShortcutRecorderDialog = GObject.registerClass(
class ShortcutRecorderDialog extends Adw.Window {
    _init(parent, settings, key, title) {
        super._init({
            modal: true,
            transient_for: parent,
            width_request: 440,
            height_request: 240,
            title: 'Set Keyboard Shortcut',
            resizable: false,
        });

        const safeTitle = GLib.markup_escape_text(title || 'Character', -1);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 20,
            margin_top: 32,
            margin_bottom: 32,
            margin_start: 32,
            margin_end: 32,
            valign: Gtk.Align.CENTER,
        });

        const label = new Gtk.Label({
            label: `Enter new shortcut for <b>${safeTitle}</b>`,
            use_markup: true,
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        label.add_css_class('title-2');
        box.append(label);

        const sublabel = new Gtk.Label({
            label: 'Press Esc to cancel or Backspace to clear the shortcut.',
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        sublabel.add_css_class('dim-label');
        box.append(sublabel);

        this.set_content(box);

        const controller = new Gtk.EventControllerKey();
        this.add_controller(controller);

        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (this._isModifier(keyval))
                return true;

            if (keyval === Gdk.KEY_Escape) {
                this.close();
                return true;
            }

            if (keyval === Gdk.KEY_Backspace && mask === 0) {
                settings.set_strv(key, []);
                this.close();
                return true;
            }

            const accel = Gtk.accelerator_name(keyval, mask);
            if (accel) {
                settings.set_strv(key, [accel]);
                this.close();
            }

            return true;
        });
    }

    _isModifier(keyval) {
        return [
            Gdk.KEY_Control_L, Gdk.KEY_Control_R,
            Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
            Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
            Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
            Gdk.KEY_Super_L, Gdk.KEY_Super_R,
            Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
        ].includes(keyval);
    }
});

export default class BoxxyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cancellable = new Gio.Cancellable();
        window.connect('close-request', () => {
            cancellable.cancel();
            return false;
        });

        const page = new Adw.PreferencesPage({
            title: 'Shortcuts',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        const introGroup = new Adw.PreferencesGroup({
            title: 'Global Character Shortcuts',
            description: 'Pressing a shortcut focuses the character if already active, or opens a new Boxxy Claw tab with that character ready.',
        });
        page.add(introGroup);

        // Seed immediately from disk so dropdowns work offline and without blocking UI open.
        const initialEntries = this._mergeSavedSlugs(
            loadOfflineCharactersFromDisk(),
            normalizeSlugsArray(settings.get_strv(SLUG_KEY))
        );

        const slotControllers = [];
        for (let i = 1; i <= SHORTCUT_SLOTS; i++) {
            const group = new Adw.PreferencesGroup({
                title: `Focus Slot ${i}`,
            });
            page.add(group);
            slotControllers.push(this._addShortcutSlot(window, group, settings, i, initialEntries));
        }

        // Refresh asynchronously from the live daemon if running.
        void this._fetchLiveCatalogAsync(cancellable).then(liveEntries => {
            if (!liveEntries || liveEntries.length === 0 || cancellable.is_cancelled())
                return;
            const merged = this._mergeSavedSlugs(
                liveEntries,
                normalizeSlugsArray(settings.get_strv(SLUG_KEY))
            );
            for (const slot of slotControllers)
                slot.updateEntries(merged);
        });
    }

    _mergeSavedSlugs(entries, savedSlugs) {
        const out = [...entries];
        const known = new Set(out.map(e => e.slug));
        for (const slug of savedSlugs) {
            if (slug && !known.has(slug)) {
                known.add(slug);
                out.push({
                    slug,
                    displayName: `${prettifyName(slug)} (saved)`,
                });
            }
        }
        return out;
    }

    _fetchLiveCatalogAsync(cancellable) {
        return new Promise(resolve => {
            Gio.DBus.session.call(
                'dev.boxxy.BoxxyAgent',
                '/dev/boxxy/Agent',
                'dev.boxxy.BoxxyTerminal.Agent',
                'GetRegistrySnapshot',
                null,
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NO_AUTO_START,
                3000,
                cancellable,
                (conn, res) => {
                    try {
                        const reply = conn.call_finish(res);
                        const [json] = reply.deepUnpack();
                        const snapshot = JSON.parse(json || '{}');
                        const catalog = Array.isArray(snapshot.catalog) ? snapshot.catalog : [];
                        const entries = catalog
                            .filter(c => c?.config?.name)
                            .map(c => ({
                                slug: c.config.name,
                                displayName: prettifyName(c.config.display_name || c.config.name),
                            }));
                        resolve(entries);
                    } catch (_e) {
                        resolve(null);
                    }
                }
            );
        });
    }

    _addShortcutSlot(window, group, settings, index, initialEntries) {
        const shortcutKey = `shortcut-${index}`;
        let entries = initialEntries;
        let updatingModel = false;

        const buildModelAndSelection = targetSlug => {
            const model = new Gtk.StringList();
            model.append('None');
            let selected = 0;
            entries.forEach((entry, idx) => {
                model.append(entry.displayName);
                if (entry.slug === targetSlug)
                    selected = idx + 1;
            });
            return {model, selected};
        };

        const savedSlugs = normalizeSlugsArray(settings.get_strv(SLUG_KEY));
        const currentSlug = savedSlugs[index - 1];
        const {model, selected} = buildModelAndSelection(currentSlug);

        const combo = new Adw.ComboRow({
            title: 'Character',
            model,
            selected,
        });

        const getSelectedEntry = () => {
            const sel = combo.selected;
            return sel > 0 && sel <= entries.length ? entries[sel - 1] : null;
        };

        const shortcutRow = new Adw.ActionRow({
            activatable: true,
        });

        const syncRowTitle = () => {
            const entry = getSelectedEntry();
            shortcutRow.title = entry ? `Shortcut for ${entry.displayName}` : 'Shortcut';
        };
        syncRowTitle();

        combo.connect('notify::selected', () => {
            if (updatingModel)
                return;
            const entry = getSelectedEntry();
            const nextSlugs = normalizeSlugsArray(settings.get_strv(SLUG_KEY));
            nextSlugs[index - 1] = entry ? entry.slug : '';
            settings.set_strv(SLUG_KEY, nextSlugs);
            syncRowTitle();
        });
        group.add(combo);

        const suffixBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER,
        });

        const initialAccel = settings.get_strv(shortcutKey)[0] || '';
        const shortcutLabel = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            accelerator: initialAccel,
            disabled_text: 'Disabled',
        });

        const clearBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Clear shortcut',
            visible: Boolean(initialAccel),
        });
        clearBtn.add_css_class('flat');
        clearBtn.connect('clicked', () => {
            settings.set_strv(shortcutKey, []);
        });

        settings.connect(`changed::${shortcutKey}`, () => {
            const accel = settings.get_strv(shortcutKey)[0] || '';
            shortcutLabel.accelerator = accel;
            clearBtn.visible = Boolean(accel);
        });

        suffixBox.append(shortcutLabel);
        suffixBox.append(clearBtn);
        shortcutRow.add_suffix(suffixBox);

        shortcutRow.connect('activated', () => {
            const entry = getSelectedEntry();
            const dialog = new ShortcutRecorderDialog(
                window,
                settings,
                shortcutKey,
                entry ? entry.displayName : `Slot ${index}`
            );
            dialog.present();
        });

        group.add(shortcutRow);

        return {
            updateEntries(nextEntries) {
                updatingModel = true;
                entries = nextEntries;
                const latestSlugs = normalizeSlugsArray(settings.get_strv(SLUG_KEY));
                const next = buildModelAndSelection(latestSlugs[index - 1]);
                combo.model = next.model;
                combo.selected = next.selected;
                syncRowTitle();
                updatingModel = false;
            },
        };
    }
}
