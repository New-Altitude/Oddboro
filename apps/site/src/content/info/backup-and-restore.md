# Back up and restore your office

Quit Oddboro and copy its office folder to a private backup drive. That gives you a copy of the office you can reopen, including your Odds, their work and the decisions on your Desk.

## Make a copy

1. Let running jobs finish. Choose **Quit Oddboro** from the menu bar or system tray. Closing the window can leave the office running. If you run from source with the login service, run `npm run service:uninstall -w apps/office` in the repository. If you started a development server in a terminal, stop it there.
2. Open your office folder. On a Mac, choose **Go > Go to Folder** in Finder and enter `~/.oddboro`. On Windows, enter `%USERPROFILE%\.oddboro` in File Explorer's address bar. On Linux, enter `~/.oddboro` in your file manager. If you set `ODDBORO_HOME`, use that folder.
3. Copy the whole folder, including hidden files, into a new dated folder on a private backup drive. Keep it outside the working office. The copy can contain account settings, conversations and files from connected services. Keep it under your control.
4. Back up any folders you gave an Odd separately. The office remembers their paths. Their contents stay in the folders you selected. For a source install, also copy the repository's `.env` and `data` folder if present. If you supply your own Postgres database through `DATABASE_URL`, take a database backup at the same time using your database provider's backup procedure.
5. Open Oddboro again. For a source login service, run `npm run service:install -w apps/office`.

## Restore the copy

1. Stop the office as above. Keep the current office by renaming its folder to an unused name, such as `.oddboro-before-restore`.
2. Copy the saved office folder back to its original location and name. Open the folder and check that `db` is directly inside it if you use the built-in database. If you use external Postgres, restore that database from the same backup point. Put external files back at the paths your Odds use.
3. Start the same version of Oddboro that made the backup if available. Open an existing Odd's chat, a pending Desk item, a past report and a file the Odd delivered. Check that your recurring jobs have the schedules you expect. Work after the backup date belongs to the office you set aside.
4. Check each connected account before running work that uses it. The operating system stores some sign-ins in Keychain on Mac, Credential Manager on Windows, or the desktop keyring on Linux. On a new computer or user account, sign in again to any provider or service that asks.
5. If you need the office you set aside, quit Oddboro, move the restored copy to another name, then return the earlier folder to its original name. Keep the original backup intact.

## Recover the database after an update

With the built-in database, the first start of a different app version copies the database into `backups/pre-<version>-<time>/db` inside the office folder. Oddboro keeps the three most recent copies of this kind. The version in the name is the **incoming** app version. The copy contains the database as it stood before that version opened it.

For a database-only recovery, stop Oddboro, save a copy of the current office, then move its `db` directory aside. Copy the chosen backup's `db` directory into its place. Use the matching office files from your own backup if they also need recovery. The automatic copy covers the database. An Odd's saved files live under `staff` and shared work files can live under `threads`.
