# Boxxy Terminal Companion Extension

A GNOME Shell 50 extension that serves as a companion to [Boxxy Terminal](https://github.com/boxxy-dev/boxxy), providing a top-panel indicator to monitor `boxxy-agent`, manage **Detached Background Shells**, track **Pending Reminders**, and focus or spawn AI characters.

## Features

- **Daemon Status & Control:** View live `boxxy-agent` status and version (including stale-binary upgrade hints), and start, reload, or stop the daemon directly from the panel.
- **Dev Agent Auto-Detection (`--dev`):** Automatically detects running `dev.boxxy.BoxxyAgent.Devel` and named `--instance <slug>` development daemons and displays inline **Restart** / **Stop** controls only while a dev instance is active.
- **Background Shells Badge & Restoration:**
  - Displays a live counter badge next to the top-bar icon whenever background terminal processes or scheduled tasks are active (switching to warning amber when a detached shell is waiting on interactive TTY input).
  - Restore individual or all detached shells back into live Boxxy tabs with full ANSI screen state preserved, or terminate them cleanly.
- **Pending Reminders:** Live 1-second countdowns for scheduled AI reminders, commands, and queries, with one-click **Focus/Restore** and **Cancel** actions.
- **Compact Character Roster:**
  - **Active (`In Use`)** characters appear directly in the menu for one-click pane focus.
  - **Available** characters are tucked into a collapsible dropdown—clicking any available character opens a new Boxxy Claw tab with that character claimed and ready to chat.
- **Global Shortcuts:** Assign up to 10 system-wide keyboard shortcuts (works offline in Extension Settings) to focus an active character or immediately spawn them in a new tab.

## Installation

Install manually using the included `Makefile`:

```bash
# Build and install to ~/.local/share/gnome-shell/extensions/boxxy@boxxy.dev
make install

# Enable the extension via gnome-extensions CLI
make enable
```

*Note: On Wayland, log out and log back in if GNOME Shell has not discovered the newly installed extension yet.*

## Want to Build a Boxxy Companion for Your Desktop?

Building a companion applet, status bar module, or launcher plugin for **KDE Plasma**, **COSMIC**, **Waybar**, **Hyprland**, **Rofi**, or **Walker**? Boxxy exposes its full companion interface over standard Session D-Bus—see the official documentation and API reference here:

👉 **[Boxxy Desktop Integrations & Companion API Docs](https://boxxy.dev/desktop-integrations)**

## License

MIT
