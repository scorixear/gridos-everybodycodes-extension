import Moves from "./Moves";
import Rule from "./Rule";
import SimulatorError from "./SimulatorError";
import SimulatorLimits from "./SimulatorLimits";

export default class Rules {
    private _rules: Rule[];
    private _heads: string;

    private constructor(rules: Rule[], heads: string) {
        this._rules = rules;
        this._heads = heads;
    }

    public static fromText(text: string, limits: SimulatorLimits): Rules {
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const bytes = new TextEncoder().encode(text).length;
        if (bytes > limits.maxProgramBytes) throw new SimulatorError(`Program exceeds maximum size of ${limits.maxProgramBytes} bytes`);

        let heads: string | null = null;
        const rules: Rule[] = [];
        const stateNames = new Set<string>();
        const rawLines = text.split('\n');

        for (let idx = 0; idx < rawLines.length; idx++) {
            const lineNumber = idx + 1;
            let line = rawLines[idx];

            const commentIdx = line.indexOf('//');
            if (commentIdx !== -1) line = line.slice(0, commentIdx);

            line = line.replace(/\//g, '');
            line = line.trim();
            if (!line) continue;

            const tokens = line.split(/\s+/);

            if (tokens[0] === 'HEADS') {
                if (heads !== null) throw new SimulatorError(`Line ${lineNumber}: duplicate HEADS command`);
                if (tokens.length !== 2) throw new SimulatorError(`Line ${lineNumber}: HEADS requires exactly one argument`);
                heads = tokens[1];
                if (heads.length === 0) throw new SimulatorError(`Line ${lineNumber}: HEADS argument cannot be empty`);
                if (heads.length > limits.maxHeads) throw new SimulatorError(`Line ${lineNumber}: number of heads exceeds limit of ${limits.maxHeads}`);
                continue;
            }

            if (heads === null) throw new SimulatorError(`Line ${lineNumber}: rule encountered before HEADS command`);
            if (tokens.length !== 5) throw new SimulatorError(`Line ${lineNumber}: expected 5 tokens in rule, got ${tokens.length}: ${JSON.stringify(line)}`);

            const n = heads.length;
            const [stateToken, readToken, nextStateToken, writeToken, moveToken] = tokens;

            for (const [tokName, tokValue] of [['READ', readToken], ['WRITE', writeToken], ['MOVE', moveToken]] as [string, string][]) {
                if (tokValue.length !== n) {
                    throw new SimulatorError(`Line ${lineNumber}: ${tokName} token ${JSON.stringify(tokValue)} has length ${tokValue.length}, expected ${n} (number of heads)`);
                }
            }

            const validMoves = new Set(Object.keys(Moves));
            for (const char of moveToken) {
                if (!validMoves.has(char)) throw new SimulatorError(`Line ${lineNumber}: invalid MOVE character ${JSON.stringify(char)}; must be one of ${[...validMoves].sort().join(', ')}`);
            }

            rules.push(Rule.fromTokens(stateToken, readToken, nextStateToken, writeToken, moveToken, lineNumber));
            stateNames.add(stateToken);
            stateNames.add(nextStateToken);
        }

        if (rules.length > limits.maxRules) throw new SimulatorError(`Too many rules (${rules.length}), maximum is ${limits.maxRules}`);
        if (stateNames.size > limits.maxStates) throw new SimulatorError(`Too many states (${stateNames.size}), maximum is ${limits.maxStates}`);

        return new Rules(rules, heads!);
    }

    public get rules(): Rule[] {
        return this._rules;
    }

    public get heads(): string {
        return this._heads;
    }

    public isRuleLine(lineNumber: number): boolean {
        return this._rules.some(r => r.lineNumber === lineNumber);
    }

    public matchingRules(cellValues: string[], state: string): Rule[] {
        return this._rules.filter(rule => rule.matches(cellValues, state));
    }
}