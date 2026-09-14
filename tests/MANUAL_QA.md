# Manual checks before deploying

- Open each page at desktop and phone widths; check map sizing, sidebar scrolling, modal controls and footer overlap.
- Switch through en/ca/es/fr/oc/eu and reload. Confirm Catalan senyera remains in the selected control; verify Aran/Basque flags, partial-translation notice and learning-page text. Submit identical test types in different languages and compare stored categorical values: underlying values must remain canonical English keys.
- Open a report at two successive locations; delay terrain requests and manually edit an estimate. Confirm the latest location/manual values win.
- Publish a report with terrain unavailable and no measurements. It must preserve unknowns. A decimal slope must pass validation. A missing required title/date/description must not pass.
- Add three photographs, inspect their preview and reopen the persisted report. Test a large/unusual image and a failed upload.
- Restore the two original uppercase JPG files and add the three gallery photographs; check cropping, captions, credits and alt text against actual content.
- Select a terrain point with no current bulletin; no invented regional rating should appear. Force a failed terrain request after a successful one; the old overlay must disappear. Check source/fallback warnings and effective spacing.
- Deploy to a staging Render service, verify all static/API content types, publish/reload/restart/reload a marked test report and remove it afterward.
- Simulate database outage: submission must fail visibly with the draft still editable and no success toast.
- Test PWA installation on actual supported devices. Disconnect network and confirm live data are not presented as newly fetched, no submission is reported sent, and installability is not confused with complete offline operation.
