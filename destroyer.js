/* globals $, chrome */
var usedOn = {};
var openedOn = {};
var accessed = {};
var activeTabId;
var timeout;
var activeInterval = 2500;
var memory_units = 1000000; // MB

function _debug() {
    // console.log.apply(console, arguments);
}

function _getMax() {
    return parseInt(localStorage.max || 20);
}

function _getMemory() {
    return parseInt(localStorage.memory || 1500);
}

function _getAlgo() {
    return localStorage.algo || 'used';
}

function _markActive(tabId) {
    _debug('marked active', tabId);
    usedOn[tabId] = new Date().getTime();
    accessed[tabId] += 1;
}

function _handleTabActivated(data) {
    var tabId = data.tabId;
    activeTabId = tabId;
    _debug('activated', tabId);

    clearTimeout(timeout);

    // after 3 seconds mark this tab as active
    // this is so if you are quickly switching tabs
    // they are not considered active
    timeout = setTimeout(function() {
        _markActive(tabId);
    }, activeInterval);
}

function _handleTabRemoved(tabId) {
    clearTimeout(timeout);

    _debug('removed', tabId);
    delete usedOn[tabId];
    delete openedOn[tabId];
    delete accessed[tabId];
}

function _removeTab(tabId) {
    _debug('_removeTab', tabId);
    if (tabId) {
        chrome.tabs.remove(tabId, function() {});
        // _handleTabRemoved(tabId);
    }
}

function _getLowestIn(data, tabs) {
    var lowest;
    var lowestIndex;
    var tabId;
    var value;
    for (var i = 0; i < tabs.length; i++) {
        tabId = tabs[i].id;

        // never close the currently active tab
        if (tabId === activeTabId) {
            continue;
        }

        // if you have never been to this tab then skip it
        if (!data.hasOwnProperty(tabId)) {
            continue;
        }

        value = data[tabId] || 0;

        if (lowest === undefined) {
            lowest = value;
        }

        if (value <= lowest) {
            lowestIndex = i;
            lowest = value;
        }
    }

    return lowestIndex;
}

function _saveRemovedTabInfo(tab) {
    _debug('backing up removed tab:', tab);
    if (localStorage.removed_tabs !== undefined && localStorage.removed_tabs.length > 0) {
        var removed_tabs = JSON.parse(localStorage.removed_tabs);
    } else {
        var removed_tabs = [];
    }
    info = {url: tab.url, title: tab.title, timestamp: new Date().getTime()};
    removed_tabs.push(info);
    localStorage.removed_tabs = JSON.stringify(removed_tabs);
}

function _removeByMemoryHeuristic(tabs, sum) {
    // We only delete one tab, here.  We get called more often, if required.
    if (sum > _getMemory() * 1.15) { // Allow some leeway, to let things settle

        // fixme: what's the best way to use the memory info?  We are just
        // removing the least accessed, right now.  It may work well, but
        // instead of closing n light-weight tabs, we could close one heavy
        // weight tab...
        // We could be a little fuzzy, and remove one of the least recently
        // used 5 tabs?
        var removed = _removeLeastRecentlyUsed(tabs);

        // We also log the tabs that we are closing ...  This code could be in
        // remove handler, but we don't want to create a copy of the browsing
        // history!  We only want a log of the automatically closed stuff.
        _saveRemovedTabInfo(removed);

    }
}

function _getTotalMemory(process_data) {
    var sum = 0;
    for(process in process_data){
        sum += process_data[process].privateMemory;
    }
    sum /= memory_units;
    _debug('total memory in MB:', sum);
    return sum;
}

function _removeMemoryHogsIfAny(tabs){
    chrome.processes.getProcessInfo([], true, function(process_data) {
        var sum = _getTotalMemory(process_data);
        var previous_length = tabs.length;
        _removeByMemoryHeuristic(tabs, sum);

        if (previous_length != tabs.length) {
            // If tabs were removed, get greedy!
            var query = {pinned:false, active:false};
            chrome.tabs.query(query, function(tabs) {
                _removeMemoryHogsIfAny(tabs);
            });
        }
    });
}

function _removeLeastAccessed(tabs) {
    var removeTabIndex = _getLowestIn(accessed, tabs);
    if (removeTabIndex >= 0) {
        _removeTab(tabs[removeTabIndex].id);
        return tabs.splice(removeTabIndex, 1)[0];
    }
}

function _removeOldest(tabs) {
    var removeTabIndex = _getLowestIn(openedOn, tabs);
    if (removeTabIndex >= 0) {
        _removeTab(tabs[removeTabIndex].id);
        return tabs.splice(removeTabIndex, 1)[0];
    }
}

function _removeLeastRecentlyUsed(tabs) {
    var removeTabIndex = _getLowestIn(usedOn, tabs);
    if (removeTabIndex >= 0) {
        _removeTab(tabs[removeTabIndex].id);
        return tabs.splice(removeTabIndex, 1)[0];
    }
}

function _removeTabs(tabs) {
    var length = tabs.length;
    _debug('there are', tabs.length, 'tabs open');
    _debug('max is', _getMax());
    while (length >= _getMax()) {
        _debug('removing a tab with length', length);
        switch (_getAlgo()) {
            case 'oldest':
                _removeOldest(tabs);
                break;
            case 'accessed':
                _removeLeastAccessed(tabs);
                break;
            default:
                _removeLeastRecentlyUsed(tabs);
                break;
        }
        length -= 1;
    }
}

function _handleTabAdded(data) {
    var tabId = data.id || data;

    _debug('added', tabId);

    // find tab to remove
    var query = {active:false, pinned:false}
    if (_getAlgo() !== 'memory') {
        query.currentWindow = true;
    }
    chrome.tabs.query(query, function(tabs) {
        if (_getAlgo() === 'memory') {
            _removeMemoryHogsIfAny(tabs);
        } else if (tabs.length >= _getMax()) {
            _removeTabs(tabs);
        }
        openedOn[tabId] = new Date().getTime();
        accessed[tabId] = 0;
    });
}

function _bindEvents() {
    chrome.tabs.onActivated.addListener(_handleTabActivated);
    chrome.tabs.onCreated.addListener(_handleTabAdded);
    chrome.tabs.onAttached.addListener(_handleTabAdded);
    chrome.tabs.onRemoved.addListener(_handleTabRemoved);
    chrome.tabs.onDetached.addListener(_handleTabRemoved);
}

function _init() {

    // on startup loop through all existing tabs and set them to active
    // this is only needed so that if you first install the extension
    // or bring a bunch of tabs in on startup it will work
    //
    // setting the time to their tab id ensures they will be closed in
    // the order they were opened in and there is no way to figure
    // out what time a tab was opened from chrome apis
    chrome.tabs.query({}, function(tabs) {
        for (var i = 0; i < tabs.length; i++) {
            if (!usedOn.hasOwnProperty(tabs[i].id)) {
                openedOn[tabs[i].id] = tabs[i].id;
                usedOn[tabs[i].id] = tabs[i].id;
                accessed[tabs[i].id] = 0;
            }
        }

        _bindEvents();
    });
}

$.ready(_init);
