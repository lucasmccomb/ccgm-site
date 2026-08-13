# Sample Hazards Module

A fixture module used to exercise the E2 ingest pipeline's defenses in one
place. Nothing in this file should ever render as active HTML, execute as
script, or survive as a relative reference once ingested.

## XSS payloads (must render inert)

<script>alert('xss')</script>

<img src="x" onerror="alert('xss')">

[click me](javascript:alert('xss'))

## Hidden Unicode (must be stripped and recorded in sanitizedFiles)

This sentence contains a hidden​ zero-width character and a
bidi‮ override marker, both of which must disappear from the
ingested content.

## Relative references (must rewrite to pinned-SHA GitHub blob URLs)

See [the mystery file](lib/mystery.xyz), which is declared in this module's
own `files`, and see [the undeclared note](docs/undeclared-note.md), which
is not.
