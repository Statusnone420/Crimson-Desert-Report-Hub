# Implemented workspace screenshots

These images show the actual Next.js application using invented local test fixtures. They are not production captures. Screenshots wait for fonts and the page transition to finish. Functional tests exercise the actual local Server Actions; local PostgreSQL tests separately verify the database transactions.

Capture command: `npx playwright test operator-workspace.spec.ts --project=operator-writes --workers=1 -g "seven workspace destinations"`.

All views use the shared desktop shell. Separate width tests verify expansion from 1440 to 2560 CSS pixels in both themes.

| View | Light | Dark |
| --- | --- | --- |
| Overview | [Light](workspace-overview-light.png) | [Dark](workspace-overview-dark.png) |
| Reports | [Light](workspace-reports-light.png) | [Dark](workspace-reports-dark.png) |
| Claims | [Light](workspace-claims-light.png) | [Dark](workspace-claims-dark.png) |
| Scanner | [Light](workspace-scanner-light.png) | [Dark](workspace-scanner-dark.png) |
| Videos | [Light](workspace-videos-light.png) | [Dark](workspace-videos-dark.png) |
| Dossiers | [Light](workspace-dossiers-light.png) | [Dark](workspace-dossiers-dark.png) |
| Settings | [Light](workspace-settings-light.png) | [Dark](workspace-settings-dark.png) |
