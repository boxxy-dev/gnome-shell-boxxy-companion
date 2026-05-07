import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';

const ShortcutRecorderDialog = GObject.registerClass(
class ShortcutRecorderDialog extends Adw.Window {
    _init(parent, settings, key, title) {
        super._init({
            modal: true,
            transient_for: parent,
            width_request: 450,
            height_request: 250,
            title: 'Set Shortcut',
            resizable: false,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 24,
            margin_top: 36,
            margin_bottom: 36,
            margin_start: 36,
            margin_end: 36,
            valign: Gtk.Align.CENTER,
        });

        const label = new Gtk.Label({
            label: `Enter new shortcut for <b>${title}</b>`,
            use_markup: true,
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        label.add_css_class('title-2');
        box.append(label);

        const sublabel = new Gtk.Label({
            label: 'Press Esc to cancel or Backspace to disable the keyboard shortcut.',
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

            // Ignore lone modifiers
            if (this._isModifier(keyval))
                return true;

            // Handle Escape (Cancel)
            if (keyval === Gdk.KEY_Escape) {
                this.close();
                return true;
            }

            // Handle Backspace (Clear)
            if (keyval === Gdk.KEY_Backspace && mask === 0) {
                settings.set_strv(key, []);
                this.close();
                return true;
            }

            // Record the shortcut
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
        this._window = window;
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Shortcuts',
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        // Fetch character catalog to populate dropdowns
        this._catalog = [];
        this._fetchCatalog();

        for (let i = 1; i <= 10; i++) {
            const group = new Adw.PreferencesGroup({
                title: `Focus Slot ${i}`,
            });
            page.add(group);
            this._addShortcutRow(group, settings, i);
        }
    }

    _fetchCatalog() {
        try {
            const bus = Gio.DBus.session;
            const reply = bus.call_sync(
                'dev.boxxy.BoxxyAgent',
                '/dev/boxxy/Agent',
                'dev.boxxy.BoxxyTerminal.Agent',
                'GetRegistrySnapshot',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );

            if (reply) {
                const [json] = reply.deepUnpack();
                const snapshot = JSON.parse(json);
                this._catalog = snapshot.catalog || [];
            }
        } catch (e) {
            console.error('[boxxy] prefs: failed to fetch catalog', e);
        }
    }

    _addShortcutRow(group, settings, index) {
        const slugKey = 'shortcut-slugs';
        const shortcutKey = `shortcut-${index}`;

        // -- Character Selector (ComboRow) --
        const currentSlugs = settings.get_strv(slugKey);
        const currentSlug = currentSlugs[index - 1] || '';

        const charModel = new Gtk.StringList();
        charModel.append('None');
        let selectedIndex = 0;

        this._catalog.forEach((char, i) => {
            const slug = char.config.name;
            const displayName = char.config.display_name || slug;
            charModel.append(displayName);
            if (slug === currentSlug) {
                selectedIndex = i + 1;
            }
        });

        const combo = new Adw.ComboRow({
            title: 'Character',
            model: charModel,
            selected: selectedIndex,
        });

        combo.connect('notify::selected', () => {
            const selected = combo.selected;
            const newSlugs = settings.get_strv(slugKey);
            if (selected === 0) {
                newSlugs[index - 1] = '';
            } else {
                newSlugs[index - 1] = this._catalog[selected - 1].config.name;
            }
            settings.set_strv(slugKey, newSlugs);
            shortcutRow.title = selected === 0 
                ? 'Shortcut' 
                : `Shortcut for ${this._catalog[selected - 1].config.display_name || this._catalog[selected - 1].config.name}`;
        });
        group.add(combo);

        // -- Shortcut Recorder Row --
        const initialCharName = selectedIndex > 0 
            ? (this._catalog[selectedIndex - 1].config.display_name || this._catalog[selectedIndex - 1].config.name)
            : null;

        const shortcutRow = new Adw.ActionRow({
            title: initialCharName ? `Shortcut for ${initialCharName}` : 'Shortcut',
            activatable: true,
        });

        const shortcutLabel = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            accelerator: settings.get_strv(shortcutKey)[0] || '',
        });

        settings.connect(`changed::${shortcutKey}`, () => {
            shortcutLabel.accelerator = settings.get_strv(shortcutKey)[0] || '';
        });

        shortcutRow.add_suffix(shortcutLabel);
        
        shortcutRow.connect('activated', () => {
            const dialog = new ShortcutRecorderDialog(
                this._window, 
                settings, 
                shortcutKey, 
                initialCharName || `Slot ${index}`
            );
            dialog.present();
        });

        group.add(shortcutRow);
    }
}
