export default class Rule {
    private _state: string;
    private _reads: string[];
    private _nextState: string;
    private _writes: string[];
    private _moves: string[];
    private _lineNumber: number;

    private constructor(state: string, reads: string[], nextState: string, writes: string[], moves: string[], lineNumber: number) {
        this._state = state;
        this._reads = reads;
        this._nextState = nextState;
        this._writes = writes;
        this._moves = moves;
        this._lineNumber = lineNumber;
    }

    public static fromTokens(stateToken: string, readToken: string, nextStateToken: string, writeToken: string, moveToken: string, lineNumber: number): Rule {
        return new Rule(
            stateToken,
            [...readToken],
            nextStateToken,
            [...writeToken],
            [...moveToken],
            lineNumber
        );
    }

    public get state(): string {
        return this._state;
    }

    public get reads(): string[] {
        return this._reads;
    }

    public get nextState(): string {
        return this._nextState;
    }

    public get writes(): string[] {
        return this._writes;
    }

    public get moves(): string[] {
        return this._moves;
    }

    public get lineNumber(): number {
        return this._lineNumber;
    }

    public matches(cellValues: string[], state: string): boolean {
        if (this._state !== state) return false;
        return this._reads.every((pattern, idx) => Rule.matchPattern(pattern, cellValues[idx]));
    }

    private static matchPattern(pattern: string, value: string): boolean {
        if (pattern === '*') return true;
        if (pattern === '_') return value === ' ';
        if (pattern === '!') return value !== ' ';
        return pattern === value;
    }
}