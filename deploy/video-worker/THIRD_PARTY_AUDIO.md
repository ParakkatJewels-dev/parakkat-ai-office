# Audio skills shipped with the AI Office worker

- [Earshot](https://github.com/Leonxlnx/earshot/tree/591fa3e028032e6dce56620a20e932e35667e8d8), commit `591fa3e028032e6dce56620a20e932e35667e8d8`. The project skill and source archive are included. Code license: MIT (LICENSE is inside the source archive). This is the GitHub audio tool, not the unrelated PyPI package also named `earshot`.
- [Clipwing real-sfx](https://github.com/Clipwing/skills/tree/edbefcbc3474869e6cc1e8a7ca583b0efd0dab7e/skills/real-sfx), commit `edbefcbc3474869e6cc1e8a7ca583b0efd0dab7e`. The skill, scripts, and references are included. Its README states the scripts are MIT. Its mutable `config.json`, tests, and bundled audio pack are excluded from the worker update.
- `audio_skills.py install` installs `uisfx@0.4.0` from npm into the real-sfx skill folder when first needed. The upstream package describes its sounds as CC0. Other sound libraries remain on the editing PC under their own terms.

Earshot's model-based analysis downloads its pinned CLAP and AST model weights on first use (about 1.1 GB). The worker does not prefetch these models or upload source audio. Earshot's optional `llm` command is not part of this workflow.
