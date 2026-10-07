# Storyline review

A pull request is reviewed as a linear story of code, not a list of files. The reader starts where execution enters the changed code and follows it down: the function, the helpers it calls, the types and constants they use, and the tests that prove it.

## Units

**Card.** One parsed symbol: a function, method, class, interface, type, enum, constant group, test, or a module-level block. A card shows only that symbol's lines, with the diff overlaid. Its change is `added`, `modified`, `deleted`, or `context`. A `context` card is unchanged code shown because it is where the story enters or what it touches.

**Section.** One coherent idea: a root card plus the cards that exist to serve it. A section reads top to bottom in process order.

**Story.** The ordered sections. The review is linear: Overview, Story map, Section 1 … Section N, then file-level leftovers.

## How a section is built

1. **Root.** A changed symbol that no other changed symbol calls. If an unchanged symbol in a changed file calls it, that caller is the section's **entry** card and comes first, so the reader sees where the new code is reached from.
2. **Steps and helpers.** Walk the root's calls depth first in the order they appear in its body. A changed callee joins this section if this is the first section to reach it. A callee already placed earlier becomes a compact "see section N" card, so nothing is shown twice.
3. **Data.** Types, enums, interfaces and constants the section's functions reference follow its functions. Changed ones are full cards. Unchanged ones appear as context only when they are small.
4. **Classes.** A class card shows its shell (declaration, fields, member signatures). Changed members follow it as their own cards.
5. **Tests.** Tests that reference any symbol in the section close it. A test that touches nothing in the story goes to a trailing "Other tests" section.

## How far up the entry climbs

Never walk the whole call tree. Surface the most relevant chunk, at most two caller hops above the root, and stop at the first boundary:

| Code | Entry stops at |
| --- | --- |
| Pipelines (Nextflow) | The product workflow in `workflows/*.nf` that runs the changed process or subworkflow. Never `main.nf`, the dispatcher. |
| Pipelines (Python) | The CLI or workflow entry function: `if __name__ == "__main__"`, click or argparse commands, or the top-level `run_*`/`main` of the module. |
| Terraform | No climbing. Each top-level block (`module`, `resource`, `data`, `variable`, `output`, `locals`) is a card. A section is one component: a `module` block plus the resources of the module directory it points at. |
| Services and APIs | The route handler (Flask/FastAPI/Express-style route registration) or the caller function, if within two hops. |
| Frontend | The page or route component if within two hops, otherwise the component that renders the changed one. |
| Anything else | The nearest caller only. |

An entry card is an excerpt, not the whole caller: the lines that reach the story with a few lines around them, under the caller's name. A caller of 25 lines or fewer is shown whole.

Pipeline entries often live in unchanged files. For Nextflow, prot reads the `include` statements in `workflows/*.nf` and `subworkflows/*/main.nf` at head to find which product workflow runs the changed code.

## Splitting large changes

A section does not have to hold a whole file, and an added file can be split across sections when its symbols serve different ideas. The guarantee is about lines, not files. By the end of the review, every added and every deleted line has appeared in exactly one full card.

## Section order

Sections follow the call graph from entries: a section whose root is called by an earlier section's code comes after it. Unconnected changes come next, ordered by role and size. Config and build, docs, remaining tests, schema, and lockfiles or generated files end the story as file-level sections, as before.

## Where the data comes from

- **Parsing.** tree-sitter (web-tree-sitter 0.22 with the tree-sitter-wasms grammars) parses the head and base versions of each changed code file into symbols with line ranges, and records which names each symbol references.
- **Change state.** Diff hunks are mapped onto symbol ranges. Changed lines outside every symbol form a module-level card.
- **References.** Names resolve to indexed symbols, preferring the same file, then the same language.
- **The AI guide.** Claude receives the symbol index and the diff and writes section titles and summaries. It may merge, split or reorder sections, but only by referencing indexed symbol ids. A validator places every changed symbol exactly once and appends anything missed with the rules above.

## Limits

Callers of new code are almost always in changed files, because code that calls a new function had to change. Callers of a modified existing function can live in unchanged files. Outside the Nextflow include scan, those impact sites are not shown yet.
