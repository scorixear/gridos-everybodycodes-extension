import * as vscode from 'vscode';

export default class Terminal {
    private static _writeEmitter: vscode.EventEmitter<string> | undefined;
    private static _terminal: vscode.Terminal | undefined;
    private static _terminalReady: Promise<void> | undefined;

    public static get GREY(): string {
        return '\x1b[90m';
    }
    public static get GREEN(): string {
        return '\x1b[32m';
    }
    public static get RED(): string {
        return '\x1b[31m';
    }
    public static get RESET(): string {
        return '\x1b[0m';
    }
    public static get CLEAR(): string {
        return '\x1b[2J\x1b[H';
    }

    public static writeln(text: string): void {
        this._writeEmitter?.fire(text.replace(/\n/g, '\r\n') + '\r\n');
    }

    public static clearTerminal(): void {
        this._writeEmitter?.fire(Terminal.CLEAR + '\x1b[?25l'); // clear + hide cursor
    }

    public static async showTerminal(): Promise<void> {
        this._ensureCreated();
        this._terminal!.show(false);
        await this._terminalReady;
    }

    private static _ensureCreated(): void {
        // Reuse an existing GridOS terminal tab if it is still open
        const existing = vscode.window.terminals.find(t => t.name === 'GridOS');
        if (existing && this._writeEmitter && this._terminalReady) {
            this._terminal = existing;
            return;
        }

        this._writeEmitter = new vscode.EventEmitter<string>();
        let resolveReady!: () => void;
        this._terminalReady = new Promise<void>(resolve => { resolveReady = resolve; });

        const pty: vscode.Pseudoterminal = {
            onDidWrite: this._writeEmitter.event,
            open: () => { resolveReady(); },
            close: () => {
                this._terminal = undefined;
                this._writeEmitter = undefined;
                this._terminalReady = undefined;
            },
        };
        this._terminal = vscode.window.createTerminal({ name: 'GridOS', pty });
    }
}

