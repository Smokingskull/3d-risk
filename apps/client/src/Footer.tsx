// Small, unobtrusive footer shown on every screen: copyright + the version and
// build stamp (see vite.config.ts). The build number (UTC yyyymmdd.hhmm) makes a
// stale deploy obvious without having to track the incrementing version by hand.
const COPYRIGHT_YEAR = 2026; // bump each new year

export function Footer() {
  return (
    <footer className="app-footer">
      © {COPYRIGHT_YEAR} Iain Wilson · {__APP_VERSION__} build {__BUILD_TIME__}
    </footer>
  );
}
