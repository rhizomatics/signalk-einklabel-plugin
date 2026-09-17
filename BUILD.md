# signalk-einklabel-plugin Development

## Pre-reqs

- nodejs
- npm
- pre-commit
  - `apt install pre-commit`
  - `pre-commit install`

## Release Beta

```bash
npm login
git tag -f beta
git tag -f v1.2.0-beta
git push --tags --force
npm publish --tag beta --access public
```

## Release Prod

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
