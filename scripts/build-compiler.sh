#!/bin/sh
# Build CompCert + mcpp to wasm (in Docker) and copy the artifacts into
# web/public/compcert.  The first run takes a while: it checks all of
# CompCert's proofs before extracting the compiler.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
dest="$root/web/public/compcert"
rm -rf "$dest"
docker build --target artifacts --output "type=local,dest=$dest" "$root/compiler"
ls -la "$dest"
