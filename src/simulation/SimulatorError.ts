export default class SimulatorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SimulatorError';
    }
}