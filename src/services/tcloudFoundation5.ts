export type TCloudFoundation5Capabilities = {
  foundation: string;
  apiVersion?: string;
  coreVersion?: string;
  forumManagement?: boolean;
  folderManagement?: boolean;
  upload?: boolean;
  rename?: boolean;
  moveItems?: boolean;
  trashRestore?: boolean;
  permanentDelete?: boolean;
  telegramDelta?: boolean;
  credentialBridge?: boolean;
  liveRefreshHintSeconds?: number;
  sessionCache?: boolean;
  maxWebUploadBytes?: number;
};

export type TCloudFoundation5State = {
  connected: boolean;
  checkedAt: number;
  capabilities: TCloudFoundation5Capabilities | null;
  error: string | null;
};

const CORE_URL =
  (import.meta.env.VITE_TCLOUD_CORE_URL as string | undefined)?.replace(/\/+$/, "") ??
  "http://127.0.0.1:8787";
const CACHE_KEY = "tcloud:foundation5:capabilities";
const EVENT_STATE = "tcloud:foundation5-state";
const EVENT_REFRESH = "tcloud:foundation5-refresh";
const EVENT_DATA = "tcloud:foundation5-data-changed";

let currentState: TCloudFoundation5State = {
  connected: false,
  checkedAt: 0,
  capabilities: null,
  error: null,
};

let started = false;
let timer: number | null = null;
let requestInFlight: Promise<TCloudFoundation5State> | null = null;
let liveRevision: string | null = null;
let liveRevisionInFlight: Promise<void> | null = null;

function publish(state: TCloudFoundation5State) {
  currentState = state;

  if (typeof document !== "undefined") {
    document.documentElement.dataset.tcloudFoundation =
      state.capabilities?.foundation ?? "offline";
    document.documentElement.dataset.tcloudCore =
      state.connected ? "online" : "offline";
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<TCloudFoundation5State>(EVENT_STATE, {
        detail: state,
      }),
    );
  }
}

function readCache() {
  if (typeof sessionStorage === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as TCloudFoundation5Capabilities;
    if (parsed?.foundation !== "5.0") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(value: TCloudFoundation5Capabilities) {
  if (typeof sessionStorage === "undefined") return;

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
  }
}

export function getTCloudFoundation5State() {
  return currentState;
}

export async function refreshTCloudFoundation5(
  force = false,
): Promise<TCloudFoundation5State> {
  if (requestInFlight && !force) return requestInFlight;

  requestInFlight = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(
        `${CORE_URL}/api/v1/platform/capabilities`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Core HTTP ${response.status}`);
      }

      const capabilities =
        (await response.json()) as TCloudFoundation5Capabilities;

      if (capabilities.foundation !== "5.0") {
        throw new Error(
          `Foundation inesperada: ${capabilities.foundation ?? "desconhecida"}`,
        );
      }

      writeCache(capabilities);

      const state: TCloudFoundation5State = {
        connected: true,
        checkedAt: Date.now(),
        capabilities,
        error: null,
      };

      publish(state);
      return state;
    } catch (error) {
      const cached = readCache();

      const state: TCloudFoundation5State = {
        connected: false,
        checkedAt: Date.now(),
        capabilities: cached,
        error: String(error),
      };

      publish(state);
      return state;
    } finally {
      window.clearTimeout(timeout);
      requestInFlight = null;
    }
  })();

  return requestInFlight;
}

async function pollTCloudLiveRevision(force = false) {
  if (liveRevisionInFlight && !force) return liveRevisionInFlight;

  liveRevisionInFlight = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1800);

    try {
      const response = await fetch(
        `${CORE_URL}/api/v1/live/revision`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );

      if (!response.ok) return;

      const payload = (await response.json()) as {
        revision?: string;
        changedAtMs?: number;
        filesCount?: number;
        foldersCount?: number;
      };

      const next = payload.revision ?? null;
      if (!next) return;

      const previous = liveRevision;
      liveRevision = next;

      if (previous !== null && previous !== next) {
        window.dispatchEvent(
          new CustomEvent(EVENT_DATA, {
            detail: {
              revision: next,
              previous,
              at: Date.now(),
              filesCount: payload.filesCount ?? 0,
              foldersCount: payload.foldersCount ?? 0,
            },
          }),
        );
      }
    } catch {
    } finally {
      window.clearTimeout(timeout);
      liveRevisionInFlight = null;
    }
  })();

  return liveRevisionInFlight;
}

export function foundation5MutationCompleted(scope = "all") {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(EVENT_REFRESH, {
      detail: { scope, at: Date.now() },
    }),
  );

  void refreshTCloudFoundation5(true);
  void pollTCloudLiveRevision(true);
}

function nextDelay() {
  if (typeof document === "undefined") return 30000;
  return document.visibilityState === "visible" ? 1000 : 5000;
}

function schedule() {
  if (timer !== null) window.clearTimeout(timer);

  timer = window.setTimeout(async () => {
    await Promise.all([
      refreshTCloudFoundation5(),
      pollTCloudLiveRevision(),
    ]);
    schedule();
  }, nextDelay());
}

export function startTCloudFoundation5Bridge() {
  if (started || typeof window === "undefined") return;

  started = true;

  const cached = readCache();
  if (cached) {
    publish({
      connected: false,
      checkedAt: 0,
      capabilities: cached,
      error: null,
    });
  }

  const refresh = () => {
    void refreshTCloudFoundation5(true);
    schedule();
  };

  window.addEventListener("online", refresh);
  window.addEventListener("focus", refresh);
  window.addEventListener(EVENT_REFRESH, refresh);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refresh();
    } else {
      schedule();
    }
  });

  void Promise.all([
    refreshTCloudFoundation5(),
    pollTCloudLiveRevision(true),
  ]);
  schedule();
}

if (typeof window !== "undefined") {
  startTCloudFoundation5Bridge();
}