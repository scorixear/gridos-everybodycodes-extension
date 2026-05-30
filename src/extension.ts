import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseProgram, loadGrid, Simulator, SimulatorError, DEFAULT_LIMITS } from './simulator';
import { GridDebugAdapter } from './gridDebugAdapter';
import { writeln, clearTerminal, showTerminal, GREY, GREEN, RED, RESET } from './terminal';
import { validateGridec } from './diagnostics';

function getLimits() {
    const cfg = vscode.workspace.getConfiguration('gridec');
    return {
        maxHeads: cfg.get('maxHeads', DEFAULT_LIMITS.maxHeads),
        maxStates: cfg.get('maxStates', DEFAULT_LIMITS.maxStates),
        maxRules: cfg.get('maxRules', DEFAULT_LIMITS.maxRules),
        maxSteps: cfg.get('maxSteps', DEFAULT_LIMITS.maxSteps),
        maxProgramBytes: cfg.get('maxProgramBytes', DEFAULT_LIMITS.maxProgramBytes),
    } as typeof DEFAULT_LIMITS;
}

export function activate(context: vscode.ExtensionContext): void {

    // Restore the last-used mode (run / debug) and publish it as a context key
    // so the editor/title menu can show the right icon.
    const savedMode = context.workspaceState.get<string>('gridec.mode', 'run');
    vscode.commands.executeCommand('setContext', 'gridec.mode', savedMode);

    // ---- Diagnostics (live error squiggles) --------------------------------
    const diagCollection = vscode.languages.createDiagnosticCollection('gridec');

    function refreshDiagnostics(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'gridec') { return; }
        diagCollection.set(doc.uri, validateGridec(doc));
    }

    // Validate all already-open gridec documents immediately
    for (const doc of vscode.workspace.textDocuments) { refreshDiagnostics(doc); }

    context.subscriptions.push(
        diagCollection,
        vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
        vscode.workspace.onDidChangeTextDocument(e => refreshDiagnostics(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => diagCollection.delete(doc.uri)),
    );

    // ---- Run command -------------------------------------------------------
    const runDisposable = vscode.commands.registerCommand('gridec.run', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }

        const doc = editor.document;
        if (!doc.fileName.endsWith('.gridec')) {
            vscode.window.showErrorMessage('Active file is not a .gridec file.');
            return;
        }

        await doc.save();

        const gridecPath = doc.fileName;
        const gridPath = gridecPath.slice(0, -'.gridec'.length) + '.grid';
        const gridecName = path.basename(gridecPath);

        await showTerminal();
        clearTerminal();

        writeln(`${GREY}Running ${gridecName} ...${RESET}`);
        writeln('');

        if (!fs.existsSync(gridPath)) {
            writeln(`${RED}Error: Grid file not found: ${gridPath}${RESET}`);
            return;
        }

        try {
            const programText = fs.readFileSync(gridecPath, 'utf8');
            const gridText = fs.readFileSync(gridPath, 'utf8');

            const limits = getLimits();
            const { headsStr, rules } = parseProgram(programText, limits);
            const grid = loadGrid(gridText);
            const sim = new Simulator(rules, grid, headsStr, limits.maxSteps);

            sim.run();

            writeln(grid.toAscii());
            writeln('');
            writeln(`${GREEN}Completed in ${sim.steps} step(s).${RESET}`);
        } catch (err) {
            if (err instanceof SimulatorError) {
                writeln(`${RED}Error: ${err.message}${RESET}`);
            } else {
                writeln(`${RED}Unexpected error: ${String(err)}${RESET}`);
            }
        }
    });

    // ---- Debug command -----------------------------------------------------
    const debugDisposable = vscode.commands.registerCommand('gridec.debug', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }
        const doc = editor.document;
        if (!doc.fileName.endsWith('.gridec')) {
            vscode.window.showErrorMessage('Active file is not a .gridec file.');
            return;
        }
        await doc.save();

        // Prepare the shared terminal BEFORE starting the session so the
        // debug adapter can write immediately when it receives the launch request.
        await showTerminal();
        clearTerminal();
        writeln(`${GREY}Debugging ${path.basename(doc.fileName)} ...${RESET}`);
        writeln('');

        await vscode.debug.startDebugging(undefined, {
            type: 'gridec',
            request: 'launch',
            name: 'GridOS Debug',
            program: doc.fileName,
        });
    });

    // Re-focus the GridOS terminal when a debug session starts.
    // VS Code automatically switches to the Debug Console on session start;
    // this listener fires after that switch and brings our terminal back.
    const sessionListener = vscode.debug.onDidStartDebugSession(session => {
        if (session.type === 'gridec') {
            showTerminal();
        }
    });

    // ---- Mode-select commands (used by the dropdown submenu) ---------------
    // These set the context key + persist the choice, then execute the action.
    const setRunDisposable = vscode.commands.registerCommand('gridec.setRun', async () => {
        await context.workspaceState.update('gridec.mode', 'run');
        await vscode.commands.executeCommand('setContext', 'gridec.mode', 'run');
        await vscode.commands.executeCommand('gridec.run');
    });

    const setDebugDisposable = vscode.commands.registerCommand('gridec.setDebug', async () => {
        await context.workspaceState.update('gridec.mode', 'debug');
        await vscode.commands.executeCommand('setContext', 'gridec.mode', 'debug');
        await vscode.commands.executeCommand('gridec.debug');
    });

    // ---- Debug adapter factory --------------------------------------------
    const factory = vscode.debug.registerDebugAdapterDescriptorFactory('gridec', {
        createDebugAdapterDescriptor: () =>
            new vscode.DebugAdapterInlineImplementation(new GridDebugAdapter()),
    });

    // ---- Debug config provider (enables F5 with no launch.json) -----------
    const provider = vscode.debug.registerDebugConfigurationProvider('gridec', {
        resolveDebugConfiguration(
            _folder: vscode.WorkspaceFolder | undefined,
            config: vscode.DebugConfiguration,
        ): vscode.DebugConfiguration {
            if (!config.program) {
                const editor = vscode.window.activeTextEditor;
                if (editor?.document.fileName.endsWith('.gridec')) {
                    config.program = editor.document.fileName;
                }
            }
            if (!config.type) { config.type = 'gridec'; }
            if (!config.request) { config.request = 'launch'; }
            if (!config.name) { config.name = 'GridOS Debug'; }
            return config;
        },
    });

    context.subscriptions.push(
        runDisposable, debugDisposable,
        setRunDisposable, setDebugDisposable,
        sessionListener,
        factory, provider,
    );
}

export function deactivate(): void { }

