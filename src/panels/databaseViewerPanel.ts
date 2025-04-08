import * as vscode from 'vscode';
import * as path from 'path';
// Using dynamic import for sql-formatter as it's an ESM module
import { DatabaseProvider, QueryResult } from '../providers/databaseProvider';

export class DatabaseViewerPanel {
    public static currentPanel: DatabaseViewerPanel | undefined;
    

    private static readonly viewType = 'sqliteViewerPro';
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _dbPath: string;
    private readonly _dbProvider: DatabaseProvider;
    private _disposables: vscode.Disposable[] = [];
    
    /**
     * Get the database path for this panel
     */
    public getDbPath(): string {
        return this._dbPath;
    }

    public static createOrShow(context: vscode.ExtensionContext, dbUri: vscode.Uri, dbProvider: DatabaseProvider) {
        const dbPath = dbUri.fsPath;
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (DatabaseViewerPanel.currentPanel) {
            // If it's the same database, just reveal the panel
            if (DatabaseViewerPanel.currentPanel._dbPath === dbPath) {
                DatabaseViewerPanel.currentPanel._panel.reveal(column);
                return;
            }
            
            // Otherwise, dispose the existing panel and create a new one
            DatabaseViewerPanel.currentPanel.dispose();
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            DatabaseViewerPanel.viewType,
            `SQLite: ${path.basename(dbPath)}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media')
                ],
                retainContextWhenHidden: true
            }
        );

        DatabaseViewerPanel.currentPanel = new DatabaseViewerPanel(panel, context.extensionUri, dbPath, dbProvider);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, dbPath: string, dbProvider: DatabaseProvider) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._dbPath = dbPath;
        this._dbProvider = dbProvider;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    switch (message.command) {
                        case 'getTables':
                            const tables = await this._dbProvider.getTables(this._dbPath);
                            this._panel.webview.postMessage({ command: 'tablesLoaded', tables });
                            break;
                            
                        case 'getTableInfo':
                            const tableInfo = await this._dbProvider.getTableInfo(this._dbPath, message.tableName);
                            this._panel.webview.postMessage({ 
                                command: 'tableInfoLoaded', 
                                tableName: message.tableName,
                                columns: tableInfo 
                            });
                            break;
                            
                        case 'getTableData':
                            const tableData = await this._dbProvider.getTableData(
                                this._dbPath, 
                                message.tableName,
                                message.limit || 1000,
                                message.offset || 0
                            );
                            this._panel.webview.postMessage({ 
                                command: 'tableDataLoaded', 
                                tableName: message.tableName,
                                result: tableData,
                                requestId: message.requestId
                            });
                            break;
                            
                        case 'executeQuery':
                            const result = await this._dbProvider.runQuery(this._dbPath, message.query);
                            this._panel.webview.postMessage({ 
                                command: 'queryExecuted', 
                                result,
                                requestId: message.requestId
                            });
                            break;
                            
                        case 'getTableStructure':
                            const structure = await this._dbProvider.getTableStructure(this._dbPath, message.tableName);
                            this._panel.webview.postMessage({ 
                                command: 'tableStructureLoaded', 
                                tableName: message.tableName,
                                structure: await this.formatSql(structure)
                            });
                            break;
                            
                        case 'getIndexes':
                            const indexes = await this._dbProvider.getIndexes(this._dbPath, message.tableName);
                            this._panel.webview.postMessage({ 
                                command: 'indexesLoaded', 
                                tableName: message.tableName,
                                indexes
                            });
                            break;
                            
                        case 'getConstraints':
                            const constraints = await this._dbProvider.getTableConstraints(this._dbPath, message.tableName);
                            this._panel.webview.postMessage({ 
                                command: 'constraintsLoaded', 
                                tableName: message.tableName,
                                constraints
                            });
                            break;
                            
                        case 'getDatabaseInfo':
                            const dbInfo = await this._dbProvider.getDatabaseInfo(this._dbPath);
                            this._panel.webview.postMessage({ 
                                command: 'databaseInfoLoaded',
                                info: dbInfo
                            });
                            break;
                            
                        case 'formatQuery':
                            try {
                                const formattedQuery = await this.formatSql(message.query);
                                this._panel.webview.postMessage({ 
                                    command: 'queryFormatted',
                                    formattedQuery,
                                    requestId: message.requestId
                                });
                            } catch (error) {
                                this._panel.webview.postMessage({ 
                                    command: 'formatError',
                                    error: error instanceof Error ? error.message : String(error),
                                    requestId: message.requestId
                                });
                            }
                            break;
                    }
                } catch (error) {
                    this._panel.webview.postMessage({ 
                        command: 'error',
                        message: error instanceof Error ? error.message : String(error),
                        requestId: message.requestId
                    });
                }
            },
            null,
            this._disposables
        );
    }

    public refresh() {
        this._panel.webview.postMessage({ command: 'refresh' });
    }

    /**
     * Format SQL query using dynamic import of sql-formatter
     * @param sql SQL query to format
     * @returns Formatted SQL query
     */
    private async formatSql(sql: string): Promise<string> {
        try {
            // Dynamically import sql-formatter (ESM module)
            const sqlFormatter = await import('sql-formatter');
            return sqlFormatter.format(sql, { language: 'sqlite' });
        } catch (error) {
            console.error('Error formatting SQL:', error);
            return sql; // Return original SQL if formatting fails
        }
    }

    public dispose() {
        DatabaseViewerPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        // Dispose of all disposables
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        console.log(`Updating panel for database: ${this._dbPath}`);
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        
        // Ensure tables are loaded automatically after the webview is initialized
        setTimeout(() => {
            console.log(`Loading initial data for database: ${this._dbPath}`);
            this._loadInitialData();
        }, 1000); // Increased delay to ensure webview is ready
    }

    private _loadInitialData() {
        // Load tables and database info automatically
        console.log('Sending getTables message to webview');
        this._panel.webview.postMessage({ command: 'getTables' });
        
        console.log('Sending getDatabaseInfo message to webview');
        this._panel.webview.postMessage({ command: 'getDatabaseInfo' });
        
        // Log a confirmation message
        console.log('Initial data loading messages sent');
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('sqliteViewerPro');
        const isDarkTheme = config.get('darkTheme', true);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SQLite Viewer Pro</title>
    <style>
        :root {
            --bg-color: ${isDarkTheme ? '#1e1e1e' : '#f5f5f5'};
            --text-color: ${isDarkTheme ? '#cccccc' : '#333333'};
            --primary-color: ${isDarkTheme ? '#0e639c' : '#007acc'};
            --secondary-color: ${isDarkTheme ? '#264f78' : '#e6f7ff'};
            --border-color: ${isDarkTheme ? '#454545' : '#d1d1d1'};
            --hover-color: ${isDarkTheme ? '#2a2d2e' : '#e8e8e8'};
            --cell-bg-color: ${isDarkTheme ? '#252526' : '#ffffff'};
            --tab-bg-color: ${isDarkTheme ? '#2d2d2d' : '#ececec'};
            --selected-bg: ${isDarkTheme ? '#37373d' : '#e0e0e0'};
            --null-color: ${isDarkTheme ? '#888888' : '#999999'};
            --button-bg: ${isDarkTheme ? '#0e639c' : '#007acc'};
            --button-text: ${isDarkTheme ? '#ffffff' : '#ffffff'};
            --error-color: ${isDarkTheme ? '#f48771' : '#d83b01'};
            --success-color: ${isDarkTheme ? '#89d185' : '#107c10'};
            --editor-bg: ${isDarkTheme ? '#1e1e1e' : '#ffffff'};
            --editor-gutter: ${isDarkTheme ? '#252526' : '#f0f0f0'};
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, Ubuntu, "Droid Sans", sans-serif;
            padding: 0;
            margin: 0;
            color: var(--text-color);
            background-color: var(--bg-color);
            height: 100vh;
            overflow: hidden;
        }
        
        .container {
            display: flex;
            height: 100vh;
        }
        
        .sidebar {
            width: 250px;
            flex-shrink: 0;
            overflow-y: auto;
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
        }
        
        .main {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .query-area {
            height: 200px;
            min-height: 100px;
            border-bottom: 1px solid var(--border-color);
            padding: 10px;
            display: flex;
            flex-direction: column;
            resize: vertical;
            overflow: hidden;
        }
        
        .results-area {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .table-container {
            flex: 1;
            overflow: auto;
        }
        
        .toolbar {
            padding: 5px 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: var(--tab-bg-color);
            border-bottom: 1px solid var(--border-color);
        }
        
        .toolbar button {
            background-color: var(--button-bg);
            color: var(--button-text);
            border: none;
            padding: 4px 8px;
            margin-left: 5px;
            cursor: pointer;
            border-radius: 2px;
        }
        
        .toolbar button:hover {
            opacity: 0.9;
        }
        
        .toolbar button:disabled {
            background-color: var(--border-color);
            cursor: not-allowed;
        }
        
        .status-bar {
            padding: 3px 10px;
            background-color: var(--tab-bg-color);
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            display: flex;
            justify-content: space-between;
        }
        
        .query-editor {
            width: 100%;
            height: 100%;
            resize: none;
            background-color: var(--editor-bg);
            color: var(--text-color);
            border: none;
            padding: 5px;
            font-family: Consolas, 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            box-sizing: border-box;
        }
        
        .editor-container {
            flex: 1;
            position: relative;
            overflow: hidden;
        }
        
        .tree-view {
            list-style-type: none;
            padding: 0;
            margin: 0;
        }
        
        .tree-item {
            padding: 5px 10px 5px 20px;
            cursor: pointer;
            white-space: nowrap;
        }
        
        .tree-item:hover {
            background-color: var(--hover-color);
        }
        
        .tree-item.selected {
            background-color: var(--selected-bg);
        }
        
        .tree-item-header {
            padding: 8px 10px;
            font-weight: bold;
            border-bottom: 1px solid var(--border-color);
            background-color: var(--tab-bg-color);
        }
        
        .database-info {
            padding: 10px;
            font-size: 12px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .database-info h3 {
            margin-top: 0;
            margin-bottom: 10px;
        }
        
        .database-info-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
        }
        
        .database-info-label {
            opacity: 0.8;
        }
        
        table {
            border-collapse: collapse;
            width: 100%;
            font-size: 14px;
        }
        
        th, td {
            text-align: left;
            padding: 6px 10px;
            border-bottom: 1px solid var(--border-color);
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        th {
            position: sticky;
            top: 0;
            background-color: var(--tab-bg-color);
            z-index: 1;
            font-weight: normal;
            border-bottom: 2px solid var(--border-color);
        }
        
        tbody tr:hover {
            background-color: var(--hover-color);
        }
        
        td.null-value {
            color: var(--null-color);
            font-style: italic;
        }
        
        .tabs {
            display: flex;
            background-color: var(--tab-bg-color);
            border-bottom: 1px solid var(--border-color);
        }
        
        .tab {
            padding: 8px 15px;
            cursor: pointer;
            border-right: 1px solid var(--border-color);
        }
        
        .tab.active {
            background-color: var(--bg-color);
            border-bottom: 2px solid var(--primary-color);
        }
        
        .tab-content {
            display: none;
            height: 100%;
            overflow: auto;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .structure-container {
            padding: 10px;
            font-family: Consolas, 'Courier New', monospace;
            white-space: pre-wrap;
        }
        
        .indexes-container, .constraints-container {
            padding: 10px;
        }
        
        .table-info {
            margin-bottom: 15px;
        }
        
        .message {
            padding: 10px;
            margin: 10px;
            border-radius: 3px;
        }
        
        .error-message {
            background-color: rgba(204, 0, 0, 0.1);
            border: 1px solid var(--error-color);
            color: var(--error-color);
        }
        
        .success-message {
            background-color: rgba(16, 124, 16, 0.1);
            border: 1px solid var(--success-color);
            color: var(--success-color);
        }
        
        .loader {
            border: 3px solid var(--border-color);
            border-top: 3px solid var(--primary-color);
            border-radius: 50%;
            width: 20px;
            height: 20px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .row-count-badge {
            background-color: var(--primary-color);
            color: white;
            border-radius: 10px;
            padding: 1px 6px;
            font-size: 11px;
            margin-left: 5px;
        }
        
        .schema-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
        }
        
        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        
        ::-webkit-scrollbar-track {
            background: var(--bg-color);
        }
        
        ::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 5px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: var(--primary-color);
        }
        
        /* Tooltips */
        .tooltip {
            position: relative;
            display: inline-block;
        }
        
        .tooltip .tooltiptext {
            visibility: hidden;
            width: 200px;
            background-color: var(--tab-bg-color);
            color: var(--text-color);
            text-align: center;
            border-radius: 3px;
            padding: 5px;
            position: absolute;
            z-index: 2;
            bottom: 125%;
            left: 50%;
            margin-left: -100px;
            opacity: 0;
            transition: opacity 0.3s;
            border: 1px solid var(--border-color);
            font-size: 12px;
        }
        
        .tooltip:hover .tooltiptext {
            visibility: visible;
            opacity: 1;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <div class="database-info">
                <h3>Database Info</h3>
                <div id="db-info-content">
                    <div class="loader"></div>
                </div>
            </div>
            <div class="tree-item-header">Tables & Views</div>
            <div id="tables-container" class="tree-view">
                <div class="loader"></div>
            </div>
        </div>
        <div class="main">
            <div class="query-area">
                <div class="toolbar">
                    <span>SQL Query</span>
                    <div>
                        <button id="format-btn" title="Format SQL">Format</button>
                        <button id="run-btn" title="Execute query (Ctrl+Enter)">Run</button>
                    </div>
                </div>
                <div class="editor-container">
                    <textarea id="query-editor" class="query-editor" placeholder="Write your SQL query here..."></textarea>
                </div>
            </div>
            <div class="results-area">
                <div class="tabs">
                    <div class="tab active" data-tab="results">Results</div>
                    <div class="tab" data-tab="structure">Structure</div>
                    <div class="tab" data-tab="indexes">Indexes</div>
                    <div class="tab" data-tab="constraints">Constraints</div>
                </div>
                <div id="results-tab" class="tab-content active">
                    <div class="table-container" id="results-container">
                        <div class="message">Execute a query or select a table to view data.</div>
                    </div>
                    <div class="status-bar">
                        <div id="result-status">Ready</div>
                        <div id="execution-time"></div>
                    </div>
                </div>
                <div id="structure-tab" class="tab-content">
                    <div class="structure-container" id="structure-container">
                        <div class="message">Select a table to view its structure.</div>
                    </div>
                </div>
                <div id="indexes-tab" class="tab-content">
                    <div class="indexes-container" id="indexes-container">
                        <div class="message">Select a table to view its indexes.</div>
                    </div>
                </div>
                <div id="constraints-tab" class="tab-content">
                    <div class="constraints-container" id="constraints-container">
                        <div class="message">Select a table to view its constraints.</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            
            // State management
            let state = {
                tables: [],
                currentTable: null,
                currentQuery: null,
                requestCounter: 0,
                pendingRequests: new Map()
            };
            
            // Cache DOM elements
            const queryEditor = document.getElementById('query-editor');
            const runButton = document.getElementById('run-btn');
            const formatButton = document.getElementById('format-btn');
            const tablesContainer = document.getElementById('tables-container');
            const resultsContainer = document.getElementById('results-container');
            const structureContainer = document.getElementById('structure-container');
            const indexesContainer = document.getElementById('indexes-container');
            const constraintsContainer = document.getElementById('constraints-container');
            const resultStatus = document.getElementById('result-status');
            const executionTime = document.getElementById('execution-time');
            const dbInfoContent = document.getElementById('db-info-content');
            
            // Tab switching
            document.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', function() {
                    // Remove active class from all tabs and content
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    
                    // Add active class to current tab and content
                    this.classList.add('active');
                    const tabContent = document.getElementById(this.getAttribute('data-tab') + '-tab');
                    if (tabContent) tabContent.classList.add('active');
                    
                    // Load tab-specific data if needed
                    if (state.currentTable) {
                        const tabName = this.getAttribute('data-tab');
                        if (tabName === 'structure' && structureContainer.innerHTML === '<div class="message">Select a table to view its structure.</div>') {
                            loadTableStructure(state.currentTable);
                        } else if (tabName === 'indexes' && indexesContainer.innerHTML === '<div class="message">Select a table to view its indexes.</div>') {
                            loadTableIndexes(state.currentTable);
                        } else if (tabName === 'constraints' && constraintsContainer.innerHTML === '<div class="message">Select a table to view its constraints.</div>') {
                            loadTableConstraints(state.currentTable);
                        }
                    }
                });
            });
            
            // Load tables when the page loads
            window.addEventListener('load', () => {
                vscode.postMessage({ command: 'getTables' });
                vscode.postMessage({ command: 'getDatabaseInfo' });
            });
            
            // Format button
            formatButton.addEventListener('click', () => {
                const query = queryEditor.value.trim();
                if (query) {
                    const requestId = createRequestId();
                    vscode.postMessage({ 
                        command: 'formatQuery', 
                        query,
                        requestId
                    });
                }
            });
            
            // Run button
            runButton.addEventListener('click', executeCurrentQuery);
            
            // Keyboard shortcut for executing query (Ctrl+Enter)
            queryEditor.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    executeCurrentQuery();
                    e.preventDefault();
                }
            });
            
            function executeCurrentQuery() {
                const query = queryEditor.value.trim();
                if (query) {
                    setLoading(true);
                    resultStatus.textContent = 'Executing query...';
                    executionTime.textContent = '';
                    
                    // Switch to results tab
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    document.querySelector('.tab[data-tab="results"]').classList.add('active');
                    document.getElementById('results-tab').classList.add('active');
                    
                    // Execute the query
                    const startTime = performance.now();
                    const requestId = createRequestId();
                    
                    state.pendingRequests.set(requestId, {
                        type: 'query',
                        startTime
                    });
                    
                    vscode.postMessage({ 
                        command: 'executeQuery', 
                        query,
                        requestId
                    });
                }
            }
            
            function createRequestId() {
                return 'req_' + (state.requestCounter++);
            }
            
            function loadTable(tableName) {
                // Update state
                state.currentTable = tableName;
                
                // Update UI
                document.querySelectorAll('.tree-item').forEach(item => {
                    item.classList.remove('selected');
                });
                document.querySelector(\`[data-table="\${tableName}"]\`).classList.add('selected');
                
                // Switch to results tab
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelector('.tab[data-tab="results"]').classList.add('active');
                document.getElementById('results-tab').classList.add('active');
                
                // Set default query
                queryEditor.value = \`SELECT * FROM "\${tableName}" LIMIT 1000\`;
                
                // Load table data
                setLoading(true);
                resultStatus.textContent = \`Loading data from \${tableName}...\`;
                
                const requestId = createRequestId();
                state.pendingRequests.set(requestId, {
                    type: 'tableData',
                    tableName
                });
                
                vscode.postMessage({ 
                    command: 'getTableData', 
                    tableName,
                    requestId
                });
                
                // Reset other tabs content
                structureContainer.innerHTML = '<div class="loader"></div>';
                indexesContainer.innerHTML = '<div class="loader"></div>';
                constraintsContainer.innerHTML = '<div class="loader"></div>';
            }
            
            function loadTableStructure(tableName) {
                vscode.postMessage({ 
                    command: 'getTableStructure', 
                    tableName
                });
                
                vscode.postMessage({ 
                    command: 'getTableInfo', 
                    tableName
                });
            }
            
            function loadTableIndexes(tableName) {
                vscode.postMessage({ 
                    command: 'getIndexes', 
                    tableName
                });
            }
            
            function loadTableConstraints(tableName) {
                vscode.postMessage({ 
                    command: 'getConstraints', 
                    tableName
                });
            }
            
            function setLoading(isLoading) {
                if (isLoading) {
                    resultsContainer.innerHTML = '<div class="loader"></div>';
                }
            }
            
            function renderTables(tables) {
                tablesContainer.innerHTML = '';
                
                if (tables.length === 0) {
                    tablesContainer.innerHTML = '<div class="message">No tables found in database.</div>';
                    return;
                }
                
                tables.forEach(table => {
                    const tableItem = document.createElement('div');
                    tableItem.className = 'tree-item';
                    tableItem.setAttribute('data-table', table.name);
                    
                    const schemaItem = document.createElement('div');
                    schemaItem.className = 'schema-item';
                    
                    const tableName = document.createElement('span');
                    tableName.textContent = table.name;
                    
                    schemaItem.appendChild(tableName);
                    
                    if (table.type === 'table' && table.rowCount !== undefined) {
                        const rowCount = document.createElement('span');
                        rowCount.className = 'row-count-badge';
                        rowCount.textContent = table.rowCount;
                        schemaItem.appendChild(rowCount);
                    }
                    
                    tableItem.appendChild(schemaItem);
                    
                    tableItem.addEventListener('click', () => loadTable(table.name));
                    tablesContainer.appendChild(tableItem);
                });
            }
            
            function renderTableData(result, tableName) {
                if (result.error) {
                    resultsContainer.innerHTML = \`<div class="error-message">\${result.error}</div>\`;
                    resultStatus.textContent = 'Error';
                    return;
                }
                
                if (result.columns.length === 0) {
                    if (result.rowCount > 0) {
                        resultsContainer.innerHTML = \`<div class="success-message">Query executed successfully. \${result.rowCount} rows affected.</div>\`;
                    } else {
                        resultsContainer.innerHTML = \`<div class="message">No data returned.</div>\`;
                    }
                    resultStatus.textContent = \`\${result.rowCount} rows affected\`;
                    return;
                }
                
                let html = '<table><thead><tr>';
                
                // Add column headers
                result.columns.forEach(column => {
                    html += \`<th>\${escapeHtml(column)}</th>\`;
                });
                
                html += '</tr></thead><tbody>';
                
                // Add data rows
                if (result.values.length === 0) {
                    html += \`<tr><td colspan="\${result.columns.length}" style="text-align: center;">No data</td></tr>\`;
                } else {
                    result.values.forEach(row => {
                        html += '<tr>';
                        row.forEach(cell => {
                            if (cell === null) {
                                html += \`<td class="null-value">NULL</td>\`;
                            } else {
                                html += \`<td>\${escapeHtml(String(cell))}</td>\`;
                            }
                        });
                        html += '</tr>';
                    });
                }
                
                html += '</tbody></table>';
                
                resultsContainer.innerHTML = html;
                resultStatus.textContent = \`\${result.values.length} rows\`;
            }
            
            function renderTableInfo(columns) {
                let html = '<div class="table-info">';
                html += '<table><thead><tr>';
                html += '<th>Column</th><th>Type</th><th>Not Null</th><th>Default</th><th>Primary Key</th>';
                html += '</tr></thead><tbody>';
                
                columns.forEach(col => {
                    html += '<tr>';
                    html += \`<td>\${escapeHtml(col.name)}</td>\`;
                    html += \`<td>\${escapeHtml(col.type || '')}</td>\`;
                    html += \`<td>\${col.notnull ? 'Yes' : 'No'}</td>\`;
                    html += \`<td>\${col.dflt_value !== null ? escapeHtml(col.dflt_value) : '<span class="null-value">NULL</span>'}</td>\`;
                    html += \`<td>\${col.pk ? 'Yes' : 'No'}</td>\`;
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                return html;
            }
            
            function renderTableStructure(structure) {
                return \`<pre>\${structure}</pre>\`;
            }
            
            function renderIndexes(indexes) {
                if (indexes.length === 0) {
                    return '<div class="message">No indexes found for this table.</div>';
                }
                
                let html = '<div class="table-info">';
                html += '<table><thead><tr>';
                html += '<th>Name</th><th>Unique</th><th>Columns</th>';
                html += '</tr></thead><tbody>';
                
                indexes.forEach(idx => {
                    const columns = idx.columns ? idx.columns.map(col => col.name).join(', ') : '';
                    
                    html += '<tr>';
                    html += \`<td>\${escapeHtml(idx.name)}</td>\`;
                    html += \`<td>\${idx.unique ? 'Yes' : 'No'}</td>\`;
                    html += \`<td>\${escapeHtml(columns)}</td>\`;
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                return html;
            }
            
            function renderConstraints(constraints) {
                if (constraints.length === 0) {
                    return '<div class="message">No foreign key constraints found for this table.</div>';
                }
                
                let html = '<div class="table-info">';
                html += '<table><thead><tr>';
                html += '<th>ID</th><th>From Column</th><th>To Table</th><th>To Column</th><th>On Update</th><th>On Delete</th>';
                html += '</tr></thead><tbody>';
                
                constraints.forEach(con => {
                    html += '<tr>';
                    html += \`<td>\${con.id}</td>\`;
                    html += \`<td>\${escapeHtml(con.from)}</td>\`;
                    html += \`<td>\${escapeHtml(con.table)}</td>\`;
                    html += \`<td>\${escapeHtml(con.to)}</td>\`;
                    html += \`<td>\${escapeHtml(con.on_update || 'NO ACTION')}</td>\`;
                    html += \`<td>\${escapeHtml(con.on_delete || 'NO ACTION')}</td>\`;
                    html += '</tr>';
                });
                
                html += '</tbody></table></div>';
                return html;
            }
            
            function renderDatabaseInfo(info) {
                let html = '<div>';
                
                Object.keys(info).forEach(key => {
                    html += '<div class="database-info-item">';
                    html += \`<span class="database-info-label">\${formatLabel(key)}:</span>\`;
                    html += \`<span class="database-info-value">\${escapeHtml(String(info[key]))}</span>\`;
                    html += '</div>';
                });
                
                html += '</div>';
                return html;
            }
            
            function formatLabel(key) {
                // Convert camelCase or snake_case to Title Case
                return key
                    .replace(/_/g, ' ')
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase())
                    .trim();
            }
            
            function escapeHtml(unsafe) {
                if (unsafe === null || unsafe === undefined) {
                    return '';
                }
                return String(unsafe)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }
            
            // Handle messages from the extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'tablesLoaded':
                        state.tables = message.tables;
                        renderTables(message.tables);
                        break;
                        
                    case 'tableDataLoaded':
                    case 'queryExecuted':
                        const requestData = state.pendingRequests.get(message.requestId);
                        if (requestData) {
                            if (requestData.startTime) {
                                const duration = performance.now() - requestData.startTime;
                                executionTime.textContent = \`\${duration.toFixed(2)} ms\`;
                            }
                            state.pendingRequests.delete(message.requestId);
                        }
                        
                        renderTableData(message.result, message.tableName);
                        break;
                        
                    case 'tableInfoLoaded':
                        const infoHtml = renderTableInfo(message.columns);
                        // This info is prepended to the structure
                        const existingStructure = structureContainer.innerHTML.replace('<div class="loader"></div>', '');
                        structureContainer.innerHTML = infoHtml + existingStructure;
                        break;
                        
                    case 'tableStructureLoaded':
                        const structureHtml = renderTableStructure(message.structure);
                        structureContainer.innerHTML = structureHtml;
                        // After structure is loaded, get the table info too
                        break;
                        
                    case 'indexesLoaded':
                        indexesContainer.innerHTML = renderIndexes(message.indexes);
                        break;
                        
                    case 'constraintsLoaded':
                        constraintsContainer.innerHTML = renderConstraints(message.constraints);
                        break;
                        
                    case 'databaseInfoLoaded':
                        dbInfoContent.innerHTML = renderDatabaseInfo(message.info);
                        break;
                        
                    case 'error':
                        const errorRequestData = state.pendingRequests.get(message.requestId);
                        if (errorRequestData) {
                            state.pendingRequests.delete(message.requestId);
                        }
                        
                        resultsContainer.innerHTML = \`<div class="error-message">\${message.message}</div>\`;
                        resultStatus.textContent = 'Error';
                        break;
                        
                    case 'queryFormatted':
                        queryEditor.value = message.formattedQuery;
                        break;
                        
                    case 'refresh':
                        // Reload everything
                        vscode.postMessage({ command: 'getTables' });
                        vscode.postMessage({ command: 'getDatabaseInfo' });
                        
                        // If there's a selected table, reload its data
                        if (state.currentTable) {
                            loadTable(state.currentTable);
                        }
                        break;
                }
            });
        })();
    </script>
</body>
</html>`;
    }
}