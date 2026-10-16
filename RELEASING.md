# Releasing

Releases are published to npm by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) with [trusted publishing](https://docs.npmjs.com/trusted-publishers). There is no npm token: npm trusts that workflow in this repo, and only in the `npm` environment.

1. Add the changes to `CHANGELOG.md` under a new version heading.
2. Bump the version. This commits `package.json` and creates the `vX.Y.Z` tag:

   ```bash
   npm version 0.3.0 -m "Release %s"
   ```

3. Push the commit and the tag:

   ```bash
   git push --follow-tags
   ```

4. Create the GitHub release, which starts the publish workflow:

   ```bash
   gh release create v0.3.0 --title v0.3.0 --notes-file <(sed -n '/^## 0.3.0/,/^## /p' CHANGELOG.md | sed '1d;$d')
   ```

5. Approve the run: open the repo's **Actions** tab (or the email from GitHub), select the waiting **Publish** run, then **Review deployments → npm → Approve**.

The workflow fails without publishing if the release tag doesn't match the version in `package.json`.

## Troubleshooting

- **First publish deadline:** a new trusted publisher must complete one successful publish within 2 days, or npm expires it. Then delete it and create it again.
- **`ENEEDAUTH` / 403 / 404 on publish:** on npmjs.com, the trusted publisher must have **npm publish** ticked under *Allowed actions*. New ones only allow `npm stage publish` by default. It must also name exactly `acus9345/llm-json-mend`, `publish.yml`, and environment `npm`. Check with `npm trust list llm-json-mend`.
- **Don't add an `NPM_TOKEN` secret.** It isn't needed, and npm may use it instead of trusted publishing.
