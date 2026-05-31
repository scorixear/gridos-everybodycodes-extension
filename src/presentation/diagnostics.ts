import * as vscode from 'vscode';
import TokenInfo from './TokenInfo';
import Moves from '../simulation/Moves';

export class Diagnostics {
    public static validateGridec(doc: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        let headCount = -1;       // -1 = HEADS not yet seen
        let headsLineIndex = -1;
        let previousLines: [string, string, number][] = []; // [State, Read, LineNumber]
        let linesWithOverlaps = new Set<number>();

        for (let li = 0; li < doc.lineCount; li++) {
            const fullText = doc.lineAt(li).text;

            // Strip // comments
            const commentIdx = fullText.indexOf('//');
            const lineText = commentIdx !== -1 ? fullText.slice(0, commentIdx) : fullText;

            const tokens = this._tokenizeLine(lineText);
            if (tokens.length === 0) { continue; }

            // ---- HEADS line ---------------------------------------------------
            if (tokens[0].value === 'HEADS') {
                if (headsLineIndex !== -1) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(li, tokens[0].start, li, tokens[0].end),
                        'Duplicate HEADS declaration',
                        vscode.DiagnosticSeverity.Error,
                    ));
                    continue;
                }
                headsLineIndex = li;

                if (tokens.length < 2) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(li, tokens[0].start, li, tokens[0].end),
                        'HEADS requires exactly one argument',
                        vscode.DiagnosticSeverity.Error,
                    ));
                    continue;
                }

                headCount = tokens[1].value.length;

                if (headCount === 0) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(li, tokens[1].start, li, tokens[1].end),
                        'HEADS argument is empty',
                        vscode.DiagnosticSeverity.Error,
                    ));
                }

                // Extra tokens after HEADS <arg>
                for (let t = 2; t < tokens.length; t++) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(li, tokens[t].start, li, tokens[t].end),
                        'Unexpected token after HEADS argument',
                        vscode.DiagnosticSeverity.Error,
                    ));
                }
                continue;
            }

            // ---- Rule line ----------------------------------------------------

            if (headCount === -1) {
                // Non-blank, non-comment line before HEADS
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(li, tokens[0].start, li, tokens[tokens.length - 1].end),
                    'Rule encountered before HEADS declaration',
                    vscode.DiagnosticSeverity.Error,
                ));
                continue;
            }

            // Extra tokens at index 5+
            for (let t = 5; t < tokens.length; t++) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(li, tokens[t].start, li, tokens[t].end),
                    'Unexpected token: a rule has exactly 5 fields (STATE  READ  NEXT-STATE  WRITE  MOVE)',
                    vscode.DiagnosticSeverity.Error,
                ));
            }

            if (tokens.length < 5) { continue; }  // too few tokens — runtime will catch it

            // STATE (index 0) and READ (index 1): Rule must be unique
            const overlapData = previousLines.filter(([state, read]) => state === tokens[0].value && this._doRulesOverlap(read, tokens[1].value)); // Check through previous lines
            previousLines.push([tokens[0].value, tokens[1].value, li]); // Now that the checking has been done, push the line into the previousLines list
            if (overlapData.length > 0) { // If there is an overlap
                diagnostics.push(
                    new vscode.Diagnostic(
                        new vscode.Range(li, 0, li, tokens[1].end),
                        `READ overlaps with another READ in ${tokens[0].value}.`,
                        vscode.DiagnosticSeverity.Error
                    )
                );

                linesWithOverlaps.add(li); // Vscode can put more than one error of the same type on each line, this stops that.

                for (let [, , lineNumber] of overlapData) { // Highlight the previous lines which conflict
                    if (!linesWithOverlaps.has(lineNumber)) {
                        diagnostics.push(
                            new vscode.Diagnostic(
                                new vscode.Range(lineNumber, 0, lineNumber, tokens[1].end),
                                `READ overlaps with another READ in ${tokens[0].value}.`,
                                vscode.DiagnosticSeverity.Error
                            )
                        );
                    }
                }
            }

            // READ (index 1) and WRITE (index 3): length must equal headCount
            for (const idx of [1, 3] as const) {
                const tok = tokens[idx];
                if (tok.value.length !== headCount) {
                    const label = idx === 1 ? 'READ' : 'WRITE';
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(li, tok.start, li, tok.end),
                        `${label} must have exactly ${headCount} symbol(s) (one per head), got ${tok.value.length}`,
                        vscode.DiagnosticSeverity.Error,
                    ));
                }
            }

            // MOVE (index 4): length must equal headCount, and each char must be valid
            const moveTok = tokens[4];
            if (moveTok.value.length !== headCount) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(li, moveTok.start, li, moveTok.end),
                    `MOVE must have exactly ${headCount} symbol(s) (one per head), got ${moveTok.value.length}`,
                    vscode.DiagnosticSeverity.Error,
                ));
            } else {
                // Per-character validation (only when length is correct)
                const cols = this._charColumnsInToken(moveTok);
                const validMoves = new Set(Object.keys(Moves));
                for (let i = 0; i < moveTok.value.length; i++) {
                    const ch = moveTok.value[i];
                    if (!validMoves.has(ch)) {
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(li, cols[i], li, cols[i] + 1),
                            `Invalid MOVE character '${ch}': must be one of U, D, L, R, S`,
                            vscode.DiagnosticSeverity.Error,
                        ));
                    }
                }
            }
        }

        return diagnostics;
    }

    private static _tokenizeLine(lineText: string): TokenInfo[] {
        const tokens: TokenInfo[] = [];
        let i = 0;
        while (i < lineText.length) {
            if (lineText[i] === ' ' || lineText[i] === '\t') { i++; continue; }
            const start = i;
            while (i < lineText.length && lineText[i] !== ' ' && lineText[i] !== '\t') { i++; }
            const raw = lineText.slice(start, i);
            tokens.push({ raw, value: raw.replace(/\//g, ''), start, end: i });
        }
        return tokens;
    }

    private static _charColumnsInToken(token: TokenInfo): number[] {
        const cols: number[] = [];
        for (let i = 0; i < token.raw.length; i++) {
            if (token.raw[i] !== '/') { cols.push(token.start + i); }
        }
        return cols;
    }

    private static _doRulesOverlap(a: string, b: string): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!this._doCharactersOverlap(a[i], b[i])) return false;
        }
        return true;
    }

    private static _doCharactersOverlap(a: string, b: string): boolean {
        if (a === '*' || b === '*') return true;
        if (a === '!' && b !== '_') return true;
        if (b === '!' && a !== '_') return true;
        return a === b;
    }
}
