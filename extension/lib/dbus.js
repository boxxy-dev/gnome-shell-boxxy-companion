import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    AGENT_IFACE,
    AGENT_PATH,
    DBUS_SERVICE_DEVEL,
    DBUS_SERVICE_DEVEL_INSTANCE_PREFIX,
    DBUS_SERVICE_STABLE,
    FDO_DBUS_IFACE,
    FDO_DBUS_NAME,
    FDO_DBUS_PATH,
    METHOD_CANCEL_PENDING_TASK,
    METHOD_GET_CONFIG_DIR,
    METHOD_GET_DAEMON_STATUS,
    METHOD_GET_DETACHED,
    METHOD_GET_PENDING_TASKS,
    METHOD_GET_SNAPSHOT,
    METHOD_GET_VERSION,
    METHOD_REQUEST_FOCUS,
    METHOD_REQUEST_RELOAD,
    METHOD_REQUEST_SPAWN_CHARACTER,
    METHOD_REQUEST_STOP,
    METHOD_RESTORE_DETACHED,
    METHOD_TERMINATE_DETACHED,
    SIGNAL_CLAIMS_CHANGED,
    SIGNAL_DETACHED_CHANGED,
    SIGNAL_PENDING_TASKS_CHANGED,
} from './constants.js';
import {formatDevInstanceLabel} from './format.js';
import {spawnAgentSubcommand} from './launcher.js';

function isCancelled(error) {
    return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}

function isUnknownMethod(error) {
    const msg = error?.message || '';
    return (
        Boolean(error?.matches?.(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD)) ||
        msg.includes('UnknownMethod')
    );
}

function callSessionBus(busName, objectPath, ifaceName, methodName, params, replyType, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            busName,
            objectPath,
            ifaceName,
            methodName,
            params,
            replyType,
            Gio.DBusCallFlags.NO_AUTO_START,
            5000,
            cancellable,
            (conn, result) => {
                try {
                    resolve(conn.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

/**
 * Reactive session-bus client for the primary `dev.boxxy.BoxxyAgent` daemon.
 * Uses `Gio.Bus.watch_name` + direct async D-Bus calls (zero `Introspect` proxy churn)
 * and cancels all in-flight calls cleanly on daemon stop or extension `disable()`.
 */
export class AgentClient {
    constructor(callbacks) {
        this._callbacks = callbacks;
        this._running = false;
        this._watchId = 0;
        this._signalIds = [];
        this._cancellable = null;
        this._lastRevision = -1;
    }

    get isRunning() {
        return this._running;
    }

    start() {
        if (this._watchId)
            return;

        this._watchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            DBUS_SERVICE_STABLE,
            Gio.BusNameWatcherFlags.NONE,
            () => this._onNameAppeared(),
            () => this._onNameVanished()
        );
    }

    destroy() {
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
        this._teardownSession();
        this._running = false;
    }

    _onNameAppeared() {
        this._teardownSession();
        this._running = true;
        this._lastRevision = -1;
        this._cancellable = new Gio.Cancellable();

        this._subscribeSignals();
        this._callbacks.onStateChanged?.(true);

        this.refreshAll();
    }

    _onNameVanished() {
        const wasRunning = this._running;
        this._teardownSession();
        this._running = false;
        this._lastRevision = -1;
        if (wasRunning || this._watchId)
            this._callbacks.onStateChanged?.(false);
    }

    _teardownSession() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        for (const id of this._signalIds)
            Gio.DBus.session.signal_unsubscribe(id);
        this._signalIds = [];
    }

    _subscribeSignals() {
        const subscribe = (signalName, handler) => {
            const id = Gio.DBus.session.signal_subscribe(
                DBUS_SERVICE_STABLE,
                AGENT_IFACE,
                signalName,
                AGENT_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, params) => {
                    try {
                        const [json] = params.deepUnpack();
                        handler(json);
                    } catch (e) {
                        console.error(`[boxxy] signal ${signalName} unpack error:`, e);
                    }
                }
            );
            this._signalIds.push(id);
        };

        subscribe(SIGNAL_CLAIMS_CHANGED, json => {
            if (!json)
                return;
            try {
                this._handleSnapshot(JSON.parse(json));
            } catch (e) {
                console.error('[boxxy] ClaimsChanged JSON error:', e);
            }
        });

        subscribe(SIGNAL_DETACHED_CHANGED, json => {
            try {
                const list = JSON.parse(json || '[]');
                this._callbacks.onDetachedChanged?.(Array.isArray(list) ? list : []);
            } catch (e) {
                console.error('[boxxy] DetachedSessionsChanged JSON error:', e);
            }
        });

        subscribe(SIGNAL_PENDING_TASKS_CHANGED, json => {
            try {
                const list = JSON.parse(json || '[]');
                this._callbacks.onTasksChanged?.(Array.isArray(list) ? list : []);
            } catch (e) {
                console.error('[boxxy] PendingTasksChanged JSON error:', e);
            }
        });
    }

    _handleSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object')
            return;
        const rev = typeof snapshot.revision === 'number' ? snapshot.revision : -1;
        if (rev >= 0 && rev < this._lastRevision)
            return;
        if (rev >= 0)
            this._lastRevision = rev;

        this._callbacks.onCatalogChanged?.(Array.isArray(snapshot.catalog) ? snapshot.catalog : [], rev);
    }

    async _call(methodName, params = null, replyType = null) {
        if (!this._running || !this._cancellable)
            return null;
        return callSessionBus(
            DBUS_SERVICE_STABLE,
            AGENT_PATH,
            AGENT_IFACE,
            methodName,
            params,
            replyType,
            this._cancellable
        );
    }

    refreshAll() {
        if (!this._running)
            return;
        void this.fetchStatus();
        void this.fetchRegistry();
        void this.fetchDetachedSessions();
        void this.fetchPendingTasks();
    }

    refreshVolatile() {
        if (!this._running)
            return;
        void this.fetchStatus();
        void this.fetchDetachedSessions();
        void this.fetchPendingTasks();
    }

    async fetchStatus() {
        try {
            const reply = await this._call(
                METHOD_GET_DAEMON_STATUS,
                null,
                new GLib.VariantType('(s)')
            );
            if (!reply)
                return;
            const [json] = reply.deepUnpack();
            const parsed = JSON.parse(json || '{}');
            this._callbacks.onStatusMetadata?.(parsed);
            return;
        } catch (e) {
            if (isCancelled(e))
                return;
            if (!isUnknownMethod(e)) {
                console.debug('[boxxy] GetDaemonStatus failed:', e.message);
                return;
            }
        }

        // Graceful fallback for older boxxy-agent binaries prior to GetDaemonStatus
        try {
            const [verReply, cfgReply] = await Promise.all([
                this._call(METHOD_GET_VERSION, null, new GLib.VariantType('(s)')),
                this._call(METHOD_GET_CONFIG_DIR, null, new GLib.VariantType('(s)')),
            ]);
            if (!verReply)
                return;
            const [rawVersion] = verReply.deepUnpack();
            const [configDir] = cfgReply ? cfgReply.deepUnpack() : [''];
            const isStale = rawVersion.endsWith('-stale');
            const version = isStale ? rawVersion.slice(0, -'-stale'.length) : rawVersion;
            this._callbacks.onStatusMetadata?.({
                version,
                is_stale_binary: isStale,
                config_dir: configDir,
            });
        } catch (e) {
            if (!isCancelled(e))
                console.debug('[boxxy] fallback version fetch failed:', e.message);
        }
    }

    async fetchRegistry() {
        try {
            const reply = await this._call(
                METHOD_GET_SNAPSHOT,
                null,
                new GLib.VariantType('(s)')
            );
            if (!reply)
                return;
            const [json] = reply.deepUnpack();
            this._handleSnapshot(JSON.parse(json || '{}'));
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] GetRegistrySnapshot error:', e);
        }
    }

    async fetchDetachedSessions() {
        try {
            const reply = await this._call(
                METHOD_GET_DETACHED,
                null,
                new GLib.VariantType('(s)')
            );
            if (!reply)
                return;
            const [json] = reply.deepUnpack();
            const list = JSON.parse(json || '[]');
            this._callbacks.onDetachedChanged?.(Array.isArray(list) ? list : []);
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] GetDetachedSessions error:', e);
        }
    }

    async fetchPendingTasks() {
        try {
            const reply = await this._call(
                METHOD_GET_PENDING_TASKS,
                null,
                new GLib.VariantType('(s)')
            );
            if (!reply)
                return;
            const [json] = reply.deepUnpack();
            const list = JSON.parse(json || '[]');
            this._callbacks.onTasksChanged?.(Array.isArray(list) ? list : []);
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] GetPendingTasks error:', e);
        }
    }

    async requestFocusPane(paneId) {
        try {
            await this._call(
                METHOD_REQUEST_FOCUS,
                new GLib.Variant('(s)', [String(paneId)])
            );
            void this.fetchDetachedSessions();
            return true;
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] RequestFocusPane failed:', e);
            return false;
        }
    }

    async requestSpawnCharacter(character, cwd = '') {
        try {
            await this._call(
                METHOD_REQUEST_SPAWN_CHARACTER,
                new GLib.Variant('(ss)', [String(character), String(cwd || '')])
            );
            return true;
        } catch (e) {
            if (isCancelled(e))
                return false;
            if (isUnknownMethod(e)) {
                console.debug('[boxxy] RequestSpawnCharacter not supported by running daemon; opening window');
                return false;
            }
            console.error('[boxxy] RequestSpawnCharacter failed:', e);
            return false;
        }
    }

    async restoreDetachedSession(pid) {
        try {
            await this._call(
                METHOD_RESTORE_DETACHED,
                new GLib.Variant('(u)', [Number(pid) >>> 0])
            );
            void this.fetchDetachedSessions();
            return true;
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] RequestRestoreDetached failed:', e);
            return false;
        }
    }

    async terminateDetachedSession(pid) {
        try {
            await this._call(
                METHOD_TERMINATE_DETACHED,
                new GLib.Variant('(u)', [Number(pid) >>> 0])
            );
            void this.fetchDetachedSessions();
            void this.fetchPendingTasks();
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] TerminateDetachedSession failed:', e);
        }
    }

    async cancelPendingTask(paneId, taskId) {
        try {
            await this._call(
                METHOD_CANCEL_PENDING_TASK,
                new GLib.Variant('(ss)', [String(paneId), String(taskId)])
            );
            void this.fetchPendingTasks();
            void this.fetchDetachedSessions();
        } catch (e) {
            if (!isCancelled(e))
                console.error('[boxxy] CancelPendingTask failed:', e);
        }
    }

    async requestReload() {
        try {
            await this._call(METHOD_REQUEST_RELOAD);
        } catch (e) {
            if (isCancelled(e))
                return;
            if (isUnknownMethod(e)) {
                spawnAgentSubcommand('restart');
                return;
            }
            console.error('[boxxy] RequestReload failed:', e);
        }
    }

    async requestStop() {
        try {
            await this._call(METHOD_REQUEST_STOP);
        } catch (e) {
            if (isCancelled(e))
                return;
            if (isUnknownMethod(e)) {
                spawnAgentSubcommand('stop');
                return;
            }
            console.error('[boxxy] RequestStop failed:', e);
        }
    }
}

function isDevAgentBusName(name) {
    return (
        name === DBUS_SERVICE_DEVEL ||
        name.startsWith(DBUS_SERVICE_DEVEL_INSTANCE_PREFIX)
    );
}

/**
 * Zero-polling watcher for isolated development daemons (`dev.boxxy.BoxxyAgent.Devel`
 * and `dev.boxxy.BoxxyAgent.Devel.i_<slug>`). Uses D-Bus `arg0namespace` kernel/daemon
 * filtering so GNOME Shell is only notified when a Boxxy dev daemon starts or exits.
 */
export class DevAgentWatcher {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._instances = new Map();
        this._signalId = 0;
        this._cancellable = null;
    }

    get instances() {
        return Array.from(this._instances.values());
    }

    start() {
        if (this._signalId)
            return;

        this._cancellable = new Gio.Cancellable();
        this._signalId = Gio.DBus.session.signal_subscribe(
            FDO_DBUS_NAME,
            FDO_DBUS_IFACE,
            'NameOwnerChanged',
            FDO_DBUS_PATH,
            DBUS_SERVICE_DEVEL,
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [name, _oldOwner, newOwner] = params.deepUnpack();
                if (!isDevAgentBusName(name))
                    return;
                if (newOwner)
                    this._addInstance(name);
                else
                    this._removeInstance(name);
            }
        );

        void this._seedExistingInstances();
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._signalId) {
            Gio.DBus.session.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        this._instances.clear();
    }

    async _seedExistingInstances() {
        try {
            const reply = await callSessionBus(
                FDO_DBUS_NAME,
                FDO_DBUS_PATH,
                FDO_DBUS_IFACE,
                'ListNames',
                null,
                new GLib.VariantType('(as)'),
                this._cancellable
            );
            if (!reply)
                return;
            const [names] = reply.deepUnpack();
            let changed = false;
            for (const name of names) {
                if (isDevAgentBusName(name) && !this._instances.has(name)) {
                    this._instances.set(name, {
                        busName: name,
                        label: formatDevInstanceLabel(name),
                        version: '',
                    });
                    changed = true;
                    void this._fetchInstanceVersion(name);
                }
            }
            if (changed)
                this._emitChanged();
        } catch (e) {
            if (!isCancelled(e))
                console.debug('[boxxy] DevAgentWatcher ListNames failed:', e.message);
        }
    }

    _addInstance(busName) {
        this._instances.set(busName, {
            busName,
            label: formatDevInstanceLabel(busName),
            version: '',
        });
        this._emitChanged();
        void this._fetchInstanceVersion(busName);
    }

    _removeInstance(busName) {
        if (this._instances.delete(busName))
            this._emitChanged();
    }

    async _fetchInstanceVersion(busName) {
        try {
            const reply = await callSessionBus(
                busName,
                AGENT_PATH,
                AGENT_IFACE,
                METHOD_GET_VERSION,
                null,
                new GLib.VariantType('(s)'),
                this._cancellable
            );
            if (!reply)
                return;
            const [version] = reply.deepUnpack();
            const entry = this._instances.get(busName);
            if (entry && entry.version !== version) {
                entry.version = version;
                this._emitChanged();
            }
        } catch (e) {
            if (!isCancelled(e))
                console.debug(`[boxxy] dev-agent GetVersion(${busName}) failed:`, e.message);
        }
    }

    _emitChanged() {
        const sorted = Array.from(this._instances.values()).sort((a, b) =>
            a.busName.localeCompare(b.busName)
        );
        this._onChanged?.(sorted);
    }

    async stopInstance(busName) {
        try {
            await callSessionBus(
                busName,
                AGENT_PATH,
                AGENT_IFACE,
                METHOD_REQUEST_STOP,
                null,
                null,
                this._cancellable
            );
        } catch (e) {
            if (!isCancelled(e))
                console.error(`[boxxy] RequestStop(${busName}) failed:`, e);
        }
    }

    async reloadInstance(busName) {
        try {
            await callSessionBus(
                busName,
                AGENT_PATH,
                AGENT_IFACE,
                METHOD_REQUEST_RELOAD,
                null,
                null,
                this._cancellable
            );
        } catch (e) {
            if (!isCancelled(e))
                console.error(`[boxxy] RequestReload(${busName}) failed:`, e);
        }
    }
}
