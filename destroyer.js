/* globals $, chrome */
var usedOn = {};
var openedOn = {};
var accessed = {};
var activeTabId;
var timeout;
var activeInterval = 2500;
var memory_units = 1000000; // MB

function _debug() {
    console.log.apply(console, arguments);
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

function _getTotalMemory(process_data) {
    var sum = 0;
    for(process in process_data){
        sum += process_data[process].privateMemory;
    }

    sum /= memory_units;
    _debug('total memory in MB:', sum);

    return sum;
}

function _calculateMemoryPerTab(process_data) {
    var memory = [];
    for(process in process_data){
        var current_process = process_data[process];
        // Ignore any non render processes
        if (current_process.type == 'renderer') {
            var tabs = current_process.tabs
            for(var i=0; i<tabs.length; i++) {
                memory[tabs[i]] = current_process.privateMemory/tabs.length;
                memory[tabs[i]] /= memory_units;
            }
        }
    }
    return memory;
}

function _removeByMemoryHeuristic(tabs, memory, sum) {
    // We only delete one tab, here.  We get called more often, if required.
    if (sum > _getMemory()) {
        // fixme: what's the best way to use the memory info?  We are just
        // removing the least accessed, right now.  It may work well, but
        // instead of closing n light-weight tabs, we could close one heavy
        // weight tab...
        // We could be a little fuzzy, and remove one of the least recently
        // used 5 tabs?
        _removeLeastRecentlyUsed(tabs);
    }
}

function _removeMemoryHogsIfAny(tabs){

    chrome.processes.getProcessInfo([], true, function(process_data) {
        var sum = _getTotalMemory(process_data);
        if (sum > _getMemory()) {
            var memory = _calculateMemoryPerTab(process_data);
            _removeByMemoryHeuristic(tabs, memory, sum);

            // Check if we need to remove more tabs
            chrome.tabs.query({pinned: false}, function(tabs) {
                tabs = tabs.filter(function(tab) {
                    return tab.id != activeTabId;
                });
                // fixme: If no further tabs can be killed, we are in big
                // trouble.  It would've been ok to fail, but the recursive
                // call is a big pain!
                _removeMemoryHogsIfAny(tabs);
            });
        }
    });
}

function _removeLeastAccessed(tabs) {
    var removeTabIndex = _getLowestIn(accessed, tabs);
    if (removeTabIndex >= 0) {
        _removeTab(tabs[removeTabIndex].id);
        tabs.splice(removeTabIndex, 1);
    }
    return tabs;
}

function _removeOldest(tabs) {
    var removeTabIndex = _getLowestIn(openedOn, tabs);
    if (removeTabIndex >= 0) {
        _removeTab(tabs[removeTabIndex].id);
        tabs.splice(removeTabIndex, 1);
    }
    return tabs;
}

function _removeLeastRecentlyUsed(tabs) {
    var removeTabIndex = _getLowestIn(usedOn, tabs);
    if (removeTabIndex >= 0) {
        _removeTab(tabs[removeTabIndex].id);
        tabs.splice(removeTabIndex, 1);
    }
    return tabs;
}

function _removeTabs(tabs) {
    var length = tabs.length;
    _debug('there are', tabs.length, 'tabs open');
    _debug('max is', _getMax());
    while (length >= _getMax()) {
        _debug('removing a tab with length', length);
        switch (_getAlgo()) {
            case 'oldest':
                tabs = _removeOldest(tabs);
                break;
            case 'accessed':
                tabs = _removeLeastAccessed(tabs);
                break;
            default:
                tabs = _removeLeastRecentlyUsed(tabs);
                break;
        }
        length -= 1;
    }
}

function _handleTabAdded(data) {
    var tabId = data.id || data;

    _debug('added', tabId);

    // find tab to remove
    var currentWindow = (_getAlgo() == 'memory')?false:true;
    chrome.tabs.query({currentWindow: currentWindow, pinned: false}, function(tabs) {
        tabs = tabs.filter(function(tab) {
            return tab.id != tabId;
        });

        if (_getAlgo() == 'memory') {
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
