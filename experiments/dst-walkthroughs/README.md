# Tandem DST Diffmap variants

Three local views of the Tandem deterministic simulation testing spec at commit `eb7a3fa9e70adb73fb5b44b8a5baf2997bc78918`:

| View             | Input                                                                                        | Output                         |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| Current document | `templates/current.md`, copied verbatim from the pinned commit                               | `generated/00-current.md`      |
| Question-led     | `prompts/questions.md` and editable `templates/questions.md`                                 | `generated/01-questions.md`    |
| Code-centric     | `prompts/code-centric.md`, `code-plan.json`, and historical patches from the pinned checkout | `generated/02-code-centric.md` |

`prompts/current-skill-snapshot.md` preserves the fork's current code-walkthrough instructions. The prompts are saved so you can make another editorial iteration; the deterministic generator copies the edited question template and rebuilds the code view from `code-plan.json`.

From the Diffmap fork root:

```sh
git clone --filter=blob:none https://github.com/tanishqkancharla/tandem.git tmp/tandem-source
git -C tmp/tandem-source checkout eb7a3fa9e70adb73fb5b44b8a5baf2997bc78918
node experiments/dst-walkthroughs/generate.mjs
node --import tsx src/cli.ts serve experiments/dst-walkthroughs/generated/00-current.md --root tmp/tandem-source
```

Serve the other two files with the same command, changing only the filename. Each invocation prints its local URL. To use a different Tandem checkout, pass its path to `generate.mjs` and to `--root`.

The code-centric view adds the `review-diff:<path>` fence to Diffmap. It renders patches in a wide split diff, with syntax highlighting and line notes. The fence format is `@new:<line>` or `@old:<line>`, a tab, the note, then `--- PATCH ---` and a unified diff. The viewer checks that the patch contains one matching file and each note points into a hunk.

`code-plan.json` orders the code by the running call path, with explicit inputs and outputs at each stage. A stage can contain several focused code blocks. The generator selects full historical hunks by code anchor, or a shorter new-side excerpt. An excerpt puts exact source lines from the named commit on the right side; it is a focused view, so lines that were context in the full patch also appear green. For modified files, the generator checks that every excerpted line appears on the new side of that commit's patch. The code-first page uses a possible two-step path to show how a write paused at a gate becomes an option on the next iteration.
