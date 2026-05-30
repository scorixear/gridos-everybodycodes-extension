import * as vscode from 'vscode';

// U D L R S are all valid move directions (S = Stay)
const VALID_MOVE_CHARS = new Set(['U', 'D', 'L', 'R', 'S']);

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

interface TokenInfo {
    raw: string;    // literal text in source (may contain lone / separators)
    value: string;  // raw with lone / removed (matches simulator parser)
    start: number;  // start column (inclusive)
    end: number;    // end column (exclusive)
}

function tokenizeLine(lineText: string): TokenInfo[] {
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

/**
 * Returns the source column for each non-'/' character in the token's raw text.
 * Used to locate individual move characters precisely.
 */
function charColumnsInToken(token: TokenInfo): number[] {
    const cols: number[] = [];
    for (let i = 0; i < token.raw.length; i++) {
        if (token.raw[i] !== '/') { cols.push(token.start + i); }
    }
    return cols;
}

// ---------------------------------------------------------------------------
// Public validator
// ---------------------------------------------------------------------------

export function validateGridec(doc: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    let headCount = -1;       // -1 = HEADS not yet seen
    let headsLineIndex = -1;

    for (let li = 0; li < doc.lineCount; li++) {
        const fullText = doc.lineAt(li).text;

        // Strip // comments
        const commentIdx = fullText.indexOf('//');
        const lineText = commentIdx !== -1 ? fullText.slice(0, commentIdx) : fullText;

        const tokens = tokenizeLine(lineText);
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
            const cols = charColumnsInToken(moveTok);
            for (let i = 0; i < moveTok.value.length; i++) {
                const ch = moveTok.value[i];
                if (!VALID_MOVE_CHARS.has(ch)) {
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
