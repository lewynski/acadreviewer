# Vendoring pdf.js

Reading a PDF in the browser needs pdf.js. By default it is fetched from a CDN the
first time someone uploads one; put a copy here instead and it is never fetched at all.
Worth doing if your network blocks CDNs, if you want the site pinned to a version you
have tested, or if you would rather it not depend on somebody else's uptime.

`assets/js/extract.js` looks here first, checks with a HEAD request that the file is
really being served as JavaScript, and only falls back to a CDN if it is not.

## Put these three things in place

```
assets/vendor/pdfjs/pdf.min.mjs
assets/vendor/pdfjs/pdf.worker.min.mjs
assets/vendor/pdfjs/cmaps/          (optional)
```

Both `.mjs` files come from the `build/` folder of a `pdfjs-dist` release, and they must
be the same version as each other. The `cmaps/` folder — copied from the release root,
not from `build/` — is only needed for PDFs in CJK or other scripts that rely on
character maps; skip it if all your handouts are in English.

## Getting the files

Download `pdfjs-<version>-dist.zip` from
[github.com/mozilla/pdf.js/releases](https://github.com/mozilla/pdf.js/releases) and
copy `build/pdf.min.mjs`, `build/pdf.worker.min.mjs` and `cmaps/` out of it. Or, if you
have npm to hand:

```bash
npm pack pdfjs-dist@5           # writes pdfjs-dist-<version>.tgz
tar -xzf pdfjs-dist-*.tgz
mkdir -p assets/vendor/pdfjs
cp package/build/pdf.min.mjs package/build/pdf.worker.min.mjs assets/vendor/pdfjs/
cp -r package/cmaps assets/vendor/pdfjs/       # optional
rm -rf package pdfjs-dist-*.tgz
```

Pin the version you actually copied — write it down here, in this file, next to the
date — because the point of vendoring is knowing what you are running. Then commit the
files; they belong in the repo, and `.gitignore` does not exclude them.

Check it worked by uploading a PDF and watching the network panel: with a local copy
there is a HEAD and a GET to `/assets/vendor/pdfjs/`, and nothing to jsdelivr or unpkg.
If the HEAD comes back as anything other than JavaScript, the loader ignores the local
copy on purpose and goes to the CDN, which is the one failure worth checking for.

Vendored version: not yet vendored.
