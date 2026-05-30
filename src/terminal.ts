import * as vscode from 'vscode';

// ANSI colour constants
export const GREY = '\x1b[90m';
export const GREEN = '\x1b[32m';
export const RED = '\x1b[31m';
export const RESET = '\x1b[0m';
export const CLEAR = '\x1b[2J\x1b[H';

let _writeEmitter: vscode.EventEmitter<string> | undefined;
let _terminal: vscode.Terminal | undefined;
let _terminalReady: Promise<void> | undefined;

/** Write a line to the GridOS PTY terminal. Safe to call before the terminal is shown. */
export function writeln(text: string): void {
    _writeEmitter?.fire(text.replace(/\n/g, '\r\n') + '\r\n');
}

/** Clear the GridOS PTY terminal screen and hide the cursor. */
export function clearTerminal(): void {
    _writeEmitter?.fire(CLEAR + '\x1b[?25l'); // clear + hide cursor
}

/**
 * Ensure the GridOS terminal exists and is visible.
 * Waits until the PTY is fully open before returning.
 */
export async function showTerminal(): Promise<void> {
    _ensureCreated();
    _terminal!.show(false);   // false = don't steal focus
    await _terminalReady;
}

function _ensureCreated(): void {
    // Reuse an existing GridOS terminal tab if it is still open
    const existing = vscode.window.terminals.find(t => t.name === 'GridOS');
    if (existing && _writeEmitter && _terminalReady) {
        _terminal = existing;
        return;
    }

    _writeEmitter = new vscode.EventEmitter<string>();
    let resolveReady!: () => void;
    _terminalReady = new Promise<void>(resolve => { resolveReady = resolve; });

    const pty: vscode.Pseudoterminal = {
        onDidWrite: _writeEmitter.event,
        open: () => { resolveReady(); },
        close: () => {
            _terminal = undefined;
            _writeEmitter = undefined;
            _terminalReady = undefined;
        },
    };
    _terminal = vscode.window.createTerminal({ name: 'GridOS', pty });
}
