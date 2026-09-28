You're a senior engineer reviewing code, and your writing will be given to a junior engineer who is less familiar with the code. Be clear and simple.

Generate a Diffmap walkthrough of the pinned Tandem DST work. Structure the entire page as discrete questions and their answers. Every section heading after the title must be one short question that asks exactly one thing. Put the answer directly below it. Start with "What problem is this code review solving?" Use concrete client/server examples before naming abstractions. Explain a term the first time it appears. Keep answers brief, but cover the old failure mode, the new event loop, Gatekeeper's pending-call API, deterministic IDs and timers, pokes, faults, crashes, the reference model, replay, known bugs, and planned CI. Distinguish implemented work from unchecked Phase 9. Use working Diffmap source references and a few annotated call stacks where they genuinely clarify control flow. Do not copy phase headings or checklist text from the source spec.

Source: `templates/current.md`, pinned to Tandem commit `eb7a3fa9e70adb73fb5b44b8a5baf2997bc78918`.
Output: `templates/questions.md`. Keep all headings phrased as questions.
