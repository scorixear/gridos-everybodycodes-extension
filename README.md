# GridOS — EverybodyCodes

Language support, run, and debug for **GridOS** inside VS Code.

> **GridOS** is a 2D Turing-machine simulator created by [EverybodyCodes](https://everybody.codes). In GridOS, one or more read/write heads move across a character grid following a set of user-defined rules. This extension lets you write, run, and debug GridOS programs without leaving VS Code.

---

## Features

| Feature                    | Details                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| **Syntax highlighting**    | `.gridec` programs and `.grid` grid files get full colour themes                         |
| **Live error diagnostics** | Red squiggles for invalid rule tokens, wrong head count, bad MOVE characters             |
| **Run**                    | Executes your program and shows the final grid in the built-in **GridOS** terminal       |
| **Debug**                  | Full VS Code debugger: breakpoints, step over, continue, Variables panel                 |
| **Head overlay**           | During debugging, head positions are highlighted (yellow = single head, red = collision) |

---

## File Types

| Extension | Purpose                                                        |
| --------- | -------------------------------------------------------------- |
| `.gridec` | The program — rules, states, and the `HEADS` command           |
| `.grid`   | The grid — initial cell content and named head start positions |

A `.grid` file must exist alongside every `.gridec` file with the same base name (e.g. `puzzle.gridec` + `puzzle.grid`).

---

## Grid Files

A `.grid` file defines the initial state of the 2D grid and the named starting positions for the heads.

### Structure

```
GRID
<grid content>
POSITIONS
<label> <row> <col>
...
```

Both keywords must be present. `POSITIONS` must come after `GRID`.

### Grid content

The lines between `GRID` and `POSITIONS` describe the initial cell content. Each character maps to one cell — what you see is what the grid contains. Spaces represent empty cells.

### POSITIONS section

Each line below `POSITIONS` names a starting location for a head:

```
<label> <row> <col>
```

- `label` — a single character that matches a character used in the `HEADS` command of the `.gridec` file
- `row` / `col` — 0-based integer coordinates into the grid content above

Multiple positions can share the same label (placing multiple heads at the same starting cell).

### Example

```grid
GRID
###========###
POSITIONS
A 0 0
B 0 13
```

This grid has one row of 14 characters. Head label `A` starts at column 0 (the first `#`) and label `B` starts at column 13 (the last `#`). A program using `HEADS AB` would place one head at each of those positions.

---

## Running and Debugging

Open any `.gridec` file. A single button appears in the editor title bar. Its icon reflects the last-used action:

- **`▶` (play icon)** — last action was *Run*
- **`⏵` (debug icon)** — last action was *Debug*

Clicking the button opens a dropdown with two options:

- **Run GridOS Program** — executes the program to completion and shows the final grid in the built-in **GridOS** terminal.
- **Debug GridOS Program** — starts a VS Code debug session with breakpoint and step support.

The selected action becomes the new default and its icon is shown on the button until you choose the other option.

To start debugging with **F5**, make sure the active editor is a `.gridec` file (no `launch.json` required).

---

## Debugger

Set breakpoints by clicking the gutter next to any rule line. Breakpoints are validated — only lines that contain a rule are accepted.

| Action                       | Shortcut                 |
| ---------------------------- | ------------------------ |
| Start debugging              | `F5` or dropdown → Debug |
| Continue to next breakpoint  | `F5`                     |
| Step over (execute one rule) | `F10`                    |
| Stop                         | `⇧F5`                    |

The **GridOS** terminal updates on every pause, showing the current grid with head positions highlighted. The **Variables** panel shows:

- `state` — current machine state
- `step` — number of steps executed
- `head0`, `head1`, … — position `(row,col)` and the symbol currently under each head

---

## Live Diagnostics

The extension validates `.gridec` files on every keystroke and underlines errors:

| Error                   | What is flagged                                                      |
| ----------------------- | -------------------------------------------------------------------- |
| Wrong READ/WRITE length | Token underlined — must match the number of heads                    |
| Wrong MOVE length       | Token underlined — must match the number of heads                    |
| Invalid MOVE character  | Single character underlined — only `U`, `D`, `L`, `R`, `S` are valid |
| Extra tokens            | Any token past the 5th on a rule line                                |
| Duplicate `HEADS`       | Second `HEADS` declaration                                           |
| Rule before `HEADS`     | Any rule that appears before the `HEADS` command                     |

---

## Language Reference

The full GridOS language reference - including rule syntax, special characters, MOVE directions, multi-head programs, and formatting tips - is available in the official EverybodyCodes tutorial:

**<https://everybody.codes/gridos/tutorial>**

---

## Settings

All limits are configurable in **Settings → GridOS**:

| Setting                  | Default   | Description                        |
| ------------------------ | --------- | ---------------------------------- |
| `gridec.maxHeads`        | 10        | Maximum number of heads            |
| `gridec.maxStates`       | 100       | Maximum number of distinct states  |
| `gridec.maxRules`        | 1000      | Maximum number of rules            |
| `gridec.maxSteps`        | 100 000   | Step limit before a run is aborted |
| `gridec.maxProgramBytes` | 1 000 000 | Maximum program file size in bytes |
