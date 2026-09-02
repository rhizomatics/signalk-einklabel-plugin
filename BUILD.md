# signalk-einklabel-plugin Development

## Pre-reqs

* nodejs
* npm   
* pre-commit
  * `apt install pre-commit`

## Release

```bash
npm login
git tag -f latest
git tag -f v1.2.0
git push --tags --force
npm publish --tag latest --access public
```

GitHub release

## Run Local CLI

```bash
npm run cli -- scan -d 30
```
