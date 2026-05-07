# Boxxy Terminal Companion Extension

A GNOME Shell extension that serves as a companion to the [Boxxy Terminal](https://github.com/boxxy-dev/boxxy), providing a quick way to monitor and control the `boxxy-agent` daemon directly from your top panel.

## Features

- **Status Monitoring:** Quickly see if the `boxxy-agent` daemon is currently running.
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

This extension interacts with Boxxy Terminal via standard D-Bus interfaces. If you are building a companion app or applet for KDE Plasma, Waybar, or macOS, you can use the following D-Bus API reference:

### Service Details
- **Bus:** Session Bus
- **Service Name:** `dev.boxxy.BoxxyAgent`
- **Object Path:** `/dev/boxxy/Agent`
- **Interface:** `dev.boxxy.BoxxyTerminal.Agent`

### API Reference

| Method / Signal | Type | Description |
|-----------------|------|-------------|
| `GetRegistrySnapshot` | Method | Returns a JSON string (`RegistrySnapshot`) containing the full character catalog and their current claim status across all panes. |
| `RequestFocusPane(s)` | Method | Accepts a string `pane_id`. Sends a signal to the Boxxy UI to raise the window and focus the specific pane where the character is active. |
| `ClaimsChanged` | Signal | Emitted automatically whenever a character is claimed or released by a terminal pane. Payload is a JSON string identical to `GetRegistrySnapshot`. |

*Note: Boxxy is written in Rust using `zbus`, which automatically converts `snake_case` method names to `PascalCase` on the D-Bus wire.*

### D-Bus Proxy Example (CLI)
You can test the snapshot method from the terminal using `busctl`:
```bash
busctl --user call dev.boxxy.BoxxyAgent /dev/boxxy/Agent dev.boxxy.BoxxyTerminal.Agent GetRegistrySnapshot
```


## License

MIT
