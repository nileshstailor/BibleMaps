/**
 * Message router for Bible Maps.
 * No remote APIs required in v1.
 *
 * Side panel is tab-specific and only enabled on supported Bible reading sites.
 * Global default is disabled so the panel cannot linger as a window-level panel
 * after navigating away (Chrome will otherwise keep a globally-enabled panel open).
 */

const PANEL_PATH = "sidepanel/sidepanel.html";

/** Hostnames that receive content scripts / gazetteer scans (keep in sync with manifest). */
const SUPPORTED_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:bible\.com|biblegateway\.com|biblia\.com|blueletterbible\.org|biblehub\.com|biblestudytools\.com)$/i;

function isSupportedBibleUrl(url) {
  if (!url || !/^https?:/i.test(url)) return false;
  try {
    return SUPPORTED_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function closePanelForTab(tabId) {
  if (!chrome.sidePanel?.close || typeof tabId !== "number") return;
  // Prefer tab-specific close; fall back to window close for a global panel
  // that was opened before we switched to tab-only enablement.
  try {
    await chrome.sidePanel.close({ tabId });
    return;
  } catch {
    /* not a tab-specific panel, or already closed */
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (typeof tab?.windowId === "number") {
      await chrome.sidePanel.close({ windowId: tab.windowId });
    }
  } catch {
    /* ignore */
  }
}

async function setPanelForTab(tabId, url) {
  if (typeof tabId !== "number" || !chrome.sidePanel?.setOptions) return;
  const enabled = isSupportedBibleUrl(url);
  try {
    if (enabled) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: PANEL_PATH,
        enabled: true,
      });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await closePanelForTab(tabId);
    }
  } catch (err) {
    // Tab may have closed, or URL is chrome:// / restricted.
    console.warn("Bible Maps: sidePanel setOptions failed", err);
  }
}

async function syncPanelForActiveTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => setPanelForTab(t.id, t.url || "")));
  } catch (err) {
    console.warn("Bible Maps: could not sync side panels", err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    // Global default OFF — only tab-specific enable on Bible hosts may open.
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: false });
    }
  } catch (err) {
    console.warn("Bible Maps: sidePanel setup unavailable", err);
  }
  await syncPanelForActiveTabs();
});

chrome.runtime.onStartup?.addListener?.(() => {
  (async () => {
    try {
      await chrome.sidePanel?.setOptions?.({ path: PANEL_PATH, enabled: false });
    } catch {
      /* ignore */
    }
    await syncPanelForActiveTabs();
  })();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  // With openPanelOnActionClick this often does not fire; keep as fallback.
  if (!isSupportedBibleUrl(tab.url || "")) {
    await setPanelForTab(tab.id, tab.url || "");
    return;
  }
  try {
    await chrome.sidePanel.setOptions?.({
      tabId: tab.id,
      path: PANEL_PATH,
      enabled: true,
    });
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (err) {
    console.warn("Bible Maps: could not open side panel", err);
  }
});

const latestByTab = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  latestByTab.delete(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setPanelForTab(tabId, tab?.url || "");
  } catch {
    /* tab gone */
  }
});

// URL / load updates: gate the panel, and on supported SPA navigations clear stale detection.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  // Gate whenever the URL is known (url change or finished load).
  if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
    if (url) setPanelForTab(tabId, url);
  }
  if (!changeInfo.url) return;
  if (!isSupportedBibleUrl(changeInfo.url)) {
    // Leaving a Bible site — drop cached detections for this tab.
    latestByTab.delete(tabId);
    chrome.storage.session?.remove?.(`detection:${tabId}`).catch?.(() => {});
    return;
  }

  const cleared = {
    url: changeInfo.url,
    title: tab?.title || "",
    places: [],
    journeys: [],
    tabId,
    updatedAt: Date.now(),
    clearing: true,
  };
  latestByTab.set(tabId, cleared);
  chrome.storage.session
    ?.set?.({ [`detection:${tabId}`]: cleared })
    .catch?.(() => {});
  chrome.runtime
    .sendMessage({ type: "BIBLE_MAPS_DETECTION_UPDATED", payload: cleared })
    .catch(() => {});

  chrome.tabs
    .sendMessage(tabId, { type: "BIBLE_MAPS_RESCORE" })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "BIBLE_MAPS_DETECTION") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const payload = {
        ...message.payload,
        tabId,
        url: sender.tab?.url || message.payload?.url || "",
        updatedAt: Date.now(),
      };
      latestByTab.set(tabId, payload);
      chrome.storage.session
        ?.set?.({ [`detection:${tabId}`]: payload })
        .catch?.(() => {});
      chrome.runtime
        .sendMessage({ type: "BIBLE_MAPS_DETECTION_UPDATED", payload })
        .catch(() => {});
      setPanelForTab(tabId, payload.url);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (type === "BIBLE_MAPS_GET_DETECTION") {
    (async () => {
      try {
        const tabId =
          message.tabId ??
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
            ?.id;
        if (typeof tabId !== "number") {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        let payload = latestByTab.get(tabId);
        if (!payload && chrome.storage.session?.get) {
          const key = `detection:${tabId}`;
          const stored = await chrome.storage.session.get(key);
          payload = stored?.[key] || null;
        }
        sendResponse({ ok: true, payload: payload || null, tabId });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  if (type === "BIBLE_MAPS_OPEN_PANEL") {
    // IMPORTANT: chrome.sidePanel.open() must run in the same turn as the
    // user gesture. Do not await anything before calling open().
    const tabId = sender.tab?.id;
    const tabUrl = sender.tab?.url || "";
    if (typeof tabId !== "number" || !chrome.sidePanel?.open) {
      sendResponse({ ok: false, error: "Side panel unavailable" });
      return false;
    }
    if (!isSupportedBibleUrl(tabUrl)) {
      sendResponse({ ok: false, error: "Not a supported Bible site" });
      return false;
    }
    const placeId = message.placeId || null;
    if (placeId) {
      chrome.storage.session
        ?.set?.({
          pendingFocusPlace: { placeId, tabId, at: Date.now() },
        })
        .catch?.(() => {});
    }
    // Enable synchronously before open (no await) so the gesture stays valid.
    try {
      chrome.sidePanel.setOptions?.({
        tabId,
        path: PANEL_PATH,
        enabled: true,
      });
    } catch {
      /* ignore */
    }
    const openPromise = chrome.sidePanel.open({ tabId });
    openPromise
      .then(() => {
        if (placeId) {
          chrome.runtime
            .sendMessage({ type: "BIBLE_MAPS_FOCUS_PLACE", placeId })
            .catch(() => {});
        }
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
