# Boxxy Companion — Developer Context

This extension provides a GNOME Shell 50 panel indicator to monitor and control `boxxy-agent` (plus `--dev` instances), restore or terminate detached background shells, inspect pending reminders, and focus or spawn AI characters.

## Architecture & Module Layout
- **`extension/extension.js`:** Entry point (`BoxxyExtension extends Extension`). Wires lifecycle, `AgentClient`, `DevAgentWatcher`, `BoxxyIndicator`, and 10 global keybindings (`Main.wm.addKeybinding`).
- **`extension/prefs.js`:** Libadwaita preferences UI mapping character slugs to 10 global shortcut slots (`org.gnome.shell.extensions.boxxy-companion`). Seeds immediately from `~/.config/boxxy-terminal/boxxyclaw/characters/*/CHARACTER.toml` so it works offline without blocking, then refreshes asynchronously from `GetRegistrySnapshot` (`NO_AUTO_START`).
- **`extension/lib/` (Pure GI / D-Bus helpers — no `resource:///org/gnome/shell/...` imports):**
  - `constants.js`: D-Bus bus names, paths, method/signal names, and sizing constants.
  - `dbus.js`:
    - `AgentClient`: Uses `Gio.bus_watch_name` + direct async `Gio.DBus.session.call` (`NO_AUTO_START`) with `Gio.Cancellable` abort on daemon vanish / `disable()` and monotonic `snapshot.revision` filtering.
    - `DevAgentWatcher`: Subscribes to `org.freedesktop.DBus.NameOwnerChanged` with `MATCH_ARG0_NAMESPACE` (`dev.boxxy.BoxxyAgent.Devel`) + initial `ListNames` seed to detect both `--dev` and `--instance <slug>` daemons with zero polling.
  - `launcher.js`: Binary/Flatpak path resolution (`--background` for daemon start, `--present` for terminal launch).
  - `avatarCache.js`: `<configDir>::<slug>` `Gio.FileIcon` cache + CSS hex color sanitization (`sanitizeHexColor`).
  - `format.js`: Pure formatting helpers for countdowns, CWDs, character names, and detached processes.
- **`extension/ui/` (GNOME Shell St / PopupMenu views):**
  - `windowFocus.js`: `focusBoxxyWindow` & `focusOrLaunchBoxxyWindow` (skips `.Devel` windows when focusing stable).
  - `indicator.js`: `BoxxyIndicator` (`PanelMenu.Button`, panel badge, compact status header with Start/Reload/Stop controls, dynamic `DEV` agent rows, dirty-flagged lazy menu rendering while closed, and footer actions).
  - `sections/charactersSection.js`: Renders `Active` characters directly and collapses `Available` characters into a `PopupSubMenuMenuItem` dropdown (clicking spawns via `RequestSpawnCharacter`).
  - `sections/detachedSection.js`: Renders `Background Shells (N)` with `Restore All` / `Kill All` and per-shell controls.
  - `sections/tasksSection.js`: Renders `Pending Reminders (N)` and manages the menu-open 1s `GLib.timeout_add_seconds` countdown timer.

## D-Bus Contract (Session Bus)
- **Stable Service:** `dev.boxxy.BoxxyAgent`
- **Dev Services:** `dev.boxxy.BoxxyAgent.Devel` and `dev.boxxy.BoxxyAgent.Devel.i_<slug>`
- **Object Path:** `/dev/boxxy/Agent`
- **Interface:** `dev.boxxy.BoxxyTerminal.Agent`

Full public D-Bus API documentation lives in `boxxy-website` at `content/desktop-integrations.md` (`https://boxxy.dev/desktop-integrations`).

## GNOME Shell & GJS Gotchas
- **No `call_sync` on the Shell main thread:** Always use async `Gio.DBus.session.call` with a `Gio.Cancellable` cancelled in `disable()`.
- **BoxLayout Orientation:** On GNOME Shell 50, use `orientation: Clutter.Orientation.VERTICAL` instead of deprecated `vertical: true`.
- **Menu Sections:** Use `PopupMenu.PopupMenuSection` (`section.removeAll()`) rather than manual root-menu index arithmetic.
- **Keybindings & Signals:** Every `Gio.bus_watch_name`, `signal_subscribe`, `GLib.timeout_add_seconds`, and `Main.wm.addKeybinding` registered in `enable()` MUST be cleaned up in `disable()` (which runs on every screen lock).
- **Styling:** Prefix all CSS classes with `boxxy-` and validate dynamic hex colors via `sanitizeHexColor` before inline `style` use.
