import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import Simulator from '../simulation/Simulation';
import Terminal from './terminal';
import SimulatorLimits from '../simulation/SimulatorLimits';
import Rules from '../simulation/Rules';
import Grid from '../simulation/Grid';
import SimulatorError from '../simulation/SimulatorError';

// ---------------------------------------------------------------------------
// Minimal DAP type helpers (avoids a runtime dependency on @vscode/debugadapter)
// ---------------------------------------------------------------------------

interface DapMessage { seq: number; type: string; }
interface DapRequest extends DapMessage { type: 'request'; command: string; arguments?: unknown; }
interface DapResponse extends DapMessage { type: 'response'; request_seq: number; success: boolean; command: string; body?: unknown; message?: string; }
interface DapEvent extends DapMessage { type: 'event'; event: string; body?: unknown; }
type Msg = DapRequest | DapResponse | DapEvent;

// ---------------------------------------------------------------------------
// GridDebugAdapter
// ---------------------------------------------------------------------------

export class GridDebugAdapter implements vscode.DebugAdapter {
    private _seq = 1;
    private _emitter = new vscode.EventEmitter<Msg>();
    readonly onDidSendMessage: vscode.Event<Msg> = this._emitter.event;

    // session state
    private sim: Simulator | undefined;
    private gridecPath = '';
    private breakpointLines = new Set<number>();
    private terminated = false;

    // ---------------------------------------------------------------------------
    // vscode.DebugAdapter entry point
    // ---------------------------------------------------------------------------

    public handleMessage(message: Msg): void {
        if (message.type === 'request') {
            this._handleRequest(message as DapRequest);
        }
    }

    public dispose(): void {
        this._emitter.dispose();
    }

    // ---------------------------------------------------------------------------
    // Request dispatch
    // ---------------------------------------------------------------------------

    private _handleRequest(req: DapRequest): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args: any = req.arguments ?? {};
        switch (req.command) {
            case 'initialize': this._initialize(req, args); break;
            case 'launch': this._launch(req, args); break;
            case 'setBreakpoints': this._setBreakpoints(req, args); break;
            case 'configurationDone': this._configurationDone(req); break;
            case 'threads': this._threads(req); break;
            case 'stackTrace': this._stackTrace(req); break;
            case 'scopes': this._scopes(req); break;
            case 'variables': this._variables(req); break;
            case 'continue': this._continue(req); break;
            case 'next': this._next(req); break;
            case 'stepIn': this._next(req); break;   // same as next for this runtime
            case 'stepOut': this._next(req); break;
            case 'disconnect':
            case 'terminate': this._disconnect(req); break;
            default: this._sendResponse(req, {}); break;
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private _sendResponse(req: DapRequest, body: unknown, success = true, message?: string): void {
        this._emitter.fire({
            seq: this._seq++,
            type: 'response',
            request_seq: req.seq,
            success,
            command: req.command,
            body: success ? body : undefined,
            message,
        } as DapResponse);
    }

    private _sendEvent(event: string, body?: unknown): void {
        this._emitter.fire({
            seq: this._seq++,
            type: 'event',
            event,
            body,
        } as DapEvent);
    }

    private _stop(reason: string): void {
        this._sendEvent('stopped', { reason, threadId: 1, allThreadsStopped: true });
        this._showGrid();
    }

    private _showGrid(): void {
        if (!this.sim) { return; }
        const state = this.sim.state;
        const step = this.sim.steps;
        const heads = this.sim.heads.map(([r, c]) => `(${r},${c})`).join(', ');
        const header = `── Step: ${step}  State: ${state}  Heads: [${heads}] ──`;

        // Write to the shared PTY terminal so the output persists after the session ends
        Terminal.clearTerminal();
        Terminal.writeln(header);
        Terminal.writeln('');
        Terminal.writeln(this.sim.grid.toAsciiWithHeads(this.sim.heads));
    }

    private _terminate(): void {
        if (this.terminated) { return; }
        this.terminated = true;
        this._sendEvent('terminated', {});
    }

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    private _initialize(req: DapRequest, _args: unknown): void {
        this._sendResponse(req, {
            supportsConfigurationDoneRequest: true,
            supportsFunctionBreakpoints: false,
            supportsStepInTargetsRequest: false,
        });
        this._sendEvent('initialized');
    }

    private static _getLimits() {
        const cfg = vscode.workspace.getConfiguration('gridec');
        return SimulatorLimits.fromSettings(
            cfg.get('maxHeads'),
            cfg.get('maxStates'),
            cfg.get('maxRules'),
            cfg.get('maxSteps'),
            cfg.get('maxProgramBytes')
        );
    }

    private _launch(req: DapRequest, args: { program: string }): void {
        this.gridecPath = args.program;
        const gridPath = this.gridecPath.slice(0, -'.gridec'.length) + '.grid';

        if (!fs.existsSync(this.gridecPath)) {
            this._sendResponse(req, {}, false, `File not found: ${this.gridecPath}`);
            this._terminate();
            return;
        }
        if (!fs.existsSync(gridPath)) {
            this._sendResponse(req, {}, false,
                `Grid file not found: ${gridPath}\nExpected a .grid file alongside the .gridec file.`);
            this._terminate();
            return;
        }

        try {
            const programText = fs.readFileSync(this.gridecPath, 'utf8');
            const gridText = fs.readFileSync(gridPath, 'utf8');
            const limits = GridDebugAdapter._getLimits();
            const rules = Rules.fromText(programText, limits);
            const grid = Grid.fromText(gridText);
            this.sim = Simulator.fromRulesAndGrid(rules, grid, limits);
            this._sendResponse(req, {});
        } catch (err) {
            const msg = err instanceof SimulatorError ? err.message : String(err);
            this._sendResponse(req, {}, false, msg);
            this._terminate();
        }
    }

    private _setBreakpoints(req: DapRequest, args: { source: { path?: string }; breakpoints?: { line: number }[] }): void {
        const requested = args.breakpoints ?? [];
        // Only manage breakpoints for our gridec file — ignore calls for other open files
        if (args.source?.path === this.gridecPath) {
            this.breakpointLines.clear();
            const verified = requested.map(bp => {
                const isRuleLine = this.sim?.rules.isRuleLine(bp.line) ?? false;
                if (isRuleLine) { this.breakpointLines.add(bp.line); }
                return { verified: isRuleLine, line: bp.line };
            });
            this._sendResponse(req, { breakpoints: verified });
        } else {
            // Unknown file — acknowledge without modifying our breakpoint state
            this._sendResponse(req, {
                breakpoints: requested.map(bp => ({ verified: false, line: bp.line })),
            });
        }
    }

    private _configurationDone(req: DapRequest): void {
        this._sendResponse(req, {});
        // Run immediately — only pause at explicit breakpoints
        this._runToBreakpointOrStop(false);
    }

    private _threads(req: DapRequest): void {
        this._sendResponse(req, { threads: [{ id: 1, name: 'GridOS Simulation' }] });
    }

    private _stackTrace(req: DapRequest): void {
        if (!this.sim) {
            this._sendResponse(req, { stackFrames: [], totalFrames: 0 });
            return;
        }
        if (this.sim.state === 'STOP') {
            this._sendResponse(req, {
                stackFrames: [{
                    id: 0, name: 'STOP',
                    source: { path: this.gridecPath },
                    line: 1, column: 1,
                }],
                totalFrames: 1,
            });
            return;
        }

        try {
            const rule = this.sim.findRule();
            this._sendResponse(req, {
                stackFrames: [{
                    id: 0,
                    name: `${rule.state} → ${rule.nextState}`,
                    source: { name: path.basename(this.gridecPath), path: this.gridecPath },
                    line: rule.lineNumber,
                    column: 1,
                }],
                totalFrames: 1,
            });
        } catch {
            this._sendResponse(req, { stackFrames: [], totalFrames: 0 });
        }
    }

    private _scopes(req: DapRequest): void {
        this._sendResponse(req, {
            scopes: [{
                name: 'Simulation',
                variablesReference: 1,
                expensive: false,
                presentationHint: 'locals',
            }],
        });
    }

    private _variables(req: DapRequest): void {
        if (!this.sim) {
            this._sendResponse(req, { variables: [] });
            return;
        }
        const headVars = this.sim.heads.map(([r, c], i) => {
            const ch = this.sim!.grid.get(r, c);
            return { name: `head${i}`, value: `(${r},${c})  reads '${ch}'`, variablesReference: 0, type: 'string' };
        });
        this._sendResponse(req, {
            variables: [
                { name: 'state', value: this.sim.state, variablesReference: 0, type: 'string' },
                { name: 'step', value: String(this.sim.steps), variablesReference: 0, type: 'number' },
                ...headVars,
            ],
        });
    }

    private _runToBreakpointOrStop(skipCurrentPosition: boolean): void {
        if (!this.sim) { this._terminate(); return; }
        try {
            if (skipCurrentPosition) {
                // Advance past the line we are currently paused on
                this.sim.step();
                if (this.sim.state === 'STOP') {
                    this._showGrid();
                    Terminal.writeln('');
                    Terminal.writeln(`${Terminal.GREEN}Completed in ${this.sim.steps} step(s).${Terminal.RESET}`);
                    this._terminate();
                    return;
                }
            }
            while (this.sim.state !== 'STOP') {
                if (this.breakpointLines.size > 0) {
                    const next = this.sim.findRule();
                    if (this.breakpointLines.has(next.lineNumber)) {
                        this._stop('breakpoint');
                        return;
                    }
                }
                this.sim.step();
            }
            this._showGrid();
            Terminal.writeln('');
            Terminal.writeln(`${Terminal.GREEN}Completed in ${this.sim.steps} step(s).${Terminal.RESET}`);
            this._terminate();
        } catch (err) {
            Terminal.writeln(`${Terminal.RED}Error: ${err instanceof SimulatorError ? err.message : String(err)}${Terminal.RESET}`);
            this._terminate();
        }
    }

    private _continue(req: DapRequest): void {
        this._sendResponse(req, { allThreadsContinued: true });
        if (!this.sim) { this._terminate(); return; }
        // skipCurrentPosition=true: advance past the line we're paused on before checking next breakpoint
        this._runToBreakpointOrStop(true);
    }

    private _next(req: DapRequest): void {
        this._sendResponse(req, {});
        if (!this.sim) { this._terminate(); return; }

        try {
            this.sim.step();
            if (this.sim.state === 'STOP') {
                this._showGrid();
                Terminal.writeln('');
                Terminal.writeln(`${Terminal.GREEN}Completed in ${this.sim.steps} step(s).${Terminal.RESET}`);
                this._terminate();
            } else {
                this._stop('step');
            }
        } catch (err) {
            Terminal.writeln(`${Terminal.RED}Error: ${err instanceof SimulatorError ? err.message : String(err)}${Terminal.RESET}`);
            this._terminate();
        }
    }

    private _disconnect(req: DapRequest): void {
        this._sendResponse(req, {});
        this._terminate();
    }
}
