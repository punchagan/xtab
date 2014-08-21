/* global $, Aftershave */
function _handleChange() {
    var input = $('#input-max');
    if (this.value === 'other') {
        input.show();
        input.trigger('focus');
        return;
    }

    localStorage.max = this.value;
    input.hide();
}

function _saveMax() {
    var input = $('#input-max');
    localStorage.max = input.val();
}

function _saveMemory() {
    var input = $('#input-memory');
    localStorage.memory = input.val();
}

function _saveAlgo() {
    var old_algo = localStorage.algo;
    localStorage.algo = this.value;
    if (old_algo == 'memory' || this.value == 'memory') {
        location.reload(true);
    }
}

function _run() {
    var options = {
        10: 10,
        15: 15,
        20: 20,
        25: 25,
        30: 30,
        35: 35,
        40: 40,
        45: 45,
        50: 50
    };

    var algo = localStorage.algo || 'used';
    var max = parseInt(localStorage.max || 20);
    var memory = parseInt(localStorage.memory || 1500);
    $('body').html(Aftershave.render('popup', {options: options, algo: algo, max: max, memory:memory}));
}

function _openListing() {
    chrome.tabs.create({'url': 'listing.html'});
}

$.ready(function() {
    $(document).on('change', 'select', _handleChange);
    $(document).on('change', '#input-max', _saveMax);
    $(document).on('change', '#input-memory', _saveMemory);
    $(document).on('change', 'input[type=radio]', _saveAlgo);
    $(document).on('click', '#open-listing', _openListing);
    _run();
});
