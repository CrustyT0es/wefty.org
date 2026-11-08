# Wefty (phone app)

Wefty (it used to be called Vault) is a notes app for a PC, a phone and a Chromebook. This is the web app behind
Wefty on the phone and the Chromebook, served by GitHub Pages at https://wefty.org/.

It's only the app itself: the notes, files and keys are in the owner's own Supabase project, behind their sign-in.
Made from `vault/web` in the owner's Jarvis repo by `python -m vault.publish`; don't edit it here. `version.json`
lists every file with its sha256, and every device checks each file against it before using a new version.
