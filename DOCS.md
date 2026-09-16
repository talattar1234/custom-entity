# Documentation map

Every Markdown file in this repo, what it is for, and when to open it. Start
here if you are not sure which one you want.

| Document | Size | What it is | Open it when |
| --- | --- | --- | --- |
| [`README.md`](./README.md) | ~380 lines | The orientation doc: what the component does, the entity model, the drag/drop mechanism end to end, the edge-case table, the extension point, scope. | You are meeting this project for the first time and want the normal overview. |
| [`ARCHITECTURE-for-dummies.md`](./ARCHITECTURE-for-dummies.md) | ~370 lines | The plain-English version of the same material: what this is, why not HTML5 drag & drop, the one core idea, a runnable minimal example, and the four things that will actually bite you. | You want it explained without jargon, or you are new to pointer-event drag handling. |
| [`USAGE.md`](./USAGE.md) | ~260 lines | Integration guide: a complete minimal host, what each piece does, the gotchas, adding a second entity type, multi-entity drags, canvas/WebGL sources, optional extras. | You are wiring MagicChat into a host application and want working code to copy. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | ~525 lines | The reference for the *existing* code: §1 boundary, §2 module map (which file to touch for which change), §3 drag lifecycle and invariants, §4 public API, §5 state ownership, §6 extension recipes, §7 pitfalls, §8 not implemented, §9 verification checklist. | You are about to edit this codebase and need to know where things live and what must stay true. |
| [`DECISIONS.md`](./DECISIONS.md) | ~625 lines | 16 numbered design decisions, each with what was rejected and the specific failure mode that rejected it. §15 covers the drag API itself; §5, §13, §14 and §16 cover the latch, the debug feed, overlay visibility and chip ownership. | You are about to "simplify" the mechanism. Check here first — most obvious simplifications were tried and have a documented failure mode. |
| [`IMPLEMENTATION-SPEC.md`](./IMPLEMENTATION-SPEC.md) | ~700 lines | How to add the **drag-an-entity-into-the-chat capability to a chat component that already exists** — not how to build a chat. The integration checklist, the complete type contract, the imperative ref API, the drop-target mechanism step by step, the invariants, the load-bearing CSS, the host contract, and acceptance criteria. **Deliberately standalone**: it links to nothing here and needs no source reading, so it can be handed to another agent or repo on its own. The rationale it carries is only what constrains the implementation; the decision history stays in `DECISIONS.md`. | You (or another agent) are grafting this drag & drop onto a different chat component. |
| [`DOCS.md`](./DOCS.md) | this file | The index. | You are here. |
| [`CLAUDE.md`](./CLAUDE.md) | ~72 lines | Instructions for coding agents working in this repo: which docs to read first, the commands, the hard rules whose violations fail silently, and the code conventions. | An agent starts a session here. It is loaded automatically. |

---

## Which one do I actually want?

- **"What is this project?"** → [`README.md`](./README.md), or
  [`ARCHITECTURE-for-dummies.md`](./ARCHITECTURE-for-dummies.md) for the gentle
  version.
- **"How do I use it in my app?"** → [`USAGE.md`](./USAGE.md).
- **"Where do I change X?"** → [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2.
- **"Why is this code so complicated?"** → [`DECISIONS.md`](./DECISIONS.md).
- **"Build me this from scratch."** → [`IMPLEMENTATION-SPEC.md`](./IMPLEMENTATION-SPEC.md).

## Overlap, on purpose

`README`, `ARCHITECTURE-for-dummies`, `USAGE` and `IMPLEMENTATION-SPEC` all
explain the same drag mechanism, at four different depths and for four different
readers. That repetition is intentional — but it means **a behaviour change
usually touches more than one file**. These documents are the spec, not notes;
keep them current.

The one executable document is not Markdown at all:
`src/magic-chat/MagicChat.stories.tsx` plays the host role and runs as the test
suite (`npm test`). [`ARCHITECTURE.md`](./ARCHITECTURE.md) §9 is the manual
checklist for what synthetic events cannot cover — real pointer drags, touch,
map panning.
