# One-time dependency/lockfile synchronization for Phase 2 SHACL Core validation.
# Run from the Maestro repository root BEFORE npm run build or npm ci.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'package.json') -or -not (Test-Path 'package-lock.json')) {
  throw 'Run this from the Maestro project root with package.json and package-lock.json present.'
}
npm install --save-exact rdf-validate-shacl@0.6.5 @zazuko/env-node@3.1.0
if ($LASTEXITCODE -ne 0) {
  throw 'SHACL dependency install failed. Do not commit package.json without the regenerated package-lock.json.'
}
Write-Host 'Dependencies installed; package-lock.json regenerated.'
