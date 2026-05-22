(function () {
  try {
    var saved = localStorage.getItem('themePreference');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      // Default to dark theme for modern UI
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
