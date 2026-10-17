# Settings audit

Settings originally retained unrelated template forms. Profile, Account,
Notifications, and Display submitted JSON previews instead of saving preferences.
The global sidebar and the settings page also contained overlapping navigation.

## Current behavior

| Area | Behavior | Persistence / limits |
| --- | --- | --- |
| Navigation | One global Settings link; one page-level navigation shared by all five routes. The active section follows direct links and browser back/forward. | All original settings URLs remain valid. |
| Profile | Validates and saves display name and optional bio. Account menus and new hazard reports use the saved name. | Browser-local, keyed by email. Storage failures produce an error rather than success. No cross-device sync. |
| Account | Shows email, role, English interface language, demo-session status, and the existing sign-out dialog. | Account credential and role management are unavailable. Unconnected birthday and language controls were removed. |
| Appearance | Light, Dark, and System themes plus Inter, Manrope, and System font. Shared with the quick appearance controls. | Changes apply immediately and persist in cookies. System theme changes update both the page and resolved-theme consumers. |
| Notifications | Optional in-app alert banners with a minimum severity and a test banner. New alerts, escalations, and lightning strike resets can produce banners. | Browser-local. Existing alerts do not trigger a startup flood. Alert lists and stop-work countdowns remain available regardless of banner preferences. |
| External delivery | SMS, email, and browser push are explicitly marked Not connected. | Shared with the Alerts channel panel, which no longer marks disconnected channels as active. No delivery service, subscription, or scheduler was added or changed. |
| Display | Sidebar style, collapse behavior, and reset use the existing layout provider. | Changes apply immediately and persist in cookies. Desktop collapse preferences do not replace the mobile drawer. |
| Account menus | Working links to settings and sign-out. | Template Billing, Upgrade to Pro, New Team, and unbound shortcut labels were removed from the account menus. |

The demo session now restores its user identity alongside its existing token so
refreshing does not switch the displayed email, role, or profile unexpectedly.
This does not implement production authentication or modify a backend API.

## Verification

- Browser checks: all five settings routes; profile validation and persistence;
  reporter-name propagation; all theme/font/layout choices; layout reset;
  route back/forward; test banner and a banner from a simulated lightning strike;
  account sign-out dialog; mobile layouts and dark mode.
- Automated regressions cover local storage recovery/failure, separate profiles,
  notification event rules, session identity persistence, profile save feedback,
  and changes to the system theme.
- Passed: `pnpm lint`, `pnpm build`, and `pnpm test` (105 tests across 18 files).
- Changed-file Prettier checks and `git diff --check` passed.

Remaining service integrations are intentionally shown as unavailable rather than
represented by successful-looking template forms.
