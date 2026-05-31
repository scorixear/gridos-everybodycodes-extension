import Grid from "./Grid";
import Moves from "./Moves";
import Rule from "./Rule";
import Rules from "./Rules";
import SimulatorError from "./SimulatorError";
import SimulatorLimits from "./SimulatorLimits";

export default class Simulator {
    private _rules: Rules;
    private _grid: Grid;
    private _state: string;
    private _steps: number;
    private _heads: [number, number][];
    private _maxSteps: number;

    private constructor(rules: Rules, grid: Grid, state: string, heads: [number, number][], maxSteps: number) {
        this._rules = rules;
        this._grid = grid;
        this._state = state;
        this._heads = heads;
        this._steps = 0;
        this._maxSteps = maxSteps;
    }

    public static fromRulesAndGrid(rules: Rules, grid: Grid, limits: SimulatorLimits): Simulator {
        const heads: [number, number][] = [];
        for (const char of rules.heads) {
            const pos = grid.namedPositions.get(char);
            if (!pos) throw new SimulatorError(`Head start label ${JSON.stringify(char)} not found in grid named positions`);
            heads.push([pos[0], pos[1]]);
        }
        return new Simulator(rules, grid, 'START', heads, limits.maxSteps);
    }

    public get state(): string {
        return this._state;
    }

    public get steps(): number {
        return this._steps;
    }

    public get heads(): [number, number][] {
        return this._heads;
    }

    public get grid(): Grid {
        return this._grid;
    }

    public get rules(): Rules {
        return this._rules;
    }

    public step(): void {
        if (this._steps >= this._maxSteps) {
            throw new SimulatorError(`Step limit of ${this._maxSteps} exceeded without reaching STOP`);
        }
        const rule = this.findRule();

        for (let i = 0; i < this._heads.length; i++) {
            const [row, col] = this._heads[i];
            this._grid.write(row, col, rule.writes[i]);
        }

        const newHeads: [number, number][] = [];
        for (let i = 0; i < this._heads.length; i++) {
            const [row, col] = this._heads[i];
            const [dr, dc] = Moves[rule.moves[i]];
            newHeads.push([row + dr, col + dc]);
        }
        this._heads = newHeads;

        this._state = rule.nextState;
        this._steps++;
    }

    public run(): void {
        while (this._state !== 'STOP') {
            this.step();
        }
    }

    public findRule(): Rule {
        const cellValues = this._heads.map(([row, col]) => this._grid.get(row, col));
        const matching = this._rules.matchingRules(cellValues, this._state);

        if (matching.length === 0) {
            throw new SimulatorError(
                `No matching rule for state=${JSON.stringify(this._state)}, ` +
                `head values=${JSON.stringify(cellValues)} at step ${this._steps}`
            );
        }

        if (matching.length > 1) {
            throw new SimulatorError(
                `Ambiguous program: ${matching.length} rules match ` +
                `state=${JSON.stringify(this._state)}, head values=${JSON.stringify(cellValues)} ` +
                `at step ${this._steps}`
            );
        }

        return matching[0];
    }
}