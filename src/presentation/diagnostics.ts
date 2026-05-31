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
                const [headsCount, headsLine] = this._checkHeads(diagnostics, headsLineIndex, li, tokens);
                if (headsCount !== null) { headCount = headsCount; }
                if (headsLine !== null) { headsLineIndex = headsLine; }
                continue;
            }

            // ---- Rule line ----------------------------------------------------

            if (!this._hasHeads(diagnostics, headCount, tokens, li)) continue;

            this._flagExtraTokens(diagnostics, li, tokens)

            if (tokens.length < 5) { continue; }  // too few tokens — runtime will catch it

            // STATE (index 0) and READ (index 1): Rule must be unique
            this._flagRuleOverlap(diagnostics, previousLines, linesWithOverlaps, li, tokens);
            // READ (index 1) and WRITE (index 3): length must equal headCount
            this._flagReadWriteHeadMisMatch(diagnostics, headCount, li, tokens);
            // MOVE (index 4): length must equal headCount, and each char must be valid
            this._flagMoveHeadMisMatch(diagnostics, headCount, li, tokens);
        }

        return diagnostics;
    }

    private static _checkHeads(diagnostics: vscode.Diagnostic[], headsLineIndex: number, lineIndex: number, lineTokens: TokenInfo[]): [number | null, number | null] {
        if (headsLineIndex !== -1) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, lineTokens[0].start, lineIndex, lineTokens[0].end),
                'Duplicate HEADS declaration',
                vscode.DiagnosticSeverity.Error,
            ));
            return [null, null];
        }

        if (lineTokens.length < 2) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, lineTokens[0].start, lineIndex, lineTokens[0].end),
                'HEADS requires an argument',
                vscode.DiagnosticSeverity.Error,
            ));
            return [null, lineIndex];
        }

        const headCount = lineTokens[1].value.length;

        if (headCount === 0) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, lineTokens[1].start, lineIndex, lineTokens[1].end),
                'HEADS argument is empty',
                vscode.DiagnosticSeverity.Error,
            ));
            return [headCount, lineIndex];
        }
        // Extra tokens after HEADS <arg>
        for (let t = 2; t < lineTokens.length; t++) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, lineTokens[t].start, lineIndex, lineTokens[t].end),
                'Unexpected token after HEADS argument',
                vscode.DiagnosticSeverity.Error,
            ));
        }
        return [headCount, lineIndex];
    }

    private static _hasHeads(diagnostics: vscode.Diagnostic[], headCount: number, tokens: TokenInfo[], lineIndex: number): boolean {
        if (headCount === -1) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, tokens[0].start, lineIndex, tokens[tokens.length - 1].end),
                'Rule encountered before HEADS declaration',
                vscode.DiagnosticSeverity.Error,
            ));
            return false;
        }
        return true;
    }

    private static _flagExtraTokens(diagnostics: vscode.Diagnostic[], lineIndex: number, tokens: TokenInfo[]): void {
        if (tokens.length > 5) {
            for (let t = 5; t < tokens.length; t++) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(lineIndex, tokens[t].start, lineIndex, tokens[t].end),
                    'Unexpected token: a rule has exactly 5 fields (STATE  READ  NEXT-STATE  WRITE  MOVE)',
                    vscode.DiagnosticSeverity.Error,
                ));
            }
        }
    }

    private static _flagRuleOverlap(diagnostics: vscode.Diagnostic[], previousLines: [string, string, number][], linesWithOverlaps: Set<number>, lineIndex: number, tokens: TokenInfo[]): void {
        const overlapData = previousLines.filter(([state, read]) => state === tokens[0].value && this._doRulesOverlap(read, tokens[1].value)); // Check through previous lines
        previousLines.push([tokens[0].value, tokens[1].value, lineIndex]); // Now that the checking has been done, push the line into the previousLines list
        if (overlapData.length > 0) { // If there is an overlap
            diagnostics.push(
                new vscode.Diagnostic(
                    new vscode.Range(lineIndex, 0, lineIndex, tokens[1].end),
                    `READ overlaps with another READ in ${tokens[0].value}.`,
                    vscode.DiagnosticSeverity.Error
                )
            );

            linesWithOverlaps.add(lineIndex); // Vscode can put more than one error of the same type on each line, this stops that.

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
    }

    private static _flagReadWriteHeadMisMatch(diagnostics: vscode.Diagnostic[], headCount: number, lineIndex: number, tokens: TokenInfo[]): void {
        for (const idx of [1, 3] as const) {
            const tok = tokens[idx];
            if (tok.value.length !== headCount) {
                const label = idx === 1 ? 'READ' : 'WRITE';
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(lineIndex, tok.start, lineIndex, tok.end),
                    `${label} must have exactly ${headCount} symbol(s) (one per head), got ${tok.value.length}`,
                    vscode.DiagnosticSeverity.Error,
                ));
            }
        }
    }

    private static _flagMoveHeadMisMatch(diagnostics: vscode.Diagnostic[], headCount: number, lineIndex: number, tokens: TokenInfo[]): void {
        const moveTok = tokens[4];
        if (moveTok.value.length !== headCount) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(lineIndex, moveTok.start, lineIndex, moveTok.end),
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
                        new vscode.Range(lineIndex, cols[i], lineIndex, cols[i] + 1),
                        `Invalid MOVE character '${ch}': must be one of U, D, L, R, S`,
                        vscode.DiagnosticSeverity.Error,
                    ));
                }
            }
        }
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
