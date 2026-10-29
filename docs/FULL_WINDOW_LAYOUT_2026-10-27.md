# Full-window layout — 27 October 2026

Production release: `ui-full-window-20261027-r1` at https://ai-office.parakkatjewels.in.

Removed the decorative outer application frame across desktop, tablet and mobile. The shell now uses the full viewport; the main content has no outer margin or rounded outer edge. Internal padding and rounded cards, panels, buttons and dialogs remain. Dark and light palettes are unchanged.

The only executable source change is `src/app/globals.css`.

## Verification

- CSS parsed successfully; `git diff --check` and the production build passed, including type checking.
- Live desktop (2073 × 1069), tablet (1024 × 768), and phone (390 × 844) checks confirmed that the shell reaches every viewport edge without horizontal main-content overflow.
- Dark and light desktop layouts checked visually. Mobile navigation opened and closed successfully.
- Office-map canvas fills the available 1831 × 985 desktop content area and reaches the right and bottom viewport edges.
- Browser console reported no warnings or errors during verification. Temporary viewport overrides were reset.
- All 19 deployment verification gates passed. Application and scheduler are healthy; office running state, environment, credentials and budgets are preserved. All 22 unrelated containers, including Hermes, were unchanged.
- Previous release retained as `parakkat-ai-office:before-ui-full-window-20261027-r1` for rollback.

Evidence: `full-window-dark-2026-10-27.png`, `full-window-light-2026-10-27.png`, and `full-window-mobile-2026-10-27.png` in this directory. Deployment verification artifacts are in `/tmp/parakkat-full-window-r1-final-verification.json` and `/tmp/parakkat-full-window-r1-http-verification.json`.

No database migration, business setting change, or paid provider test was required. Existing very-short-landscape office-map minimum-height behavior was not changed by this layout update.
