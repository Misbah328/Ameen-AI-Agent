---
name: Web Speech transcription architecture
description: This app transcribes via the browser Web Speech API, NOT Whisper — what is and isn't possible, and how cut-off/persistence/accent are handled.
---

# Transcription uses the browser Web Speech API, not Whisper

Recording/transcription runs entirely client-side via `window.webkitSpeechRecognition`
(`public/js/app.js`, the `Rec` object). There is no server-side ASR and no OpenAI
key configured.

**Why this matters:** requests framed around Whisper features cannot be taken
literally. The Web Speech API has **no** configurable VAD/endpointing/silence
threshold, **no** "initial prompt" to prime accents, and takes exactly **one**
`lang` at a time (no two-pass language detection). Don't promise those; achieve the
*outcome* instead. Switching to real Whisper = audio upload + new secret + major
rework (high risk for a live demo).

**How the outcomes are achieved instead:**
- **No cut-off ("infinite" capture):** `continuous=true` + `onend` always restarts
  while `isRecording`, via a guarded `_restartRec()` that swallows Chrome's
  "recognition has already started" race, plus a ~6s watchdog with a `_recAlive`
  heartbeat (set in `onresult` and seeded on start) for engines that silently die.
  Fatal errors (`not-allowed`/`service-not-allowed`) set `_recFatal` and stop the
  restart loop so it never spins on a denied mic.
- **Real-time persistence:** `persistTranscript()` PATCHes the transcript every ~12s.
  Writes are serialized with a `_saving` flag (transcript only grows, so a skipped
  tick is covered next tick); `stop()` awaits the in-flight `_savePromise` before its
  final write so the complete transcript always lands last — no stale overwrite.
- **Accent / name accuracy:** `src/utils/nameCorrect.js` does conservative Levenshtein
  correction (similarity ≥ 0.8 AND edit distance ≤ 2, min length 4) snapping
  mis-transcribed proper nouns to the known roster. Wired into `pipeline.js` BEFORE
  the AI call; the stored transcript is kept verbatim — only the copy sent to Claude
  is corrected. Matches against all `users` (the roster = the owners), thresholds keep
  false positives near zero.

**Verification:** `scripts/transcription-stress-test.js` (offline correction unit test
+ live 5-min mixed AR/EN paused meeting end-to-end). Run alongside
`scripts/edit-to-reminder-test.js`.
