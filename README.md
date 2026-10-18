# Boxxy Terminal Companion Extension

A GNOME Shell extension that serves as a companion to [Boxxy Terminal](https://github.com/boxxy-dev/boxxy), providing a top-panel indicator to monitor `boxxy-agent`, manage **Detached Background Shells**, and quickly focus active AI characters.

## Features

- **Status Monitoring:** Quickly see if the `boxxy-agent` daemon is currently running.
- **Background Shells Badge & Restoration:**
  - Displays a live counter badge next to the top-bar icon whenever background terminal processes (`top`, `nvim`, `cachy-update`, `cargo`, etc.) are detached in `boxxy-agent` (highlighting in warning amber when a background process is waiting for interactive user input).
  - Lists all detached background shells in the menu with per-process **Restore** and **Kill** buttons (plus **Restore All** and **Kill All**).
  - Clicking **Restore** raises Boxxy Terminal (or launches a new Boxxy window if closed) and reattaches the background shell into a live tab with its full ANSI screen and title preserved.
- **Daemon Control:** Start, stop, or restart the agent daemon with a single click.
- **Character Roster:** View all active and available AI characters from your catalog.
- **Quick Focus:** Click on an active character to immediately bring the corresponding terminal pane to the front.
- **Global Shortcuts:** Assign system-wide keyboard shortcuts (via Extension Settings) to instantly focus specific characters from anywhere.

## Installation

You can install this extension manually using the provided Makefile:

```bash
# Build and install to your local extensions directory
make install

# Enable the extension via gnome-extensions CLI
make enable
```

*Note: You may need to log out and log back in, or restart GNOME Shell (Alt+F2, type `r`, Enter on X11) for the extension to appear.*

## Developer Info & Integration (Other Desktop Environments)

This extension interacts with Boxxy Terminal exclusively via standard D-Bus interfaces on the user's Session Bus. If you are building a companion applet, status bar module, or Raycast/Alfred/Rofi plugin for **KDE Plasma**, **COSMIC**, **Waybar**, **Hyprland**, or **macOS**, you can use the complete D-Bus API reference below.

### Service Details
- **Bus:** Session Bus
- **Service Name:** `dev.boxxy.BoxxyAgent`
- **Object Path:** `/dev/boxxy/Agent`
- **Interface:** `dev.boxxy.BoxxyTerminal.Agent`

*Note: Boxxy is written in Rust using `zbus`, which automatically converts Rust `snake_case` method names to `PascalCase` on the D-Bus wire.*

### 1. Character Roster & Focus API

| Method / Signal | Signature | Type | Description |
|-----------------|-----------|------|-------------|
| `GetRegistrySnapshot` | `() -> (s)` | Method | Returns a JSON string (`RegistrySnapshot`) containing the full character catalog (`catalog`) and active claims (`claims`). |
| `RequestFocusPane` | `(s) -> ()` | Method | Accepts a `pane_id` string. Signals the Boxxy UI to raise the window and focus the pane where the character is active. |
| `ClaimsChanged` | `(s)` | Signal | Emitted whenever a character is claimed or released by a terminal pane. Payload is a JSON string identical to `GetRegistrySnapshot`. |

### 2. Detached Background Shells API (Terminal Restoration)

| Method / Signal | Signature | Type | Description |
|-----------------|-----------|------|-------------|
| `GetDetachedSessions` | `() -> (s)` | Method | Returns a JSON array of `DetachedSessionInfo` objects for all background shells kept alive in `boxxy-agent`. |
| `RequestRestoreDetached` | `(u) -> ()` | Method | Accepts `pid` (`u32`, or `0` to restore **all** detached shells). If a Boxxy window is open, emits `RestoreDetachedRequested(pid, cwd)` to reattach it into a tab immediately. If no Boxxy window is open, queues the PID in the daemon so launching `boxxy-terminal` automatically restores it on startup. |
| `TerminateDetachedSession` | `(u) -> ()` | Method | Accepts `pid` (`u32`, or `0` to terminate **all** detached shells). Disables persistence and sends `SIGTERM` to the background process group. |
| `DetachedSessionsChanged` | `(s)` | Signal | Emitted whenever a shell detaches, reattaches, is terminated, or exits. Payload is a JSON string identical to `GetDetachedSessions`. |
| `RestoreDetachedRequested` | `(u, s)` | Signal | Emitted to open Boxxy UI windows (`(pid, cwd)`) when `RequestRestoreDetached` is called while a UI window is attached. |

#### `GetDetachedSessions` / `DetachedSessionsChanged` JSON Schema

```json
[
  {
    "pid": 121283,
    "pane_id": "6f8a0c1e-3a4b-4d2a-9c1b-8e7f6a5b4c3d",
    "idle_secs": 6,
    "cwd": "/home/me/Projects/boxxy-dev/boxxy-terminal",
    "foreground_process": "cachy-update",
    "waiting_for_input": true
  }
]
```

- `waiting_for_input`: `true` when the kernel wait channel (`/proc/<fg_pid>/wchan`) shows the foreground child process is blocked on interactive TTY input (`n_tty_read` / `tty_read`, e.g., a `[Y/n]` or `sudo` password prompt).

### CLI Examples (`busctl`)

```bash
# 1. Inspect active AI characters and claims
busctl --user call dev.boxxy.BoxxyAgent /dev/boxxy/Agent dev.boxxy.BoxxyTerminal.Agent GetRegistrySnapshot

# 2. List detached background shells (JSON)
busctl --user call dev.boxxy.BoxxyAgent /dev/boxxy/Agent dev.boxxy.BoxxyTerminal.Agent GetDetachedSessions

# 3. Restore a specific detached shell by PID (or pass 0 to restore all)
busctl --user call dev.boxxy.BoxxyAgent /dev/boxxy/Agent dev.boxxy.BoxxyTerminal.Agent RequestRestoreDetached u 121283

# 4. Terminate a specific detached shell by PID (or pass 0 to terminate all)
busctl --user call dev.boxxy.BoxxyAgent /dev/boxxy/Agent dev.boxxy.BoxxyTerminal.Agent TerminateDetachedSession u 121283
```

## License

MIT
