function _run() {
    removed_tabs = JSON.parse(localStorage.removed_tabs || "[]");
    $('body').html(Aftershave.render('listing', {removed_tabs: removed_tabs}));
}

function _deleteInfo(evt) {
    var url = evt.target.href;
    chrome.tabs.create({url: url});

    for (var i=0; i < removed_tabs.length; i++){
        var tab = removed_tabs[i];
        if (tab.url == url) {
            removed_tabs.splice(i, 1);
            i--;
        }
    }

    localStorage.removed_tabs = JSON.stringify(removed_tabs);

    location.reload();
    return false;
}


$.ready(function() {
    $(document).on('click', 'a', _deleteInfo);
    _run();
});
