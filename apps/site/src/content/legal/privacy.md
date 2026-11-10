# Privacy Policy

Effective date: November 9, 2026

> **The short version.** Oddboro is open source software that runs on your own computer: a Mac, Windows or Linux. Its database lives on that computer. New Altitude, Inc. operates no server that stores your office's data. Signing in to a New Altitude account is optional. If you sign in and turn on error reports in Setup, the software sends reports of what broke through our relay to Sentry, without your account. When you connect the software to Anthropic or another service, your data goes to that service under your own account and its own terms, never through us. This website is static files: no cookies, no analytics, no forms, no third-party requests. The only personal data we can hold about you is the approximate location in error reports you turned on, and New Altitude's records of your sign-in. If that ever changes, we will update this policy, say so in the repository and on this site, and change the effective date above.

## 1. Who we are

Oddboro is published by New Altitude, Inc. ("New Altitude", "we", "us"). We publish the software under the Apache License 2.0 at [github.com/New-Altitude/Oddboro](https://github.com/New-Altitude/Oddboro) and we run this website at oddboro.com.

You can reach us about privacy at:

- Email: privacy@oddboro.com
- Post: New Altitude, Inc., 910 W Howe St, Seattle, WA 98119

## 2. What this policy covers

This policy covers two things, and they work differently.

1. **The website** at oddboro.com and its subdomains. We publish it. Section 3 explains what it collects.
2. **The software**, Oddboro, which you download and run on your own computer. We publish the code. You run it. Sections 4 through 7 explain what it does with your data and where that data can go.

It does not cover:

- **GitHub.** When you visit, clone, star, or open an issue in the repository, GitHub collects what GitHub collects under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Anthropic, Ollama and any other service you connect the software to.** Each one handles your data under its own terms and privacy policy. Section 5 lists them.
- **Your New Altitude account.** If you have one, New Altitude holds it under the [New Altitude Privacy Policy](https://newaltitude.ai/privacy) and the terms you accepted for it.

### Definitions

- **"Office"** means your running copy of Oddboro: the floor, the Odds in it, and their records.
- **"Owner"** means you, the person who runs the office.
- **"Odd"** means an AI worker in your office. Each one runs through Claude Code under your own Claude account or Anthropic API key.
- **"Ledger"** means the office's database of Odds, chats, asks, tasks, reports, decisions, goals and access grants.
- **"Personal data"** or **"personal information"** means information that identifies or relates to an identifiable person.

## 3. The website

This website is a set of static files. We built it to collect nothing.

- **No cookies.** The site sets none and reads none.
- **No analytics or tracking.** No page views, no events, no pixels, no fingerprinting.
- **No third-party requests.** The site serves its own fonts, styles, scripts and images. Your browser contacts no other company to show a page.
- **No forms or accounts.** There is nothing to fill in and nowhere to sign up.
- **One setting, kept on your device.** If you pick the day or night look in the header, the site remembers it in your browser's local storage. That value never leaves your device, and clearing the site's data removes it.

**Server logs.** The provider that hosts the site may keep standard server logs for security and to keep the service running. A typical log line holds the IP address a request came from, the browser's user agent string, the time, and the page requested. We do not add to those logs, we do not use them to identify or profile anyone, and we do not combine them with anything else. The provider keeps them for its own standard period under its own policy.

**Links.** The site links to GitHub, Anthropic, Ollama and others. Once you follow a link, the site you land on governs.

## 4. The software runs on your computer

Everything Oddboro stores, it stores on the computer you run it on. We verified this against the code, and because the code is open, you can too.

### Where your data lives

| Data                                                                                                                                                                                  | Where it is                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The ledger: your name, Odds and their job descriptions, chats, asks, tasks, reports, decisions, goals, access grants, per-run token counts                                            | A Postgres database on your computer. By default it runs inside the office at `~/.oddboro/db`.                                                                                                               |
| Each Odd's working files                                                                                                                                                              | `~/.oddboro/staff/<id>/`                                                                                                                                                                                     |
| Each Odd's Claude Code transcripts: the chats and runs Claude Code keeps so it can pick up where it left off                                                                          | `~/.claude/projects/`, in a folder named after the Odd's folder                                                                                                                                              |
| Your Anthropic API key (if you use one), your Google sign-ins, your New Altitude sign-in with your account's id, name and email (if you sign in), and sign-ins for other hosted tools | Your system's secret store: the Keychain on a Mac (service `com.oddboro.office`, locked to Oddboro), the Credential Manager on Windows and the desktop keyring (Secret Service) on Linux (service `oddboro`) |
| Family and people data (names, birthdays, schedules)                                                                                                                                  | The `data/` folder in your copy of the repository. Git ignores it, so it never enters a commit.                                                                                                              |
| Office settings (which model, plan or key, time zone, and your answer about error reports)                                                                                            | The `.env` file: in the app, `~/.oddboro/.env`; from source, the one in your copy of the repository. Git ignores it.                                                                                         |
| Backups made by `npm run reset`                                                                                                                                                       | `~/.oddboro/backups/<date>/`                                                                                                                                                                                 |

You may point the office at a different Postgres database by setting `DATABASE_URL` in `.env`. If you choose a database hosted by someone else, your ledger goes to that provider under your agreement with them. That is your choice, and we are not part of it.

### What never happens

- **No reports unless you turn them on.** The software sends error and tracing reports only after you turn them on in Setup. Nothing asks you on your first visit, and until you turn them on it sends none. Turning them off stops them at once. Reports also need a New Altitude sign-in: while you are signed out the software sends none, and when you sign in again your earlier answer holds.
- **No New Altitude server holds your office.** There is no sync and no cloud copy, and you need no account with us to use the office. The software reaches New Altitude only in two ways you choose: the error report relay, once you turn reports on while signed in (see "Error and tracing reports" below), and signing in to a New Altitude account you already have (see "Your New Altitude account" in section 5).
- **No remote access.** The office listens on `127.0.0.1` only, so nothing outside your computer can reach it. Its built-in database does the same. If you choose the `https://local.oddboro.com` address during setup, the Caddy proxy that serves it listens on ports 80 and 443 and answers only for that name, which resolves to `127.0.0.1`.
- **No sale or sharing.** We never receive your office's data, so we cannot sell it, share it, rent it or use it to train anything. Error reports you choose to send are used only to fix Oddboro.

### Error and tracing reports (only if you turn them on)

When something in Oddboro breaks, a report helps us fix it. You choose whether the software sends them.

Reports need a New Altitude sign-in. The software sends them only while you are signed in to a New Altitude account (see "Your New Altitude account" in section 5), and stops when you sign out.

What a report holds:

- The kind of error, where in the code it happened, and the lines of code around that place. A file in Oddboro's own folder is named by its path inside that folder, a file in another package by its path from that package on, and any other file in your home folder by its file name alone. Code outside your home folder, such as a system library, is named by its full path. The list of files Oddboro has loaded follows the same rule, except the desktop app's window, which names each file by its file name alone. A script in the page from anywhere but the office is named by its file name alone.
- For a sample of about one in ten actions, which part of the office ran and how long it took. A request the office makes, to itself or to another service, is named by its method alone (such as POST), never by an address.
- The Oddboro version, your system's name and version, your computer's chip, and the version of Node.js or Rust that runs Oddboro.

What a report never holds: your IP address, your computer's name, cookies, request headers or bodies, web address query strings, your chats, your Odds' prompts or work, the tools they use and what they send them, the addresses of other services or computers the office reaches, the names of your folders, what is in your files, your family's details, or your name. An error's message is included only when Oddboro's code wrote it or it follows a fixed pattern: a JavaScript engine error (such as "x is not a function", with any data in it removed), a system error's code (such as "ENOENT open", without the file it names), or a database error's code with the names of the table, column and constraint it touched.

Where it goes: the app sends each report, with your sign-in's access token, to a relay New Altitude runs on Cloudflare. The relay checks that the token belongs to a New Altitude account, removes it, adds our Sentry key and passes the report to Sentry, the service that stores our error reports. Sentry never receives your token or your account. The relay keeps no report, no IP address and no record of which account sent it; if it turns an account away, New Altitude keeps a record of that refusal under the New Altitude Privacy Policy. Sentry does not store your IP address. It keeps the approximate location (city and country) the address points to. Sentry keeps reports for a limited time, then deletes them.

If you run Oddboro from source, it sends no reports unless you name your own Sentry address in `.env` as `ODDBORO_DIAGNOSTICS_DSN`. Then it sends straight to your Sentry, never to us. It needs no New Altitude sign-in and sends none.

To stop: open Setup and turn off "Send error and tracing reports to New Altitude". The office stops at once. Signing out stops them too.

### Local search embeddings

If you install [Ollama](https://ollama.com) and the `nomic-embed-text` model, the office turns ledger text into vectors so Odds can search decisions by meaning. That request goes to Ollama at `127.0.0.1:11434` on your computer and nowhere else. Without Ollama, search works by words only and nothing changes about where data lives.

### System features the software uses

- **Notifications.** An Odd can ping you with a system notification. The software asks macOS, Windows, or your Linux desktop's notification service, to show it. Nothing leaves your computer.
- **Secret store.** Secrets go in the Keychain on a Mac, the Credential Manager on Windows or the desktop keyring on Linux, never in a file or the database.
- **Login item.** Setup registers the office so it starts when you log in: with `launchd` on a Mac, as a systemd user service on Linux. `npm run service:uninstall -w apps/office` removes it. In the app, Open at login does the same with a login item on a Mac, an entry in the registry's Run list on Windows or an autostart entry on Linux, and turning it off removes it.

### Fonts in the office interface

The office carries its own fonts (Geist Pixel and Inter). Opening it makes no request to any font service.

## 5. Services the software connects to at your direction

Oddboro is useful because it connects your Odds to the tools you already use. Every connection below happens only when you set it up, under your own account, and under that service's own terms and privacy policy. Apart from your New Altitude account, New Altitude is not a party to any of it and receives nothing from it.

### Anthropic (Claude)

Your Odds think by running Claude Code, Anthropic's command line tool, on your computer. Each chat message and each scheduled job becomes a Claude Code run under either your Claude plan sign-in or an Anthropic API key you give the office. The office stores an API key in your system's secret store.

What goes to Anthropic in a run:

- Your message, the Odd's job description, your name and time zone, the goals the Odd serves, and the office's standing instructions.
- Whatever the Odd reads to do the work: ledger search results, the items it pulls from tools you connected, files you attach to an ask or task, and the Odd's own working files.
- A headshot, if you give one when hiring an Odd, so Claude can draw a likeness. The photo goes to that drawing run only. The office never stores it, or Claude's notes on the face.
- Setup also runs `npm install -g @anthropic-ai/claude-code`, which downloads Claude Code from the npm registry (on Windows, Claude Code's own installer from `claude.ai`), and `claude auth login`, which sends you to Anthropic to sign in.

Anthropic processes all of this under your agreement with Anthropic: its [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and [Privacy Policy](https://www.anthropic.com/legal/privacy) for a Claude plan, or its [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) for an API key. Anthropic's retention and training rules are Anthropic's, and your settings there control them. New Altitude never sees any of it.

### Your New Altitude account (only if you sign in)

If you have a New Altitude account, you can sign in to it from the office, in Setup under Account. Only error reports need it.

- Signing in opens New Altitude's own sign-in page in your browser. You sign in there, and you may be asked to accept New Altitude's Beta Terms.
- The office then asks New Altitude who you are. It keeps only your account's id, name and email, with the sign-in, in your system's secret store.
- New Altitude keeps a record that your account signed in from Oddboro, under the [New Altitude Privacy Policy](https://newaltitude.ai/privacy).
- Signing in sends nothing from your office to New Altitude: no chats, no Odds, no files.
- If you also turn on error reports, each report goes to New Altitude's relay with your sign-in, as "Error and tracing reports" describes.
- To sign out, open Setup and choose Sign out under Account. The office tells New Altitude to end the sign-in, then deletes it from your computer.

### Ollama

Local only. See section 4.

### GitHub

You clone the software from GitHub. If you choose the `https://local.oddboro.com` address during setup and your computer has no [Caddy](https://caddyserver.com), the office downloads the official Caddy release from GitHub (`api.github.com` and GitHub's release files) and checks it against the published checksum. GitHub sees those download requests.

An Odd may also ask for your GitHub, through GitHub's own MCP server. You approve or deny it, and you sign in to GitHub yourself, in your browser. GitHub shows you what Oddboro asks for: `repo` (the repositories you can reach, public and private), `read:org` (your organizations) and `read:user` (your profile). GitHub has no narrower way to read private repositories, so the access you give each Odd sets what it may do, as for any other tool: at Read it gets only GitHub's tools that read.

- **The sign-in is the only part New Altitude provides.** Oddboro signs in with New Altitude's own GitHub app, so you do not have to make a token. GitHub sends the sign-in back to the office on your computer. New Altitude never receives, stores or sees your sign-in or your code.
- **Your sign-in stays on your computer.** The office keeps it in your system's secret store, renews it every 8 hours, and uses it to talk to GitHub directly from your computer. It never goes to the Odd's coding tool.
- **What an Odd reads goes to the AI service it runs on**, as with Google below.
- **Disconnecting.** Revoking the last grant removes the sign-in from your computer. GitHub keeps Oddboro authorized until you revoke it at [github.com/settings/applications](https://github.com/settings/applications), under Authorized OAuth Apps. An organization that restricts apps may need its admin to approve Oddboro once.

### npm and PyPI

Setup installs the software's dependencies from the npm registry. When an Odd asks for a new tool and you approve it, the office runs that tool from npm (`npx`) or PyPI (`uvx`). Each registry sees the download request.

### The MCP Registry

When an Odd looks for a tool it does not have, the office searches its own catalog first, then the public MCP Registry at `registry.modelcontextprotocol.io`. Only the search words leave your computer.

### Google (Gmail and Google Drive)

An Odd may ask for your Gmail or your Google Drive. You approve or deny it, and you sign in to Google yourself, in your browser, with the account you choose. Google shows you what Oddboro asks for:

- **Gmail** (`gmail.modify` and `gmail.settings.basic`): search and read your mail, change its labels (such as marking it read or archiving it), move it to the trash or to spam and back, write drafts, send a draft, send a reply you click Send on, read your filters, and create a filter you click Create filter on. Oddboro never deletes mail permanently.
- **Google Drive** (`drive`): find and read your files, including Docs, Sheets and Slides, create Docs and Sheets, and change Docs and Sheets. Oddboro never deletes or trashes a file.

How it works, and what New Altitude does not do:

- **The sign-in is the only part New Altitude provides.** Oddboro signs in with New Altitude's own Google client, so you do not have to make one. Google sends the sign-in back to the office on your computer. New Altitude never receives, stores or sees your sign-in, your mail or your files, because New Altitude runs no server that any of it could go to.
- **Your sign-in stays on your computer.** The office keeps it in your system's secret store (see section 7 for how well each system protects it) and uses it to talk to Google directly from your computer. The Gmail and Drive tools run inside the office itself, so your sign-in never goes to the Odd's coding tool or to any other program.
- **More than one Google account.** You may connect more than one Google account, for Gmail and for Google Drive. Each account signs in on its own and is a tool of its own: an Odd reaches only the accounts you gave it, and a reply goes out from the account the email came to. Oddboro keeps one sign-in per account, so signing in to an account already connected is not kept.
- **Each Odd gets only what you give it.** At Read, an Odd can only search and read. Labels, trash, spam, drafts, sending and changing files need write access, which works from the Draft level. At Draft, each of those changes waits for your yes before it happens; at Act, the Odd makes them without asking. You can lower the level or revoke the grant at any time.
- **Replies go only when you click.** An Odd may propose replies to your mail. Each one waits on your desk, where you can change it. The office sends it, or saves it to your Gmail drafts, only when you click Send or Save on that reply, and it sends your version.
- **Emails Oddboro writes say so.** A reply an Odd proposes, and a draft an Odd saves in your Gmail, end with "Sent from Oddboro" and a link to oddboro.com. You may remove it, and a line you removed stays removed.
- **Filters are made only when you click.** An Odd may propose Gmail filters. Each one waits on your desk, where you can change it. The office creates it in your Gmail only when you click Create filter, and it creates your version. A filter only files mail: it can skip the inbox, mark mail read, add a label or star it, never delete or forward it. If you leave "Also tidy" ticked, the office makes the same changes to the mail the filter already matches, and to no other mail.
- **What an Odd reads goes to the AI service it runs on.** When an Odd reads a message or a file to do the work you asked for, that text becomes part of its run and goes to the AI service the Odd runs on (Anthropic for Claude Code), under your own account with that service, as described above. It goes nowhere else.
- **What stays on your computer.** An Odd may keep notes from what it read in its folder, the office's database and its coding tool's transcripts on your computer, like any of its other work. Section 6 says how to delete them.
- **Disconnecting.** Each account is revoked on its own. Revoking the last grant to one account's Gmail or Google Drive removes that sign-in from your computer and tells Google to cancel it. Google ties one sign-in to both Gmail and Drive of the same account, so while that account's other tool is still connected, Oddboro removes the sign-in from your computer only and leaves Google's in place for the other tool. You can also remove Oddboro at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Oddboro's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Google user data is used only to do what you ask your Odds to do, is never sold, never used for advertising, and never used to train or improve any AI model.

### Other tools you connect

An Odd may ask for a hosted tool (a service reached over the network). You approve or deny every connection, and you sign in to the service yourself. The office keeps the sign-in tokens in your system's secret store and refreshes them before each run. Data the Odd reads from or writes to that service goes to that service under its own terms. Each Odd gets only the access you give it: a tool connects read only, or with write from the Draft level. At Draft, each change through a write grant waits for your yes. At Act, a write-level grant to one Odd for one tool is your standing permission for that Odd to use that tool without asking each time. You can lower the Odd's level, which pauses the grant, or revoke the grant from the Odd's Access tab at any time.

## 6. Data retention and deletion

### What we keep

New Altitude keeps no personal data about users of the software except error and tracing reports from people who turned them on, held by Sentry for a limited time as section 4 describes, and, for people who sign in to a New Altitude account, the record of that sign-in, kept with the account under the New Altitude Privacy Policy. The only data that can exist about your visit to this site is the hosting provider's server log described in section 3.

### What is on your computer, and how to delete it

Everything in the table in section 4 stays until you remove it. You control retention entirely.

To start the office over without deleting anything:

1. Run `npm run reset` from your copy of the repository.
2. Type `reset` when it asks.
3. The office stops, and its database, Odd folders and a copy of `.env` move into `~/.oddboro/backups/<date>/`. Nothing is deleted. `data/` stays in place.

To delete everything the software stores:

1. Run `npm run service:uninstall -w apps/office` to stop the office and remove its login item.
2. Delete the `~/.oddboro` folder. This removes the database, Odd folders, working copies and backups.
3. Delete the folders in `~/.claude/projects/` whose names contain `oddboro-staff`. These are the Odds' Claude Code transcripts.
4. Delete the `data/` folder and the `.env` file in your copy of the repository, or delete the whole repository folder.
5. On a Mac, open Keychain Access, search for `oddboro`, and delete the items you find (newer items are under `com.oddboro.office`). On Windows, open Credential Manager, select Windows Credentials, and remove each entry whose name contains `oddboro`. On Linux, run `secret-tool clear service oddboro`. These are your Anthropic API key (if you gave one), your Google sign-ins, your New Altitude sign-in (if you signed in) and sign-ins for hosted tools. If you connected Google, also remove Oddboro at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). If you connected GitHub, also revoke Oddboro at [github.com/settings/applications](https://github.com/settings/applications). Deleting a New Altitude sign-in this way leaves it open at New Altitude until it runs out. Sign out in Setup ends it there too.
6. If you named your own `DATABASE_URL`, delete that database yourself. The reset command leaves it alone.

Anything an Odd sent to Anthropic or another service during a run is held by that service under its own retention rules. Delete it there.

## 7. Security

We designed the software so that the easiest path is also the safe one. These are the measures in the code today:

- The office and its database listen on `127.0.0.1` only. Nothing on your network can connect to them.
- Secrets (your API key, your Google sign-ins, your New Altitude sign-in, hosted tool sign-ins) live in the system's secret store, never in a file or the database, and never on a command line where other programs could see them. How well each system protects them differs:
  - **Mac:** the Oddboro app keeps them in the Keychain locked to Oddboro itself. Any other program that tries to read them gets macOS's prompt asking you to allow it.
  - **Windows and Linux:** the Credential Manager and the desktop keyring are shared stores. Any program running as you can read what is in them, Oddboro's sign-ins included, without asking. Only run programs you trust on a computer where you connect Gmail or Google Drive, or sign in to New Altitude.
- Outside tools, Gmail and Google Drive included, reach an Odd only through the office's gateway. A run never gets a tool's address, key or sign-in, only a token that works for the tools you granted, until the run ends.
- Each Odd runs through its coding tool's own permission system with a narrow tool list: it reads only its own folder, the `data/` folder, its own transcripts and any folder you give it, writes only inside its own folder and the folders you let it change, and uses the office's own tool server and the connections you granted. Everything else is denied, including other Odds' folders, your sign-ins and folders like `~/.ssh`. Two switches per Odd, both off until you turn them on, add more. Run commands lets it run commands, held by its tool's sandbox to those same folders, plus read-only use of developer tool folders in your home such as `~/.npm` and `~/.cargo`, never the credential files the office knows of. Browse the web lets it use its tool's own web search and page fetch, which send what it searches for and the pages it asks for to the web; with Run commands also on, its commands can reach the internet too, except on Codex, whose commands stay off the internet.
- The software is open source. Anyone can read it, audit it and report a problem.

No software is perfectly secure. Your computer's own security (its login, disk encryption, updates and the people who can sit at it) is the outer wall around everything above, and it is yours. If you find a security problem in Oddboro, email privacy@oddboro.com.

## 8. Children

Oddboro and this website are not directed to children. We do not knowingly collect personal data from anyone under 13, or under 16 where the law sets that age. The only personal data we can hold is the approximate location in error reports people chose to send, and the record of a New Altitude sign-in people chose to make. If you believe a child has given us personal data somehow, email privacy@oddboro.com and we will delete it.

## 9. International users

New Altitude is a company in the United States. This website is static files served by a hosting provider, which may serve them from locations around the world. The software runs on your computer in whatever country you are in, and we move nothing from it. The one exception is error and tracing reports, if you turn them on: they go through our relay on Cloudflare to Sentry, which stores them in the United States. A New Altitude sign-in, if you make one, goes to New Altitude, whose privacy policy says where it is processed. If you connect the software to Anthropic or another service, that service's own policy explains where it processes data and on what legal basis.

If you are in the European Economic Area, the United Kingdom or Switzerland: when you run the software, you decide what data goes in and where it goes, so you are the controller of that data (or you use it for purely personal or household purposes, which the GDPR does not cover). New Altitude is neither a controller nor a processor of it. For the website, the only processing is the hosting provider's server log, which rests on legitimate interest in keeping the site secure and running (GDPR Article 6(1)(f)). For error and tracing reports you agreed to send, New Altitude is the controller, the legal basis is your consent (GDPR Article 6(1)(a)), and you can withdraw it in Setup at any time. Sentry and Cloudflare process them for us. For your New Altitude account and its sign-ins, New Altitude is the controller under the New Altitude Privacy Policy.

## 10. Your privacy rights

Laws including the EU and UK GDPR, the California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA), and the privacy laws of Virginia, Colorado, Connecticut, Utah, Texas, Oregon, Montana and other US states give you rights over personal data a business holds about you. Those rights include knowing what is collected, getting a copy, correcting it, deleting it, limiting its use, opting out of its sale or sharing, and not being treated differently for exercising a right.

We respect all of these. Honestly stated, here is how they apply:

- **We hold almost no personal data about you.** If you turned on error reports, Sentry holds them for us, each with an approximate location. Reports carry no name, account or IP address, so we cannot tell which ones are yours. Sentry deletes every report after a limited time. If you signed in to a New Altitude account, New Altitude holds the account and its sign-in records under the New Altitude Privacy Policy.
- **We do not sell personal information, we do not share it for cross-context behavioral advertising, and we do not use it for targeted advertising or profiling.** We have not done so in the preceding twelve months. There is no sale or sharing to opt out of. Error reports are a separate choice, and you can turn them off in Setup at any time.
- **We do not collect sensitive personal information** as those laws define it.
- **We do not discriminate** against anyone for exercising a privacy right.
- **Data on your computer** is under your control, and section 6 explains how to delete it.
- **Data at Anthropic or another service** is held by that service. Exercise your rights with them directly.

To make a request anyway, email privacy@oddboro.com. We will answer within the time the applicable law allows (45 days under the CCPA, one month under the GDPR), and we will not ask you to verify more than we need to answer, which for a company holding this little data is usually nothing. An authorized agent may make a request on your behalf with written permission from you.

If you are in the EEA or the UK, you have the right to complain to your data protection authority. We would rather hear from you first.

## 11. Do Not Track and Global Privacy Control

The website tracks nothing, so a Do Not Track header and a Global Privacy Control signal change nothing: there is no tracking to turn off. We treat both as honored.

## 12. Future features and changes to this policy

Today the project is the software, this site, and signing in to a New Altitude account you already have. We may add community features later: forums, shared offices, or a hosted service. Any of those would mean we collect more personal data than error reports and a sign-in hold, and this policy would have to change before that happens.

When we change this policy:

1. We update the effective date at the top.
2. We note the change in the release notes at [github.com/New-Altitude/Oddboro/releases](https://github.com/New-Altitude/Oddboro/releases) and on this page.
3. For a material change, we post a notice on this site before it takes effect, and in the software's own release notes if the change concerns the software.
4. A material change does not apply retroactively to data collected under an earlier version without your consent, where the law requires consent.

The version at oddboro.com is the current one. Earlier versions stay in the repository's history.

## 13. Contact

- Privacy questions and requests: privacy@oddboro.com
- Legal notices: legal@oddboro.com
- Post: New Altitude, Inc., 910 W Howe St, Seattle, WA 98119
