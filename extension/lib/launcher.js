import GLib from 'gi://GLib';

import {AGENT_BINARY, TERMINAL_BINARY} from './constants.js';

export function resolveAgentBinary() {
    const homeDir = GLib.get_home_dir();
    const candidates = [
        GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', 'bin', AGENT_BINARY]),
        GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', AGENT_BINARY]),
        GLib.build_filenamev([homeDir, '.local', 'bin', AGENT_BINARY]),
        GLib.build_filenamev(['/app', 'bin', AGENT_BINARY]),
    ];

    for (const candidate of candidates) {
        if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE))
            return candidate;
    }

    return GLib.find_program_in_path(AGENT_BINARY) || AGENT_BINARY;
}

export function resolveTerminalArgv(extraArgs = []) {
    const homeDir = GLib.get_home_dir();
    const candidates = [
        GLib.build_filenamev([homeDir, '.local', 'boxxy-terminal', 'bin', TERMINAL_BINARY]),
        GLib.build_filenamev([homeDir, '.local', 'bin', TERMINAL_BINARY]),
    ];

    for (const candidate of candidates) {
        if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE))
            return [candidate, ...extraArgs];
    }

    const inPath = GLib.find_program_in_path(TERMINAL_BINARY);
    if (inPath)
        return [inPath, ...extraArgs];

    return ['flatpak', 'run', 'dev.boxxy.BoxxyTerminal', ...extraArgs];
}

function spawnDetachedArgv(argv) {
    try {
        GLib.spawn_async(
            null,
            argv,
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null
        );
        return true;
    } catch (e) {
        console.error(`[boxxy] failed to spawn ${argv.join(' ')}:`, e);
        return false;
    }
}

export function startAgentDaemon() {
    const binary = resolveAgentBinary();
    // Pass `--background` so `boxxy-agent` double-forks and detaches cleanly from gnome-shell.
    return spawnDetachedArgv([binary, '--background']);
}

export function spawnAgentSubcommand(subcommand) {
    const binary = resolveAgentBinary();
    return spawnDetachedArgv([binary, subcommand]);
}

export function launchBoxxyTerminal() {
    return spawnDetachedArgv(resolveTerminalArgv(['--present']));
}
