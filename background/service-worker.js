/**
 * Message router for Bible Maps.
 * No remote APIs required in v1.
 */

const PANEL_PATH = "sidepanel/sidepanel.html";

chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
    }
  } catch (err) {
    console.warn("Bible Maps: sidePanel setup unavailable", err);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
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

// SPA chapter changes: clear stale detection and ask the content script to rescan.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (!/bible\.com/i.test(changeInfo.url)) return;

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
    if (typeof tabId !== "number" || !chrome.sidePanel?.open) {
      sendResponse({ ok: false, error: "Side panel unavailable" });
      return false;
    }
    const openPromise = chrome.sidePanel.open({ tabId });
    // setOptions can follow; must not precede open()
    try {
      chrome.sidePanel.setOptions?.({
        tabId,
        path: PANEL_PATH,
        enabled: true,
      });
    } catch {
      /* ignore */
    }
    openPromise
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
