import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {launchBoxxyTerminal} from '../lib/launcher.js';

const CANDIDATE_APP_IDS = [
    'dev.boxxy.BoxxyTerminal',
    'dev.boxxy.BoxxyTerminal.desktop',
    'boxxy-terminal',
    'boxxy-terminal.desktop',
    'com.github.queer.boxxy',
    'com.github.queer.BoxxyTerminal',
];

export function focusBoxxyWindow() {
    const appSystem = Shell.AppSystem.get_default();

    for (const id of CANDIDATE_APP_IDS) {
        const app = appSystem.lookup_app(id);
        if (app) {
            const windows = app.get_windows();
            if (windows.length > 0) {
                Main.activateWindow(windows[0]);
                return true;
            }
        }
    }

    const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
    for (const win of allWindows) {
        const wmClass = win.get_wm_class?.() ?? '';
        const title = win.get_title?.() ?? '';
        if (wmClass.startsWith('dev.boxxy.BoxxyTerminal.Devel'))
            continue;
        if ((wmClass + title).toLowerCase().includes('boxxy')) {
            Main.activateWindow(win);
            return true;
        }
    }

    return false;
}

export function focusOrLaunchBoxxyWindow() {
    if (!focusBoxxyWindow())
        launchBoxxyTerminal();
}
