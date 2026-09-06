# Academic Reviewer

Upload the lecture slides and handouts you are studying, and get back a reviewer:
multiple choice, identification, enumeration and matching questions drawn from the
whole of the material, with the correct answers, a score that shows where you
slipped, and a single HTML file you can keep and open later with no internet.

Files are read in your browser. Only the text found in them is sent out, and only
to write the questions; your answers are marked on your own device.

## How it works

`assets/js/extract.js` reads PDF, PowerPoint, Word and plain-text files in the
browser and turns them into units, one per slide or page. `generate.js` splits
those units into contiguous batches, works out how many of each question type each
batch owes, and calls `api/generate.js`, a Vercel function that holds your Groq key
and never exposes it. Because every batch is asked for its own share, a 60-slide
deck gets questions from slide 58 as well as slide 2.

`grade.js` marks answers, `quiz.js` draws and scores the quiz, and `exporter.js`
inlines the stylesheet plus those two files into one self-contained HTML document —
so the offline copy is the same engine, not a second implementation of it.

## Deploy it

```bash
git init
git add .
git commit -m "Academic Reviewer"
git branch -M main
git remote add origin https://github.com/<you>/academic-reviewer.git
git push -u origin main
```

Then at [vercel.com/new](https://vercel.com/new), import the repo. There is no build
step and no framework to pick; leave the defaults. Before the first deploy finishes,
add your environment variables under Project → Settings → Environment Variables, then
redeploy so the function picks them up.

| Name | Required | What it is |
| --- | --- | --- |
| `GROQ_API_KEY` | yes | A key from [console.groq.com/keys](https://console.groq.com/keys). |
| `ACCESS_CODE` | no, but see below | A shared password. Requests without it get 401. |
| `GROQ_MODEL` | no | Model to try first, e.g. `openai/gpt-oss-120b`. |
| `RATE_LIMIT` | no | Requests allowed per IP per 5 minutes. Defaults to 40. |

`GROQ_MODEL` only sets the first choice. If that model has been retired, the function
falls through a list of known-good ones and reports which it used, so a model shutdown
does not take the site down with it.

## Read this before you share the link

Your key stays on the server, but the endpoint that spends it does not. Once the site
is deployed, anyone who has the URL can open it and generate questions on your Groq
account. Nothing about a static site can prevent that on its own, so decide how closed
you want it to be:

Set `ACCESS_CODE` to something only your group knows. The app asks for the code the
first time the server rejects a request, remembers it in the browser, and sends it with
every later one. This is the cheapest useful lock, and it is the one this project is
built around — but treat it as a shared password, not real authentication: everyone
holding it is indistinguishable, and revoking it means changing it for all of you.

Leave `RATE_LIMIT` alone or lower it. It is a per-IP cap held in the function's memory,
so it resets whenever Vercel starts a new instance and will not stop a determined
someone. It is there to keep an accident — a stuck loop, a friend clicking twice —
from becoming a bill.

If the reviewer is only for people you can name, turn on Vercel's own protection
(Project → Settings → Deployment Protection). Vercel Authentication puts every request
behind a login before your code runs at all, which is stronger than anything in this
repo. It is the right answer if the group is small and all of you have Vercel accounts.

Watch the spend either way, at [console.groq.com](https://console.groq.com), and rotate
the key if the link gets further than you meant it to. `.env.local` is git-ignored; keep
it that way, and never paste a key into a file under `assets/`, because everything there
is served to the browser.

## Run it locally

The page needs the function, so a plain file open will not work: `index.html` opened
from disk gets "No question writer answered at /api/generate". Use the Vercel CLI,
which serves the static files and the function together.

```bash
npm i -g vercel
cp .env.example .env.local   # then put your real key in it
vercel dev                   # http://localhost:3000
```

```bash
npm test                     # 81 tests, no network, no install
```

The tests run on Node 20+ with nothing installed: no dependencies, no test framework
beyond `node --test`, and nothing that reaches the network — Groq is stubbed, so the
suite costs nothing to run. They cover the zip reader, the grader's answer matching, the
prompt and validator, batching and allocation, the quiz engine and scoreboard against a
stub DOM (both modes, partial credit, the coverage lattice, retakes), and the agreement
between `index.html`, `app.js` and the stylesheet.

Two of them are worth knowing about. The function in `api/generate.js` is tested with a
stubbed Groq: the access code turning requests away before they cost anything, the per-IP
cap, a retired model being stepped over, and each way Groq can refuse arriving as
something a reader can act on. And the file you download is taken apart, put on an
otherwise empty page with the `AR` namespace deleted, and made to boot, mark answers and
store an attempt on its own — including a question whose text tries to close the script
tag. If the export ever drifts from the app, that test fails.

## What it reads

`.pdf`, `.pptx`, `.pptm`, `.docx`, `.docm`, `.txt`, `.md`, `.markdown`, `.csv`. Add as
many at once as you like, from as many subjects as you like. Slide notes count as part
of the slide they belong to.

The old binary formats, `.ppt` and `.doc`, cannot be read in a browser. Open them in
PowerPoint or Word and save as `.pptx` or `.docx` first. A PDF that is a photograph of
a page — a scan with no text layer — has nothing to extract; the file list will say so
per file instead of failing the whole upload. Very large uploads are trimmed at 400
slides or pages, and each unit at 3000 characters, which is roughly a dense slide.

You choose the mix yourself, up to 25 of any one type and 60 questions in total, and
whether they lean on recall or on reasoning. Whatever you ask for is spread across the
whole upload rather than front-loaded.

## The file you keep

"Save this reviewer as a file" writes one HTML document, usually a few hundred
kilobytes, that carries its own stylesheet, its own grader and the questions inside it.
Open it from your downloads folder on a plane, on a phone, next year: the same quiz,
marked the same way, remembering your progress in that browser. Printing it gives a
clean paper copy with the answer key on its own last page, which is what you want the
night before an exam and the only thing that still works with JavaScript turned off.

## A deploy with no CDN

One dependency loads from a CDN at runtime: pdf.js, and only when someone uploads a
PDF. Everything else is in this repo. To close that last hole — for a deploy on a
network that blocks CDNs, or so the site keeps working if one goes down — vendor pdf.js
into `assets/vendor/pdfjs/`. See [assets/vendor/README.md](assets/vendor/README.md);
the loader prefers a local copy and only reaches out if there isn't one.

## Layout

```
index.html            the whole interface
api/generate.js       Vercel function; holds the key, calls Groq
lib/reviewer.js       prompt, JSON repair, item validation (server side)
assets/js/extract.js  files to units, in the browser
assets/js/generate.js batching, allocation, retries
assets/js/grade.js    answer matching, scoring
assets/js/quiz.js     the quiz on screen, in both modes
assets/js/exporter.js the offline file and its answer key
assets/js/app.js      wiring
assets/js/zip.js      minimal zip reader for pptx/docx
tests/                node --test, no dependencies
```

Built for a small group of friends. Use it, fork it, change it.


