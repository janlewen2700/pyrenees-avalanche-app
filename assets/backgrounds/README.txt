Photograph slots (filenames are case-sensitive on Render)

Restore your original binary photographs:
  learn-rescue.JPG     learning/rescue page background
  who-we-are.JPG       about page background
Add these photographs for the new About gallery:
  snow-detail.jpg          snow texture or snow profile
  mountain-landscape.jpg   Pyrenees landscape
  field-day.jpg            fieldwork or touring day

Suggested: JPEG/WebP-quality export, 1600–2000px wide, below 500 KB each.
The gallery uses a labelled empty state until you add files. Edit alt text and
captions in public/index.html to match the actual photographs and photographer
credits. Respect image rights and the consent of identifiable people.
A local gallery change is deployed through GitHub/Render like other source edits.
Existing observation photo uploads remain available in the report form; these
are compressed by the client and stored in observation JSON. For scale, migrate
them to object storage and store only object identifiers in Postgres.

The combined Markdown export did not contain recoverable JPEG bytes. These
original photographs are deliberately not replaced with invented photographs.
