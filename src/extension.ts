import * as vscode from 'vscode';
import { DatabaseProvider } from './providers/databaseProvider';
import { DatabaseViewerPanel } from './panels/databaseViewerPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('SQLite Viewer Pro is now active!');

    // Initialize database provider
    const databaseProvider = new DatabaseProvider();

    // Register commands
    let openDatabaseCmd = vscode.commands.registerCommand('sqlite-viewer-pro.openDatabase', async (fileUri?: vscode.Uri) => {
        try {
            // If no URI provided (command palette activation), show file picker
            if (!fileUri) {
                const files = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'SQLite Databases': ['db', 'sqlite', 'sqlite3']
                    },
                    title: 'Open SQLite Database'
                });
                
                if (!files || files.length === 0) {
                    return;
                }
                
                fileUri = files[0];
            }
            
            // Open the database viewer
            DatabaseViewerPanel.createOrShow(context, fileUri, databaseProvider);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open SQLite database: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    let refreshConnectionCmd = vscode.commands.registerCommand('sqlite-viewer-pro.refreshConnection', () => {
        if (DatabaseViewerPanel.currentPanel) {
            DatabaseViewerPanel.currentPanel.refresh();
        } else {
            vscode.window.showInformationMessage('No active SQLite database connection to refresh.');
        }
    });

    // Add to subscriptions
    context.subscriptions.push(openDatabaseCmd);
    context.subscriptions.push(refreshConnectionCmd);
    context.subscriptions.push(databaseProvider);
}

export function deactivate() {
    // Clean up resources
}