// Manifest V3 service workers are ephemeral: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#persist-states
// state must be persisted in chrome.storage.session to store state for the current browser session

// Helper functions to get/set state from storage
const getState = async () => {
	// recentTabs is a list of recent tabs
	// each tab in recentTabs has 3 properties:
	// - tabId (int): the id of the tab
	// - windowId (int): the id of the window the tab is in
	// - accessTime (int): the time since the tab was last accessed
	// for each tab:
	// - positive accessTime mean tab is in the future (access it via ctrl+cmd+p)
	// - negative accessTime mean tab is in the past (access it via ctrl+cmd+o)
	// - 0 means the present (current) tab
	// - the smaller the accessTime, the longer it's been since the tab was accessed
	const { recentTabs = [], isTraversingHistory = false } =
		await chrome.storage.session.get(["recentTabs", "isTraversingHistory"]);
	return { recentTabs, isTraversingHistory };
};

const setState = async (updates) => {
	await chrome.storage.session.set(updates);
};

const getCurrentTab = async () => {
	const tabs = await chrome.tabs.query({
		active: true,
		currentWindow: true,
	});
	const tabId = tabs[0]?.id;
	return tabId ? await chrome.tabs.get(tabId) : null;
};

// binary search for current tab in recentTabs
// (current tab is the one where accessTime === 0)
const findCurrentTab = (recentTabs) => {
	let start = 0;
	let end = recentTabs.length - 1;

	while (start <= end) {
		const mid = Math.floor((start + end) / 2);
		const { accessTime } = recentTabs[mid];

		if (accessTime === 0) {
			return [mid, recentTabs[mid]];
		}

		if (accessTime > 0) {
			// we're in the future, so we need to go left
			end = mid - 1;
		} else {
			// we're in the past, so we need to go right
			start = mid + 1;
		}
	}
	return [-1, null];
};

const equals = (a, b) => a?.tabId === b?.tabId && a?.windowId === b?.windowId;

// Initialize on service worker startup
const initialize = async () => {
	const { recentTabs } = await getState();

	// Only initialize if we don't have any tabs stored
	if (recentTabs.length === 0) {
		const currentTab = await getCurrentTab();
		if (currentTab) {
			const { id: tabId, windowId } = currentTab;
			await setState({ recentTabs: [{ tabId, windowId, accessTime: 0 }] });
		}
	}
};

// removes all instances of closed tab from recentTabs
chrome.tabs.onRemoved.addListener(async (tabId, { windowId }) => {
	const tabToRemove = { tabId, windowId };
	let { recentTabs } = await getState();

	const [, curTab] = findCurrentTab(recentTabs);

	// If the removed tab was the current tab, wait a bit for onActivated to fire
	if (equals(curTab, tabToRemove)) {
		// Small delay to let onActivated process first
		await new Promise((resolve) => setTimeout(resolve, 50));
		// Re-fetch state after the delay
		({ recentTabs } = await getState());
	}

	// Remove all instances of closed tab from recentTabs
	// (Note: we cannot do find with binary search because recentTabs is sorted by accessTime,
	//  and we're searching by tabId and windowId)
	recentTabs = recentTabs.filter((tab) => !equals(tab, tabToRemove));
	await setState({ recentTabs });
});

// adds tab to recentTabs on tab change
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
	const { recentTabs: currentTabs, isTraversingHistory } = await getState();

	// The tab switch occurred as a result of this extension's action
	// (i.e., ctrl+cmd+p or ctrl+cmd+o)
	// We shouldn't treat this as a tab switch
	if (isTraversingHistory) {
		return;
	}

	let recentTabs = [...currentTabs];
	const tabToAdd = { tabId, windowId, accessTime: 0 };
	const [curIdx] = findCurrentTab(recentTabs);

	// If no current tab found (e.g., first activation), just add the tab
	if (curIdx === -1) {
		await setState({ recentTabs: [tabToAdd] });
		return;
	}

	// Remove all future tabs because modifying the past means you can no
	// longer access the future
	recentTabs.length = curIdx + 1;

	// Remove any instances of the newly activated tab because we'll soon add it to the array
	// 1 index after curIdx with accessTime = 0
	//
	// IMPORTANT: do not place this line above the line that removes all future tabs, because
	// the cut-off is based on the index of the current tab, which could change with this filter
	//
	// (Note: we cannot do find with binary search because recentTabs is sorted by accessTime,
	//  and we're searching by tabId and windowId)
	recentTabs = recentTabs.filter((tab) => !equals(tab, tabToAdd));

	// All tabs have aged by one
	for (const tab of recentTabs) {
		tab.accessTime--;
	}

	// Append the newly activated tab at the end
	recentTabs.push(tabToAdd);

	await setState({ recentTabs });
});

// ctrl+cmd+o or ctrl+cmd+p was pressed. We traverse history
chrome.commands.onCommand.addListener(async (command) => {
	// Set traversing flag to prevent onActivated from modifying state
	await setState({ isTraversingHistory: true });

	try {
		const { recentTabs: currentTabs } = await getState();
		const recentTabs = [...currentTabs];
		const [curIdx] = findCurrentTab(recentTabs);
		let newIdx;

		// Check bounds
		if (command === "go-back" && curIdx > 0) {
			newIdx = curIdx - 1;
		} else if (command === "go-forward" && curIdx < recentTabs.length - 1) {
			newIdx = curIdx + 1;
		}

		if (newIdx !== undefined) {
			const prevLastSeen = recentTabs[newIdx].accessTime;

			// Center all tabs around the tab we've traversed in time to,
			// setting this new tab to accessTime = 0
			for (const tab of recentTabs) {
				tab.accessTime -= prevLastSeen;
			}

			await setState({ recentTabs });

			// Switch to the tab
			await Promise.all([
				chrome.windows.update(recentTabs[newIdx].windowId, { focused: true }),
				chrome.tabs.update(recentTabs[newIdx].tabId, { active: true }),
			]);
		}
	} finally {
		// Always reset the traversing flag
		await setState({ isTraversingHistory: false });
	}
});

// Initialize when service worker starts
initialize();
