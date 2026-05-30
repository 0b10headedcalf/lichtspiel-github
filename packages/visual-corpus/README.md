# @lichtspiel/visual-corpus

The visual scene library: template metadata + retrieval descriptors, plus
provenance for the Processing/Windchime concepts each template adapts.

- `manifests/templates.json` — serializable catalog (mirrors the p5 runtime's
  `TemplateRegistry.catalog()`). Read by the bridge + ml-service.
- `manifests/descriptors.json` — Phase 5 metadata-retrieval descriptors
  (keywords + musical affinities + suggested params per scene).
- `source-processing/README.md` — provenance: which Processing source each
  template draws ideas from, and the borrow-not-fork rules.
- `converted-p5/` — landing area for any future semi-automated Processing→p5
  conversions (none yet; current templates are hand-written).

The runtime templates themselves live in `apps/p5-runtime/src/templates/` —
this package is the *catalog/metadata*, kept p5-free so non-browser services
can reason about scenes.
