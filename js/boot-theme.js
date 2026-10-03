// Classic blocking script (CR-001, C-026). Applies the saved theme before first paint so there is no flash.
// Reads LocalStorage key winter-arc:ui = {"theme":"light"|"dark"}; anything else = follow the system.
(function () {
  try {
    var raw = localStorage.getItem('winter-arc:ui');
    var t = raw ? JSON.parse(raw).theme : null;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system */ }
})();
