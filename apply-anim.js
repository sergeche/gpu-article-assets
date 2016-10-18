(function() {
    var anim = location.hash.replace('#', '');
    if (!anim) {
        return;
    }

    var parts = anim.split(':');
    var elem = parts[0];
    var animClass = parts[1];

    if (elem && animClass) {
        var items = document.querySelectorAll(elem);
        for (var i = 0; i < items.length; i++) {
            items[i].classList.add(animClass);
        }
    }
})();
