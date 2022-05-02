const getCurrentTab = async () => {
  const tabs = await browser.tabs.query({
    active: true,
    windowId: browser.windows.WINDOW_ID_CURRENT,
  });
  return browser.tabs.get(tabs[0].id);
};

const main = async () => {
  let isTraversingHistory = false;
  let idx = 0;
  let recentTabs = [];

  // we wait for onActivated listener to finish before executing the onRemoved listener
  // when the tab removed was the current tab
  let activationPromise;
  let resolveActivationPromise;

  // store current tab in recentTabs
  const { id: tabId, windowId } = await getCurrentTab();
  recentTabs.push({ tabId, windowId });

  // removes all instances of closed tab from recentTabs
  browser.tabs.onRemoved.addListener(async (tabId, { windowId }) => {
    if (tabId === recentTabs[idx].tabId) {
      activationPromise = new Promise(function(resolve) {
        resolveActivationPromise = resolve;
      });
      await activationPromise;
    }

    for (const [i, tab] of recentTabs.entries()) {
      if (tab.tabId === tabId && tab.windowId === windowId && i <= idx) {
        idx--;
      }
    }
    recentTabs = recentTabs
      .filter(tab => tab.tabId !== tabId || tab.windowId !== windowId) // remove closed tabs
      .filter((curTab, pos, arr) => { // remove consecutive duplicates
        const prevTab = arr[pos - 1];
        // Always keep the 0th element as there is nothing before it
        // Then check if each element is different from the one before it
        if (pos === 0 ||
          (prevTab.tabId !== curTab.tabId || prevTab.windowId !== curTab.windowId)) {
          return true;
        }
        idx--;
        return false;
      });

    idx--; // fix idx 1 too large afterwards
  });

  // adds tab to recentTabs on tab change
  browser.tabs.onActivated.addListener(
    async ({ tabId, windowId }) => {
      if (!isTraversingHistory) {
        recentTabs.length = idx + 1;
        recentTabs.push({ tabId, windowId });
        idx++;
      }

      if (activationPromise) {
        resolveActivationPromise();
        activationPromise = null;
      }
    });

  browser.commands.onCommand.addListener(async (command) => {
    isTraversingHistory = true;
    if (command === "go-back" && idx > 0) {
      idx--;
    } else if (command === "go-forward" && idx < recentTabs.length - 1) {
      idx++;
    }
    await Promise.all([
      browser.windows.update(recentTabs[idx].windowId, { focused: true }),
      browser.tabs.update(recentTabs[idx].tabId, { active: true }),
    ]);
    isTraversingHistory = false;
  });
};

main();
