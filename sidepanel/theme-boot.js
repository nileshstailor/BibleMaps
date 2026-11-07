(() => {
  try {
    const theme = localStorage.getItem("bibleMapsTheme");
    if (theme === "night" || theme === "day") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    /* ignore */
  }
})();
