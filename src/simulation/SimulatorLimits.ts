export default class SimulatorLimits {
    private _maxHeads: number;
    private _maxStates: number;
    private _maxRules: number;
    private _maxSteps: number;
    private _maxProgramBytes: number;

    private constructor(maxHeads: number, maxStates: number, maxRules: number, maxSteps: number, maxProgramBytes: number) {
        this._maxHeads = maxHeads;
        this._maxStates = maxStates;
        this._maxRules = maxRules;
        this._maxSteps = maxSteps;
        this._maxProgramBytes = maxProgramBytes;
    }

    public static fromSettings(maxHeads?: number, maxStates?: number, maxRules?: number, maxSteps?: number, maxProgramBytes?: number): SimulatorLimits {
        return new SimulatorLimits(
            maxHeads ?? 10,
            maxStates ?? 100,
            maxRules ?? 1000,
            maxSteps ?? 100000,
            maxProgramBytes ?? 1000000
        );
    }

    public get maxHeads(): number {
        return this._maxHeads;
    }

    public get maxStates(): number {
        return this._maxStates;
    }

    public get maxRules(): number {
        return this._maxRules;
    }

    public get maxSteps(): number {
        return this._maxSteps;
    }

    public get maxProgramBytes(): number {
        return this._maxProgramBytes;
    }
}