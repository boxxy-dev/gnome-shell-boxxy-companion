# Boxxy Companion — Developer Context

This extension provides a GNOME Shell panel indicator to monitor and control the `boxxy-agent` daemon, restore or terminate detached background shells, and focus active AI characters.

## Architecture
- **Entry Point:** Modern GNOME 45+ class-based entry (`BoxxyExtension extends Extension` in `extension.js`).
- **Target:** GNOME Shell 50. Uses `resource:///org/gnome/shell/...` ES module imports.
- **Daemon Lifecycle:** `Gio.DBusProxy` tracks the `dev.boxxy.BoxxyAgent` `g-name-owner` property to detect when the daemon starts/stops without auto-starting it.
- **Agent & Terminal Execution:** Shells out via `GLib.spawn_command_line_async` to `boxxy-agent` and `boxxy-terminal` (checking `~/.local/boxxy-terminal/bin/...`, `~/.local/boxxy-terminal/...`, `/app/bin/...`, `PATH`, or Flatpak).
- **Detached Background Shells & Panel Badge:**
  - Displays a live counter badge (`this._badgeLabel`) next to the panel icon whenever `GetDetachedSessions` / `DetachedSessionsChanged` reports running background shells (switching to `.boxxy-panel-badge-warning` when any shell has `waiting_for_input: true`).
  - Renders a `Background Shells (N)` section in the popup menu with `Restore All` / `Kill All` header buttons and per-session `Restore` / `Kill` buttons.
  - Clicking `Restore` calls `RequestRestoreDetached(pid)` on D-Bus and either focuses the open Boxxy window or launches `boxxy-terminal` (which automatically drains the queued PID via `TakePendingRestores` on startup).
- **Preferences & Shortcuts:** 
  - `prefs.js` provides a Libadwaita UI to map character slugs to 10 global shortcut slots.
  - State is saved via `GSettings` (`org.gnome.shell.extensions.boxxy-companion`).
  - `extension.js` registers these global keybindings via `Main.wm.addKeybinding`.
- **Character Roster:**
  - Fetches the current catalog via the `GetRegistrySnapshot` D-Bus method.
  - Subscribes to the `ClaimsChanged` D-Bus signal for live updates.
  - Maintains a local catalog reference to map keyboard shortcuts to active `pane_id`s.
  - Renders rows with avatars (`~/.config/boxxy-terminal/boxxyclaw/characters/<slug>/AVATAR.png`) or fallback color dots.
  - Clicking an active character (or triggering their shortcut) calls `RequestFocusPane(pane_id)` on the D-Bus interface to raise the terminal.

## D-Bus Contract (Session Bus)
- **Service / Well-known name:** `dev.boxxy.BoxxyAgent`
- **Object Path:** `/dev/boxxy/Agent`
- **Interface:** `dev.boxxy.BoxxyTerminal.Agent`

| Method / Signal | Notes |
|-----------------|-------|
| `GetRegistrySnapshot` | Method. Returns `(s)` (JSON string of `RegistrySnapshot`). |
| `RequestFocusPane(s)` | Method. Takes `pane_id` string. |
| `ClaimsChanged` | Signal. Pushed on claim change; carries `(s)` JSON payload. |
| `GetDetachedSessions` | Method. Returns `(s)` (JSON array of `DetachedSessionInfo`). |
| `RequestRestoreDetached(u)` | Method. Takes `pid` (`0` = restore all). Restores into open window or queues for next launch. |
| `TerminateDetachedSession(u)` | Method. Takes `pid` (`0` = terminate all). |
| `DetachedSessionsChanged` | Signal. Pushed on detach/reattach/exit; carries `(s)` JSON payload. |

*Note: The Rust daemon uses `zbus`, which converts `snake_case` to `PascalCase` on the wire.*

## GNOME Shell & GJS Gotchas
- **Menu Items:** Use `item.destroy()` to remove items from a popup menu. Do NOT use `removeMenuItem()`.
- **Insertion:** Use `menu.addMenuItem(item, index)` with a dynamically resolved index (`menu._getMenuItems().indexOf(...)`).
- **D-Bus Proxies:** Initialize with GObject properties (`{ g_connection, g_name, … }`), not positional arguments.
- **Signal Cleanup:** Every `Gio.DBus.session.signal_subscribe` or proxy listener created in `enable()` MUST be disconnected in `disable()` to prevent memory leaks during extension reloads.
- **Keybindings:** Global shortcuts registered with `Main.wm.addKeybinding` MUST be explicitly unregistered in `disable()` using `Main.wm.removeKeybinding` to prevent "already registered" errors on reload.
- **Styling:** Prefix all CSS classes with `boxxy-` to prevent Shell theme collisions.
