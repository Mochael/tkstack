You're a senior engineer reviewing code, and your writing will be given to a junior engineer who is less familiar with the code. Be clear and simple.

Generate a code-centric Diffmap view of the pinned Tandem DST work. Reuse Diffmap's split old/new diff viewer with its red/green lines and syntax highlighting. Make code the main content and attach short review notes to the exact old or new lines they explain.

Organize the table of contents by **runtime cause and effect**, beginning at `DstSimulation.execute()`: start the world → read paused calls → choose one possible action → apply the write or control branch → settle and check → repeat, finish, or replay. Name each section for its place in that sequence. Give each section a compact input and output so the reader can see what the next section receives. Show the write and control paths as branches that meet again at the check. A write may become a paused call in the _next_ iteration; the check runs before that iteration starts. Include the final server comparison after the step loop, because client agreement alone does not prove the server is correct.

Use a short possible two-step example to explain the loop. Keep the rest code-led: no essay sections, phase checklists, or generic commentary. Write for a junior engineer with less context, as a senior engineer reviewing the code. Preserve actual patches and line numbers. Ensure comments do not claim Phase 9 CI is implemented.

The experiment stores selected commit hunks, excerpts, and line comments in `code-plan.json`. `generate.mjs` reads that plan and the pinned Tandem checkout to make `generated/02-code-centric.md`. Edit the plan and rerun the generator for another iteration.
