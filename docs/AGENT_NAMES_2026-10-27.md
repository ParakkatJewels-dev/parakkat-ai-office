# Readable office-map names — 27 October 2026

The previous map hid idle agent names until the camera was within 60 world units, while the default campus view was around 148 units away. Compact working-agent names used 10px text.

The map now considers every onscreen agent at every zoom level. Name buttons use fixed 14px text, with nearby collision-free placement and connecting lines when displaced. Heads, selected agents and hovered agents take priority. Crowded secondary labels can be hidden to preserve readability; hovering over a figure reveals its name without moving the camera. Name buttons are keyboard-focusable and open the existing agent conversation.

Working-agent names use 13px text in the campus view and 14px closer in, with two-line names and enlarged cards. Status, occupancy, task execution and provider behavior are unchanged. The change adds no AI calls.

## Local validation

- Production build and type checking passed.
- All 10 existing work-status tests passed; engine/script syntax, CSS parsing and `git diff --check` passed.
- Default desktop preview: 35 readable name buttons, compared with zero before the change. Clicking Banner Designer selected that agent.
- Eight simultaneous fixture work cards remained visible, including the two-line Experiment & Outcomes Analyst name.
- Zoomed-out, 2D and phone views retained 14px names. No overlap was detected among visible name buttons in the checked 2D view.
- Browser console reported no warnings or errors. The local preview made no provider/database requests and was stopped after validation.

## Production verification

Released as `ui-agent-names-20261027-r1`. All 19 deployment checks passed at 11:28:45 IST. Application and scheduler are healthy; the office stayed running, all 22 unrelated containers including Hermes were unchanged, and protected configuration was preserved. The previous full-window release is retained as `parakkat-ai-office:before-ui-agent-names-20261027-r1` for rollback.

Live browser verification confirmed 35 readable 14px names at the default desktop view. Clicking Banner Designer opened the correct, fully loaded conversation without sending a task. Both light and dark themes were checked; the browser console had no warnings or errors. Dark mode, normal viewport size and the live Kerala clock were restored.

Screenshots: `agent-names-dark-2026-10-27.png` and `agent-names-light-2026-10-27.png`. Deployment proofs: `/tmp/parakkat-agent-names-r1-final-verification.json` and `/tmp/parakkat-agent-names-r1-http-verification.json`.

## Interactive labels and sidebar cleanup

The follow-up release adds department-tinted initials, a clear open affordance, focus and selected states, and a working-status indicator to each agent name button. The label and current-work card support dark and light themes. The Parakkat HQ / Alappuzha location badge was removed from desktop and mobile navigation.

Released as `office-labels-20261027-r1` on the dedicated AI Office app and scheduler containers. Local build and type checking passed, as did the five workspace-navigation tests. Live browser checks confirmed the new label styles in both themes, opening Campaign Strategist’s conversation, and the missing location badge. The app is healthy, the scheduler is running, and 22 unrelated containers including Hermes were unchanged. The office configuration, credentials, and runtime environment were preserved. Rollback image: `parakkat-ai-office:before-office-labels-20261027-r1`. Proof: `/tmp/parakkat-office-labels-final-runtime.json`, `/tmp/parakkat-office-labels-final-db.json`, `/tmp/parakkat-office-labels-live.jpg`.
