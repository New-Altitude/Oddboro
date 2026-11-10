# Giving an Odd a folder

Give each Odd the smallest folder its work needs. An Odd can open everything inside a folder you give it, so a project folder is safe to give, and a whole drive is not.

## What a folder lets an Odd do

You give a folder on the Odd's Settings, under Folders. Each folder is set to one of two levels.

- **Can read** lets the Odd open and read every file inside the folder, and every folder inside it.
- **Can write** also lets it create, change and delete those files.

Even with Can write, an Odd never changes another AI tool's instruction files there, such as `CLAUDE.md`, `AGENTS.md` or a `.claude` folder, or git's hooks and settings. It can still change a project's own code, such as its package scripts or tests. Look at what an Odd changed before you run that project's tools yourself.

The change takes effect on the Odd's next run. Click ✕ beside a folder to take it back.

## Folders Oddboro never gives

These folders would let an Odd past the limits you set for it, so Oddboro refuses them and offers no way around it:

- **Your whole home folder.** Pick a folder inside it instead.
- **Your keys and sign-ins.** Folders like `.ssh`, `.aws` and `.gnupg`, and folders that hold one.
- **Other AI tools' homes.** The folders where Claude Code, Codex, Grok and Gemini keep their sign-ins and history, such as `~/.claude` and `~/.codex`.
- **Oddboro itself.** The office's own folder, `~/.oddboro`, and Oddboro's code. An Odd that could change these could change its own access.

In your home folder, Oddboro knows where these live. Outside it, on another drive for example, Oddboro looks in the folder you pick, the folders it sits in, and the folders directly inside it. It does not look deeper. Before you give a folder outside your home, make sure nothing deeper inside it holds keys or sign-ins.

## Why some folders warn first

Oddboro warns you before it gives a folder that is a whole drive, like `D:\` or a disk under `/Volumes`, or that holds your computer's system files, like `C:\Windows` or `/usr`. You see a warning with Accept and Cancel. Only Accept gives the folder.

We don't recommend it. A whole drive can hold things you forgot are there, like old backups, other people's files, or another tool's sign-ins deep inside. System files are what your computer runs on. Give the project folder the work is in instead.

An Odd can ask you for a folder, but never for a whole drive or system files. Only you can give one.

## Folders outside your home

A folder on another drive works the same as one in your home. If your projects live on `D:\Projects`, give `D:\Projects\my-game`, the folder the work is in.
