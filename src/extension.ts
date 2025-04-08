import * as vscode from 'vscode';
import { DatabaseProvider } from './providers/databaseProvider';
import { DatabaseViewerPanel } from './panels/databaseViewerPanel';

/**
 * Custom editor provider for SQLite database files
 */
class SQLiteEditorProvider implements vscode.CustomEditorProvider {    
    // Event emitter for document changes (required by the interface)
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
    constructor(private context: vscode.ExtensionContext, private dbProvider: DatabaseProvider) {}

    // Track open documents
    private readonly documents = new Map<string, vscode.CustomDocument>();

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        const key = uri.toString();
        if (this.documents.has(key)) {
            return this.documents.get(key)!;
        }

        const document: vscode.CustomDocument = {
            uri,
            dispose: () => {
                this.documents.delete(key);
            }
        };
        this.documents.set(key, document);
        return document;
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            console.log(`Resolving custom editor for ${document.uri.fsPath}`);
            
            // Open the database viewer with the file URI
            DatabaseViewerPanel.createOrShow(this.context, document.uri, this.dbProvider);
            
            // Show a notification to confirm the database is being opened
            vscode.window.showInformationMessage(`Opening SQLite database: ${document.uri.fsPath}`);
            
            // Close the custom editor webview since we're using our own panel
            webviewPanel.dispose();
        } catch (error) {
            console.error('Error opening database:', error);
            vscode.window.showErrorMessage(`Failed to open SQLite database: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Required for CustomEditorProvider interface
    saveCustomDocument(document: vscode.CustomDocument): Thenable<void> {
        return Promise.resolve();
    }

    saveCustomDocumentAs(document: vscode.CustomDocument, destination: vscode.Uri): Thenable<void> {
        return Promise.resolve();
    }

    revertCustomDocument(document: vscode.CustomDocument): Thenable<void> {
        return Promise.resolve();
    }

    backupCustomDocument(document: vscode.CustomDocument, context: vscode.CustomDocumentBackupContext): Thenable<vscode.CustomDocumentBackup> {
        return Promise.resolve({
            id: context.destination.toString(),
            delete: () => {}
        });
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('SQLite Viewer Pro is now active!');

    // Initialize database provider
    const databaseProvider = new DatabaseProvider();
    
    // Register custom editor provider
    const sqliteEditorProvider = vscode.window.registerCustomEditorProvider(
        'sqlite-viewer-pro.editor',
        new SQLiteEditorProvider(context, databaseProvider),
        {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }
    );
    
    // Register file system watcher for .db files
    const dbFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{db,sqlite,sqlite3}');
    
    // When a db file is created or changed, try to refresh the current panel if it's the same file
    dbFileWatcher.onDidCreate(uri => {
        if (DatabaseViewerPanel.currentPanel && DatabaseViewerPanel.currentPanel.getDbPath() === uri.fsPath) {
            DatabaseViewerPanel.currentPanel.refresh();
        }
    });
    
    dbFileWatcher.onDidChange(uri => {
        if (DatabaseViewerPanel.currentPanel && DatabaseViewerPanel.currentPanel.getDbPath() === uri.fsPath) {
            DatabaseViewerPanel.currentPanel.refresh();
        }
    });
    context.subscriptions.push(sqliteEditorProvider);

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