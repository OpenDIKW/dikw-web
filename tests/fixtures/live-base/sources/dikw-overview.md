# DIKW Overview

The DIKW pyramid models how raw signal becomes understanding across four
layers: Data, Information, Knowledge, and Wisdom. This fixture exists only to
seed a live `dikw-core` for end-to-end integration verification of `dikw-web`.

![[cover.png]]

Each layer builds on the one beneath it. See [[Data and Information]] for the
two lower layers and [[Knowledge and Wisdom]] for the two upper layers.

## Why a tiny fixture

The set is deliberately small and deterministic so the ingest → synth → lint
write pipeline runs quickly and cheaply against a real LLM, while still
producing a non-empty graph: the wikilinks above create resolvable edges
between these source pages.
