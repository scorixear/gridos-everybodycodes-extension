import * as vscode from 'vscode';

export interface DiagnosticError {
    message: string;
    severity: vscode.DiagnosticSeverity;
    range: vscode.Range;
}