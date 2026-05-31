import SimulatorError from "./SimulatorError";

export default class Grid {

    private _cells: Map<string, string>;
    private _namedPositions: Map<string, [number, number]>;

    private constructor() {
        this._cells = new Map<string, string>();
        this._namedPositions = new Map<string, [number, number]>();
    }

    public static fromText(text: string): Grid {
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

        if (gridKwLine === null) {
            throw new SimulatorError('Grid file is missing the GRID keyword');
        }
        if (posKwLine === null) {
            throw new SimulatorError('Grid file is missing the POSITIONS keyword');
        }
        if (posKwLine <= gridKwLine) {
            throw new SimulatorError('POSITIONS section must come after GRID section');
        }

        const gridLines = lines.slice(gridKwLine + 1, posKwLine);

        const activeCols = new Set<number>();
        let firstContent: number | null = null;
        let lastContent: number | null = null;

        for (let i = 0; i < gridLines.length; i++) {
            const line = gridLines[i];
            for (let col = 0; col < line.length; col++) {
                if (line[col] !== ' ') {
                    activeCols.add(col);
                }
            }
            if (line.split('').some(char => char !== ' ')) {
                if (firstContent === null) firstContent = i;
                lastContent = i;
            }

        }

        const grid = new Grid();

        if (firstContent !== null && activeCols.size > 0) {
            for (let row = firstContent; row <= lastContent!; row++) {
                const line = gridLines[row];
                for (const col of activeCols) {
                    const char = col < line.length ? line[col] : ' ';
                    grid._set(row, col, char);
                }
            }
        }

        for (let i = posKwLine + 1; i < lines.length; i++) {
            const rawLine = lines[i].trim();
            if (!rawLine) continue;

            const parts = rawLine.split(/\s+/);
            if (parts.length !== 3) throw new SimulatorError(`Line ${i + 1}: POSITIONS entry must be '<label> <row> <col>', got: ${JSON.stringify(rawLine)}`);

            const [label, rowStr, colStr] = parts;
            if (label.length !== 1) throw new SimulatorError(`Line ${i + 1}: position label must be a single character, got ${JSON.stringify(label)}`);

            const row = parseInt(rowStr, 10);
            const col = parseInt(colStr, 10);

            if (isNaN(row) || isNaN(col)) throw new SimulatorError(`Line ${i + 1}: row and col must be integers, got ${JSON.stringify(rowStr)} and ${JSON.stringify(colStr)}`);
            if (row < 0 || col < 0) throw new SimulatorError(`Line ${i + 1}: row and col must be non-negative, got (${row}, ${col})`);
            if (grid._namedPositions.has(label)) throw new SimulatorError(`Line ${i + 1}: duplicate position label ${JSON.stringify(label)}`);

            grid._namedPositions.set(label, [row, col]);
        }

        return grid;
    }

    public get namedPositions(): Map<string, [number, number]> {
        return this._namedPositions;
    }

    public toAscii(): string {
        if (this._cells.size === 0) return '(empty grid)';


        let minRow = Infinity, maxRow = -Infinity;
        let minCol = Infinity, maxCol = -Infinity;

        for (const key of this._cells.keys()) {
            const comma = key.indexOf(',');
            const row = Number(key.slice(0, comma));
            const col = Number(key.slice(comma + 1));

            if (row < minRow) minRow = row;
            if (row > maxRow) maxRow = row;
            if (col < minCol) minCol = col;
            if (col > maxCol) maxCol = col;
        }

        const lines: string[] = [];
        for (let row = minRow; row <= maxRow; row++) {
            let line = '';
            for (let col = minCol; col <= maxCol; col++) {
                line += this.get(row, col);
            }
            lines.push(line);
        }
        return lines.join('\n');
    }

    public toAsciiWithHeads(heads: [number, number][]): string {
        if (this._cells.size === 0) return '(empty grid)';

        let minRow = Infinity, maxRow = -Infinity;
        let minCol = Infinity, maxCol = -Infinity;

        for (const key of this._cells.keys()) {
            const comma = key.indexOf(',');
            const row = Number(key.slice(0, comma));
            const col = Number(key.slice(comma + 1));

            if (row < minRow) minRow = row;
            if (row > maxRow) maxRow = row;
            if (col < minCol) minCol = col;
            if (col > maxCol) maxCol = col;
        }

        const headCount = new Map<string, number>();
        for (const [row, col] of heads) {
            if (row < minRow) minRow = row;
            if (row > maxRow) maxRow = row;
            if (col < minCol) minCol = col;
            if (col > maxCol) maxCol = col;

            const key = this._key(row, col);
            headCount.set(key, (headCount.get(key) ?? 0) + 1);
        }

        const BOLD_YELLOW = '\x1b[1:33m';
        const BOLD_RED = '\x1b[1:31m';
        const RESET = '\x1b[0m';

        const lines: string[] = [];
        for (let row = minRow; row <= maxRow; row++) {
            let line = '';
            for (let col = minCol; col <= maxCol; col++) {
                const char = this.get(row, col) ?? ' ';
                const count = headCount.get(this._key(row, col)) ?? 0;
                if (count >= 2) {
                    line += BOLD_RED + (char == ' ' ? '█' : char) + RESET;
                } else if (count === 1) {
                    line += BOLD_YELLOW + (char == ' ' ? '█' : char) + RESET;
                } else {
                    line += char;
                }
            }
            lines.push(line);
        }
        return lines.join('\n');
    }

    public get(row: number, col: number): string {
        return this._cells.get(this._key(row, col)) ?? ' ';
    }

    public write(row: number, col: number, value: string) {
        let currValue = this.get(row, col);
        let newValue = value;
        if (value === '*') newValue = currValue;
        if (value === '_') newValue = ' ';
        this._set(row, col, newValue);
    }

    private _key(row: number, col: number): string {
        return `${row},${col}`;
    }

    private _set(row: number, col: number, value: string): void {
        this._cells.set(this._key(row, col), value);
    }
}