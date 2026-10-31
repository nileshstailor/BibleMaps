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
  } catch (err) {
    console.warn("Bible Maps: sidePanel behavior unavailable", err);
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

/**
 * Latest detection payload keyed by tab id.
 * Side panel asks for the active tab's results.
 */
const latestByTab = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  latestByTab.delete(tabId);
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
      // Fan out to any open extension pages (side panel).
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
    (async () => {
      try {
        const tabId =
          sender.tab?.id ??
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
            ?.id;
        if (typeof tabId === "number" && chrome.sidePanel?.open) {
          await chrome.sidePanel.setOptions?.({
            tabId,
            path: PANEL_PATH,
            enabled: true,
          });
          await chrome.sidePanel.open({ tabId });
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  return false;
});
