# signalk-einklabel-plugin Development

## Release

```bash
npm login
git tag -f latest
git tag -f v0.5.0
git push --tags
npm publish --tag latest --access public
```

GitHub release

## Run Local CLI

```bash
npm run cli -- scan -d 30
```
