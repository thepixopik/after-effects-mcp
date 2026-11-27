let lastSeq = 0;

async function broadcastToActiveTab(payload) {
  try {
    const tabs = await chrome.tabs.query({ active: true });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch (_e) {}
}

async function pollLocalBridge() {
  while (true) {
    try {
      const res = await fetch("http://127.0.0.1:47832/poll?since=" + lastSeq, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.events)) {
          for (const ev of data.events) {
            if (ev.seq > lastSeq) lastSeq = ev.seq;
            if (ev.tool === "goto_url" && ev.url) {
              const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
              if (tabs[0] && tabs[0].id) {
                let target = ev.url.trim();
                if (!/^https?:\/\//i.test(target)) target = "https://" + target;
                chrome.tabs.update(tabs[0].id, { url: target }).catch(() => {});
              }
            } else {
              await broadcastToActiveTab(ev);
            }
          }
        }
      }
    } catch (_err) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await new Promise((r) => setTimeout(r, 180));
  }
}

pollLocalBridge();
chrome.runtime.onInstalled.addListener(() => { pollLocalBridge(); });
chrome.runtime.onStartup.addListener(() => { pollLocalBridge(); });
