(function() {
    var supportedLangs = /^ru|en$/;
    var anim = location.hash.replace('#', '');
    if (!anim) {
        return;
    }

    var parts = anim.split(':');
    var lang = supportedLangs.test(parts[0] || '') ? parts.shift() : 'en';
    var elem = parts[0];
    var animClass = parts[1];

    document.documentElement.setAttribute('lang', lang);

    if (elem && animClass) {
        var items = document.querySelectorAll(elem);
        for (var i = 0; i < items.length; i++) {
            items[i].classList.add(animClass);
        }
    }
})();
