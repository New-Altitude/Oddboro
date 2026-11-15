# Give an Odd the release-site review

Give the Odd read access to the site's project folder. Let it browse the
public release records, or give it a copy of the published release from
GitHub. For a file copy, save the notes as Markdown and put the tag, date
and installer links on separate lines so the Odd can read them all. In
the Odd's Jobs, add **Review the release page** and turn on its
Desk report. Pick a time after the team's usual release, or run it by hand
when a release is published.

Use these job instructions:

> Compare the newest published, non-prerelease Oddboro release on GitHub
> with the first entry in `apps/site/src/lib/releases.ts` and the live
> release page at https://oddboro.com/releases/. Cite the release tag and
> page you checked. If you cannot read one, name it and leave its status
> open.
>
> Check the version, the publication date in America/Los_Angeles, and the
> installer names against the release's uploaded assets. Check each
> user-facing change you describe against the published notes or a merged
> change they link to. Leave out work that only appears in an open PR.
>
> If the release is missing from the source, write one proposed entry in
> your Desk report, with a title, summary, notes and supported builds. If
> the source already has the entry but the live site is behind, report
> which release still needs deployment. If both match, report that and
> finish. Give the content owner any proposed corrections and art choices
> for review. Leave the website, the release and other drafts as you found
> them.

The repository's [site instructions](CLAUDE.md#downloads-and-releases)
cover the release order, the two art themes and who picks the preview. The
owner can review the Odd's proposal there before merging a site change.
