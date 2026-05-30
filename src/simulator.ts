// GridOS Simulator — TypeScript port of simulator.py
// Limits match the Python reference implementation exactly.

export const MAX_HEADS = 10;
export const MAX_STATES = 100;
export const MAX_RULES = 1_000;
export const MAX_STEPS = 100_000;
export const MAX_PROGRAM_BYTES = 1_000_000;

export interface SimulatorLimits {
    maxHeads: number;
    maxStates: number;
    maxRules: number;
    maxSteps: number;
    maxProgramBytes: number;
}

export const DEFAULT_LIMITS: SimulatorLimits = {
    maxHeads: MAX_HEADS,
    maxStates: MAX_STATES,
    maxRules: MAX_RULES,
    maxSteps: MAX_STEPS,
    maxProgramBytes: MAX_PROGRAM_BYTES,
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SimulatorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SimulatorError';
    }
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

export interface Rule {
    state: string;
    reads: string[];      // one pattern char per head
    nextState: string;
    writes: string[];     // one write char per head
    moves: string[];      // one direction char per head
    lineNumber: number;   // 1-based source line (for breakpoints)
}

// ---------------------------------------------------------------------------
// Pattern / write helpers
// ---------------------------------------------------------------------------

export function matchPattern(pattern: string, value: string): boolean {
    // ' ' (space) is the canonical empty-cell value.
    if (pattern === '*') { return true; }
    if (pattern === '_') { return value === ' '; }   // empty
    if (pattern === '!') { return value !== ' '; }   // any non-empty
    return value === pattern;
}

export function applyWrite(writeChar: string, current: string): string {
    if (writeChar === '*') { return current; }
    if (writeChar === '_') { return ' '; }
    return writeChar;
}

const MOVE_DELTAS: Record<string, [number, number]> = {
    U: [-1, 0],
    D: [1, 0],
    L: [0, -1],
    R: [0, 1],
    S: [0, 0],
};

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export class Grid {
    cells: Map<string, string> = new Map();
    namedPositions: Map<string, [number, number]> = new Map();

    private key(row: number, col: number): string {
        return `${row},${col}`;
    }

    /** Returns ' ' (space) for any cell absent from the loaded grid. */
    get(row: number, col: number): string {
        return this.cells.get(this.key(row, col)) ?? ' ';
    }

    set(row: number, col: number, value: string): void {
        this.cells.set(this.key(row, col), value);
    }

    toAscii(): string {
        if (this.cells.size === 0) { return '(empty grid)'; }

        let minR = Infinity, maxR = -Infinity;
        let minC = Infinity, maxC = -Infinity;

        for (const k of this.cells.keys()) {
            const comma = k.indexOf(',');
            const r = Number(k.slice(0, comma));
            const c = Number(k.slice(comma + 1));
            if (r < minR) { minR = r; }
            if (r > maxR) { maxR = r; }
            if (c < minC) { minC = c; }
            if (c > maxC) { maxC = c; }
        }

        const lines: string[] = [];
        for (let r = minR; r <= maxR; r++) {
            let line = '';
            for (let c = minC; c <= maxC; c++) {
                line += this.cells.get(this.key(r, c)) ?? ' ';
            }
            lines.push(line);
        }
        return lines.join('\n');
    }

    /**
     * Same as toAscii(), but overlays head positions with ANSI colour:
     *   1 head at a cell  → bold yellow
     *   2+ heads at a cell → bold red (collision)
     * The underlying character is always preserved.
     */
    toAsciiWithHeads(heads: [number, number][]): string {
        if (this.cells.size === 0) { return '(empty grid)'; }

        let minR = Infinity, maxR = -Infinity;
        let minC = Infinity, maxC = -Infinity;

        for (const k of this.cells.keys()) {
            const comma = k.indexOf(',');
            const r = Number(k.slice(0, comma));
            const c = Number(k.slice(comma + 1));
            if (r < minR) { minR = r; }
            if (r > maxR) { maxR = r; }
            if (c < minC) { minC = c; }
            if (c > maxC) { maxC = c; }
        }

        // Expand bounding box to include heads that may be outside the grid cells
        for (const [r, c] of heads) {
            if (r < minR) { minR = r; }
            if (r > maxR) { maxR = r; }
            if (c < minC) { minC = c; }
            if (c > maxC) { maxC = c; }
        }

        // Count how many heads are at each cell
        const headCount = new Map<string, number>();
        for (const [r, c] of heads) {
            const k = this.key(r, c);
            headCount.set(k, (headCount.get(k) ?? 0) + 1);
        }

        const BOLD_YELLOW = '\x1b[1;33m';
        const BOLD_RED = '\x1b[1;31m';
        const RESET = '\x1b[0m';

        const lines: string[] = [];
        for (let r = minR; r <= maxR; r++) {
            let line = '';
            for (let c = minC; c <= maxC; c++) {
                const ch = this.cells.get(this.key(r, c)) ?? ' ';
                const count = headCount.get(this.key(r, c)) ?? 0;
                if (count >= 2) {
                    line += BOLD_RED + (ch === ' ' ? '█' : ch) + RESET;
                } else if (count === 1) {
                    line += BOLD_YELLOW + (ch === ' ' ? '█' : ch) + RESET;
                } else {
                    line += ch;
                }
            }
            lines.push(line);
        }
        return lines.join('\n');
    }
}

// ---------------------------------------------------------------------------
// Program parser
// ---------------------------------------------------------------------------

export function parseProgram(text: string, limits: SimulatorLimits = DEFAULT_LIMITS): { headsStr: string; rules: Rule[] } {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > limits.maxProgramBytes) {
        throw new SimulatorError(`Program exceeds maximum size of ${limits.maxProgramBytes} bytes`);
    }

    let headsStr: string | null = null;
    const rules: Rule[] = [];
    const stateNames = new Set<string>();
    const rawLines = text.split('\n');

    for (let idx = 0; idx < rawLines.length; idx++) {
        const lineno = idx + 1;
        let line = rawLines[idx];

        // Strip // comment
        const commentIdx = line.indexOf('//');
        if (commentIdx !== -1) { line = line.slice(0, commentIdx); }

        // Remove lone / separators (visual only, not part of //)
        line = line.replace(/\//g, '');
        line = line.trim();
        if (!line) { continue; }

        const tokens = line.split(/\s+/);

        // ---- HEADS command ------------------------------------------------
        if (tokens[0] === 'HEADS') {
            if (headsStr !== null) {
                throw new SimulatorError(`Line ${lineno}: duplicate HEADS command`);
            }
            if (tokens.length !== 2) {
                throw new SimulatorError(`Line ${lineno}: HEADS requires exactly one argument`);
            }
            headsStr = tokens[1];
            if (headsStr.length === 0) {
                throw new SimulatorError(`Line ${lineno}: HEADS argument is empty`);
            }
            if (headsStr.length > limits.maxHeads) {
                throw new SimulatorError(
                    `Line ${lineno}: too many heads (${headsStr.length}), maximum is ${limits.maxHeads}`
                );
            }
            continue;
        }

        // ---- Rule line ----------------------------------------------------
        if (headsStr === null) {
            throw new SimulatorError(`Line ${lineno}: rule encountered before HEADS command`);
        }
        if (tokens.length !== 5) {
            throw new SimulatorError(
                `Line ${lineno}: expected 5 tokens in rule, got ${tokens.length}: ${JSON.stringify(line)}`
            );
        }

        const n = headsStr.length;
        const [stateTok, readTok, nextStateTok, writeTok, moveTok] = tokens;

        for (const [tokName, tokVal] of [['READ', readTok], ['WRITE', writeTok], ['MOVE', moveTok]] as [string, string][]) {
            if (tokVal.length !== n) {
                throw new SimulatorError(
                    `Line ${lineno}: ${tokName} token ${JSON.stringify(tokVal)} has length ${tokVal.length}, expected ${n} (number of heads)`
                );
            }
        }

        const validMoves = new Set(Object.keys(MOVE_DELTAS));
        for (const ch of moveTok) {
            if (!validMoves.has(ch)) {
                throw new SimulatorError(
                    `Line ${lineno}: invalid MOVE character ${JSON.stringify(ch)}; must be one of ${[...validMoves].sort().join(', ')}`
                );
            }
        }

        rules.push({
            state: stateTok,
            reads: [...readTok],
            nextState: nextStateTok,
            writes: [...writeTok],
            moves: [...moveTok],
            lineNumber: lineno,
        });

        stateNames.add(stateTok);
        stateNames.add(nextStateTok);

        if (rules.length > limits.maxRules) {
            throw new SimulatorError(`Too many rules (${rules.length}), maximum is ${limits.maxRules}`);
        }
    }

    if (headsStr === null) {
        throw new SimulatorError('No HEADS command found in program');
    }
    if (stateNames.size > limits.maxStates) {
        throw new SimulatorError(`Too many states (${stateNames.size}), maximum is ${limits.maxStates}`);
    }

    return { headsStr, rules };
}

// ---------------------------------------------------------------------------
// Grid loader
// ---------------------------------------------------------------------------

export function loadGrid(text: string): Grid {
    // Note: accepts file text directly (extension.ts handles file I/O).
    const lines = text.split('\n');

    let gridKwLine: number | null = null;
    let posKwLine: number | null = null;

    for (let i = 0; i < lines.length; i++) {
        const token = lines[i].trim();
        if (token === 'GRID') {
            if (gridKwLine !== null) {
                throw new SimulatorError(`Line ${i + 1}: duplicate GRID keyword`);
            }
            gridKwLine = i;
        } else if (token === 'POSITIONS') {
            if (posKwLine !== null) {
                throw new SimulatorError(`Line ${i + 1}: duplicate POSITIONS keyword`);
            }
            posKwLine = i;
        }
    }

    if (gridKwLine === null) { throw new SimulatorError('Grid file is missing the GRID keyword'); }
    if (posKwLine === null) { throw new SimulatorError('Grid file is missing the POSITIONS keyword'); }
    if (posKwLine <= gridKwLine) {
        throw new SimulatorError('POSITIONS section must come after the GRID section');
    }

    // Grid content lines: between the two keywords (0-indexed as j within this slice)
    const gridLines = lines.slice(gridKwLine + 1, posKwLine);

    // Active columns: any column that has at least one non-space char across all grid lines
    const activeCols = new Set<number>();
    for (const line of gridLines) {
        for (let c = 0; c < line.length; c++) {
            if (line[c] !== ' ') { activeCols.add(c); }
        }
    }

    // Content row bounds: first..last row index (within gridLines) that contain non-space
    let firstContent: number | null = null;
    let lastContent: number | null = null;
    for (let j = 0; j < gridLines.length; j++) {
        if (gridLines[j].split('').some(ch => ch !== ' ')) {
            if (firstContent === null) { firstContent = j; }
            lastContent = j;
        }
    }

    const grid = new Grid();

    if (firstContent !== null && activeCols.size > 0) {
        for (let j = firstContent; j <= lastContent!; j++) {
            const line = gridLines[j];
            for (const col of activeCols) {
                // Preserve space in active columns — that IS an empty cell value.
                const ch = col < line.length ? line[col] : ' ';
                grid.set(j, col, ch);
            }
        }
    }

    // Parse POSITIONS section
    for (let i = posKwLine + 1; i < lines.length; i++) {
        const rawLine = lines[i].trim();
        if (!rawLine) { continue; }
        const parts = rawLine.split(/\s+/);
        if (parts.length !== 3) {
            throw new SimulatorError(
                `Line ${i + 1}: POSITIONS entry must be '<label> <row> <col>', got: ${JSON.stringify(rawLine)}`
            );
        }
        const [label, rowStr, colStr] = parts;
        if (label.length !== 1) {
            throw new SimulatorError(
                `Line ${i + 1}: position label must be a single character, got ${JSON.stringify(label)}`
            );
        }
        const row = parseInt(rowStr, 10);
        const col = parseInt(colStr, 10);
        if (isNaN(row) || isNaN(col)) {
            throw new SimulatorError(
                `Line ${i + 1}: row and col must be integers, got ${JSON.stringify(rowStr)} and ${JSON.stringify(colStr)}`
            );
        }
        if (row < 0 || col < 0) {
            throw new SimulatorError(
                `Line ${i + 1}: row and col must be non-negative, got (${row}, ${col})`
            );
        }
        if (grid.namedPositions.has(label)) {
            throw new SimulatorError(`Line ${i + 1}: duplicate position label ${JSON.stringify(label)}`);
        }
        grid.namedPositions.set(label, [row, col]);
    }

    return grid;
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

export class Simulator {
    rules: Rule[];
    grid: Grid;
    state: string;
    steps: number;
    heads: [number, number][];
    private maxSteps: number;

    constructor(rules: Rule[], grid: Grid, headsStr: string, maxSteps = MAX_STEPS) {
        this.rules = rules;
        this.grid = grid;
        this.state = 'START';
        this.steps = 0;
        this.heads = [];
        this.maxSteps = maxSteps;

        for (const ch of headsStr) {
            const pos = grid.namedPositions.get(ch);
            if (!pos) {
                throw new SimulatorError(
                    `Head start label ${JSON.stringify(ch)} not found in grid named positions`
                );
            }
            this.heads.push([pos[0], pos[1]]);
        }
    }

    findRule(): Rule {
        const cellValues = this.heads.map(([r, c]) => this.grid.get(r, c));

        const matching = this.rules.filter(rule => {
            if (rule.state !== this.state) { return false; }
            return rule.reads.every((pattern, i) => matchPattern(pattern, cellValues[i]));
        });

        if (matching.length === 0) {
            throw new SimulatorError(
                `No matching rule for state=${JSON.stringify(this.state)}, ` +
                `head values=${JSON.stringify(cellValues)} at step ${this.steps}`
            );
        }
        if (matching.length > 1) {
            throw new SimulatorError(
                `Ambiguous program: ${matching.length} rules match ` +
                `state=${JSON.stringify(this.state)}, head values=${JSON.stringify(cellValues)} ` +
                `at step ${this.steps}`
            );
        }
        return matching[0];
    }

    step(): void {
        const rule = this.findRule();

        // Apply writes to all head cells
        for (let i = 0; i < this.heads.length; i++) {
            const [r, c] = this.heads[i];
            this.grid.set(r, c, applyWrite(rule.writes[i], this.grid.get(r, c)));
        }

        // Move all heads
        const newHeads: [number, number][] = [];
        for (let i = 0; i < this.heads.length; i++) {
            const [r, c] = this.heads[i];
            const [dr, dc] = MOVE_DELTAS[rule.moves[i]];
            newHeads.push([r + dr, c + dc]);
        }
        this.heads = newHeads;

        // Transition state
        this.state = rule.nextState;
        this.steps++;
    }

    run(): void {
        while (this.state !== 'STOP') {
            if (this.steps >= this.maxSteps) {
                throw new SimulatorError(
                    `Step limit of ${this.maxSteps} exceeded without reaching STOP`
                );
            }
            this.step();
        }
    }
}
