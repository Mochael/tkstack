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

The code-centric view adds the `review-diff:<path>` fence to Diffmap. It renders actual patches in a wide split diff, with syntax highlighting and line notes. The fence format is `@new:<line>` or `@old:<line>`, a tab, the note, then `--- PATCH ---` and a unified diff. The viewer checks that the patch contains one matching file and each note points into a hunk. The generator selects historical hunks by code anchor; for files added in a commit, it makes a smaller excerpt of that file's added lines.
