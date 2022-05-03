const getCurrentTab = async () => {
  const tabs = await browser.tabs.query({
    active: true,
    windowId: browser.windows.WINDOW_ID_CURRENT,
  });
  return browser.tabs.get(tabs[0].id);
};

function* pairwise(array) {
  for (let baseIdx = 0; baseIdx <= array.length - 2; baseIdx++) {
    console.log(baseIdx, baseIdx + 2);
    yield array.slice(baseIdx, baseIdx + 2);
  }
}

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

    // we use a count because modifying idx in the for loop will mess with the
    // if statement
    let count = 0;
    for (const [i, tab] of recentTabs.entries()) {
      // i can never === idx because we wait for onActivated listener to finish
      // before executing the onRemoved listener
      if (tab.tabId === tabId && tab.windowId === windowId && i < idx) {
        count++;
      }
    }
    recentTabs = recentTabs
      .filter(tab => tab.tabId !== tabId || tab.windowId !== windowId); // remove closed tabs
    idx -= count;

    for (const [prevTab, curTab] of pairwise(recentTabs)) {
      if (prevTab.tabId === curTab.tabId && prevTab.windowId === curTab.windowId) {
        idx--;
      }
    }
    recentTabs = recentTabs.filter((curTab, pos, arr) => { // remove consecutive duplicates
      const prevTab = arr[pos - 1];
      // Always keep the 0th element as there is nothing before it
      // Then check if each element is different from the one before it
      return pos === 0 ||
        (prevTab.tabId !== curTab.tabId || prevTab.windowId !== curTab.windowId);
    });
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
