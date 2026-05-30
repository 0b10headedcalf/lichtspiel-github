# Competitive positioning

The market is crowded with **"visuals in/around Ableton"** products. It is **not**
crowded with products that make *semantic audiovisual mapping itself a tactile
musical instrument*. That is the wedge.

| Tool | What it does well | Lichtspiel differentiates by |
|---|---|---|
| **TDAbleton** | Routes the whole Live set into TouchDesigner (Remote Scripts, M4L, OSC). | p5/code-native browser visuals; semantic session-aware suggestion; monome latent navigation; constrained code mutation — not a generic Live→TD bridge. |
| **Videosync** | Makes video behave like audio/MIDI clips in Live (instruments, effects, ISF). | Generated p5 visuals, not timeline/video clips; semantic scene *suggestion*; code template mutation. |
| **Zwobot / EboSuite** | Mature VJ/video/effects + 3D (Unreal) workflows in Live. | Code-generated visuals; visual *intelligence* from Live state; portable browser runtime; ML-assisted mapping. |
| **Imaginando VS** | Music-first visual synth with audio/MIDI modulation + shaders. | Retrieval/semantics over a curated p5 scene space; monome as the discovery surface, not generic MIDI mod. |

## The three-sentence pitch

1. **A semantic correspondence engine for Live** — clips don't just modulate
   visuals, they *retrieve/suggest* coherent visual code-scenes via descriptors
   (and later a joint embedding space).
2. **A monome-first control surface for latent audiovisual navigation** — grid
   and arc navigate semantic neighborhoods, lock correspondences, or
   deliberately pick "distant" mappings.
3. **A live-coded browser visual layer inside a Live workflow** — a p5-centered,
   code-literate, semantically retrievable visual system is a distinct category.

## Research basis (retrieval, not generation, for the MVP)

The MVP favors **pretrained embeddings + retrieval** over generation:
ImageBind (shared audio-image-text space), MuLan / MERT (music-audio), MusicBERT
(symbolic MIDI). Generative audio→video (SonicDiffusion, Syncphony, MusicInfuser)
is roadmap-only — too heavy/unstable for a weekend-stable Live tool. Reference
PDFs live in the local `context_docs/` (gitignored).

**Core line:** Lichtspiel is not "another VJ plugin" — it is an *audiovisual
composition assistant for Live*.
