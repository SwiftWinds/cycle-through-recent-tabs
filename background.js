let isTraversingHistory = false;
let recentTabs = [];

// we wait for onActivated listener to finish before executing the onRemoved listener
// when the tab removed was the current tab
let activationPromise;
let resolveActivationPromise;

const getCurrentTab = async () => {
  const tabs = await browser.tabs.query({
    active: true,
    windowId: browser.windows.WINDOW_ID_CURRENT,
  });
  return browser.tabs.get(tabs[0].id);
};

// binary search for current tab in recentTabs
// (current tab is the one where lastSeen === 0)
const findCurrentTab = () => {
  let start = 0;
  let end = recentTabs.length - 1;

  while (start <= end) {
    let mid = Math.floor((start + end) / 2);

    const { lastSeen } = recentTabs[mid];

    if (lastSeen === 0) {
      return [mid, recentTabs[mid]];
    }

    if (lastSeen < 0) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }
  return [-1, null];
};

const equals = (a, b) => a.tabId === b.tabId && a.windowId === b.windowId;

const main = async () => {

  // store current tab in recentTabs
  const { id: tabId, windowId } = await getCurrentTab();
  recentTabs.push({ tabId, windowId, lastSeen: 0 });

  // removes all instances of closed tab from recentTabs
  browser.tabs.onRemoved.addListener(async (tabId, { windowId }) => {
    const tabToRemove = { tabId, windowId };
    const [, curTab] = findCurrentTab();
    if (equals(curTab, tabToRemove)) {
      activationPromise = new Promise((resolve) => {
        resolveActivationPromise = resolve;
      });
      await activationPromise;
    }

    // we remove all instances of closed tab from recentTabs
    // (we cannot do binary search because it's sorted by lastSeen, not tabId
    //  or windowId)
    recentTabs = recentTabs.filter((tab) => !equals(tab, tabToRemove));
  });

  // adds tab to recentTabs on tab change
  browser.tabs.onActivated.addListener(
    ({ tabId, windowId }) => {
      const tabToAdd = { tabId, windowId, lastSeen: 0 };
      if (isTraversingHistory) {
        return;
      }
      const [curIdx] = findCurrentTab();
      if (curIdx !== recentTabs.length - 1) {
        recentTabs.length = curIdx + 1;
      }

      // we want to remove any instances of the newly activate tab from our
      // array because we'll append it to the end of the array later with
      // lastSeen = 0
      // (we cannot do binary search because it's sorted by lastSeen, not tabId
      //  or windowId)
      recentTabs = recentTabs.filter((tab) => !equals(tab, tabToAdd));

      for (const tab of recentTabs) {
        tab.lastSeen++;
      }

      recentTabs.push(tabToAdd);

      if (activationPromise) {
        resolveActivationPromise();
        activationPromise = null;
      }
    });

  browser.commands.onCommand.addListener(async (command) => {
    isTraversingHistory = true;
    const [curIdx] = findCurrentTab();
    let newIdx;
    if (command === "go-back" && curIdx > 0) {
      newIdx = curIdx - 1;
    } else if (command === "go-forward" && curIdx < recentTabs.length - 1) {
      newIdx = curIdx + 1;
    }
    if (newIdx !== undefined) {
      const prevLastSeen = recentTabs[newIdx].lastSeen;
      for (const tab of recentTabs) {
        tab.lastSeen -= prevLastSeen;
      }
      await Promise.all([
        browser.windows.update(recentTabs[newIdx].windowId, { focused: true }),
        browser.tabs.update(recentTabs[newIdx].tabId, { active: true }),
      ]);
    }

    isTraversingHistory = false;
  });
};

main();
