# Privacy and Moderation

The hub is designed to collect useful issue evidence without becoming a public dump of raw complaints.

## Public Visitors Can See

- Aggregate report counts.
- Patch metadata and official source link.
- Issue cluster titles and summaries.
- Platform and category counts.
- Approved public source links.
- Moderator-approved excerpts from direct reports.

## Public Visitors Should Not See

- Raw unmoderated report text.
- Raw IP addresses.
- Private support tickets.
- Credentials or environment values.
- Admin-only moderation details.

## Direct Reports

Player submissions are anonymous. The app does not require user accounts or email addresses.

The server stores a salted one-way IP hash for rate limiting, not raw IP addresses.

## Local Save/Config Helper

The report page can inspect selected local Crimson Desert files in the browser to help players fill report fields. Raw files are not uploaded by that helper. Players can edit or delete generated text before submitting.

## Moderation

Admins review pending direct reports before approving public excerpts. This keeps the public board evidence-focused and reduces the chance of exposing personal details.

## Security Reports

Do not post exploit details or secrets in public issues or discussions. Use the repository security policy:

[SECURITY.md](https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/SECURITY.md)
