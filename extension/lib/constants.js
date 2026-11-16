export const DBUS_SERVICE_STABLE = 'dev.boxxy.BoxxyAgent';
export const DBUS_SERVICE_DEVEL = 'dev.boxxy.BoxxyAgent.Devel';
export const DBUS_SERVICE_DEVEL_INSTANCE_PREFIX = 'dev.boxxy.BoxxyAgent.Devel.i_';

export const AGENT_IFACE = 'dev.boxxy.BoxxyTerminal.Agent';
export const AGENT_PATH = '/dev/boxxy/Agent';

export const FDO_DBUS_NAME = 'org.freedesktop.DBus';
export const FDO_DBUS_PATH = '/org/freedesktop/DBus';
export const FDO_DBUS_IFACE = 'org.freedesktop.DBus';

export const AGENT_BINARY = 'boxxy-agent';
export const TERMINAL_BINARY = 'boxxy-terminal';

// D-Bus methods (zbus converts Rust snake_case to PascalCase on the wire)
export const METHOD_GET_VERSION = 'GetVersion';
export const METHOD_GET_CONFIG_DIR = 'GetConfigDir';
export const METHOD_GET_DAEMON_STATUS = 'GetDaemonStatus';
export const METHOD_REQUEST_RELOAD = 'RequestReload';
export const METHOD_REQUEST_STOP = 'RequestStop';
export const METHOD_GET_SNAPSHOT = 'GetRegistrySnapshot';
export const METHOD_REQUEST_FOCUS = 'RequestFocusPane';
export const METHOD_REQUEST_SPAWN_CHARACTER = 'RequestSpawnCharacter';
export const METHOD_GET_DETACHED = 'GetDetachedSessions';
export const METHOD_RESTORE_DETACHED = 'RequestRestoreDetached';
export const METHOD_TERMINATE_DETACHED = 'TerminateDetachedSession';
export const METHOD_GET_PENDING_TASKS = 'GetPendingTasks';
export const METHOD_CANCEL_PENDING_TASK = 'CancelPendingTask';

// D-Bus signals
export const SIGNAL_CLAIMS_CHANGED = 'ClaimsChanged';
export const SIGNAL_DETACHED_CHANGED = 'DetachedSessionsChanged';
export const SIGNAL_PENDING_TASKS_CHANGED = 'PendingTasksChanged';

// UI sizing
export const AVATAR_SIZE = 36;
export const ROW_AVATAR_SIZE = 32;
export const COLOR_DOT_SIZE = 10;
export const SHORTCUT_SLOTS = 10;
export const DEFAULT_ACCENT_HEX = '#a855f7';
