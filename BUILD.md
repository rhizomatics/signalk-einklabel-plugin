# signalk-einklabel-plugin Development

## Pre-reqs

- nodejs
- npm
- pre-commit
  - `apt install pre-commit`
  - `pre-commit install`

## Release

1. Set the version in `package.json` and finish its section in `CHANGELOG.md`:

   ```bash
   npm version <VERSION> --no-git-tag-version
   ```

2. Commit and push, then wait for the SignalK Plugin CI workflow to pass on GitHub.

3. Check what the package will contain:

   ```bash
   npm pack --dry-run
   ```

4. Tag the release. Version tags never move, so only `latest` is forced:

   ```bash
   git tag v<VERSION>
   git tag -f latest
   git push origin v<VERSION>
   git push -f origin latest
   ```

5. Publish to npm:

   ```bash
   npm login
   npm publish --tag latest --access public
   ```

6. Create the GitHub release, with the version's `CHANGELOG.md` section as its notes:

   ```bash
   gh release create v<VERSION> --title v<VERSION> --notes-file <notes.md>
   ```

### Beta releases

Use a prerelease version such as `1.4.0-beta.1` for `<VERSION>`, and the `beta` tag in place of
`latest`: `git tag -f beta`, `git push -f origin beta`, `npm publish --tag beta --access public`,
and `gh release create ... --prerelease`.

## Run Local CLI

```bash
npm run cli -- scan -d 30
```
